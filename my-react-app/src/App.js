import React, { createContext, useState, useEffect, useContext, useRef } from 'react';
import { BrowserRouter, Routes, Route, Link, useNavigate, useParams, useLocation } from 'react-router-dom';
import axios from 'axios';
import './index.css';

const API = axios.create({ baseURL: 'http://localhost:5000/api', withCredentials: true });

// --- UTILS ---
const getInitials = (name) => {
  if (!name) return 'MF';
  const parts = name.split(' ');
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return parts[0].substring(0, 2).toUpperCase();
};

const formatRelativeTime = (dateString) => {
  const now = new Date();
  const date = new Date(dateString);
  const diffMins = Math.floor((now - date) / 60000);
  const diffHours = Math.floor((now - date) / 3600000);
  const diffDays = Math.floor((now - date) / 86400000);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
};

const useMediaQuery = (query) => {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const media = window.matchMedia(query);
    if (media.matches !== matches) setMatches(media.matches);
    const listener = () => setMatches(media.matches);
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, [matches, query]);
  return matches;
};

// --- AUTH CONTEXT ---
const AuthContext = createContext();

const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const navigate = useNavigate();

  useEffect(() => {
    API.get('/auth/me')
      .then(res => { setUser(res.data); fetchNotifications(); })
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const fetchNotifications = async () => {
    try {
      const res = await API.get('/notifications');
      const formatted = res.data.map(n => ({ ...n, time: formatRelativeTime(n.created_at), read: false }));
      setNotifications(formatted);
      setUnreadCount(formatted.length);
    } catch (err) {
      console.error("Failed to fetch notifications", err);
    }
  };

  const login = async (email, password) => {
    await API.post('/auth/login', { email, password });
    const res = await API.get('/auth/me');
    setUser(res.data);
    fetchNotifications();
    navigate('/dashboard');
  };

  const register = async (name, email, password, confirmPassword) => {
    await API.post('/auth/register', { name, email, password, confirmPassword });
    navigate('/login', { state: { success: 'Account created successfully! Please sign in.' } });
  };

  const googleLogin = async (credential) => {
    try {
      await API.post('/auth/google', { token: credential });
      const res = await API.get('/auth/me');
      setUser(res.data);
      fetchNotifications();
      navigate('/dashboard');
    } catch (err) {
      console.error('Google login error:', err);
      throw err;
    }
  };

  const logout = async () => {
    await API.post('/auth/logout');
    setUser(null);
    setNotifications([]);
    setUnreadCount(0);
    navigate('/login');
  };

  const markNotificationsRead = () => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    setUnreadCount(0);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, googleLogin, logout, notifications, markNotificationsRead, unreadCount, fetchNotifications }}>
    {children}
    </AuthContext.Provider>
  );
};

// --- UI COMPONENTS ---
const Skeleton = ({ className = '' }) => <div className={`animate-pulse bg-slate-200 rounded ${className}`}></div>;

const PostSkeleton = () => (
  <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
    <div className="flex items-center gap-3">
    <Skeleton className="w-10 h-10 rounded-full" />
   <div className="flex-1 space-y-2">
   <Skeleton className="h-4 w-32" />
    <Skeleton className="h-3 w-20" />
    </div>
    </div>
    <Skeleton className="h-4 w-full" />
    <Skeleton className="h-4 w-3/4" />
  </div>
);

const ScrollToTop = () => {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const toggleVisible = () => setVisible(window.pageYOffset > 300);
    window.addEventListener('scroll', toggleVisible);
    return () => window.removeEventListener('scroll', toggleVisible);
  }, []);
  if (!visible) return null;
  return (
    <button onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} className="fixed bottom-24 right-4 md:bottom-8 md:right-8 z-40 bg-indigo-600 hover:bg-indigo-700 text-white w-12 h-12 rounded-full shadow-lg flex items-center justify-center transition-all duration-300 hover:scale-110">
      ↑
    </button>
  );
};

const PostMenu = ({ post, onEdit, onDelete }) => {
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);
  return (
    <div className="relative" ref={menuRef}>
      <button onClick={() => setOpen(!open)} className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-full transition">
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" /></svg>
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-40 bg-white border border-slate-200 rounded-lg shadow-lg z-30 overflow-hidden">
          <button onClick={() => { onEdit(); setOpen(false); }} className="w-full text-left px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2 transition"> Edit Post</button>
          <button onClick={() => { onDelete(); setOpen(false); }} className="w-full text-left px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2 transition border-t border-slate-100">Delete Post</button>
        </div>
      )}
    </div>
  );
};

const EditPostModal = ({ post, onClose, onSave }) => {
  const [content, setContent] = useState(post.content);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const handleSubmit = async () => {
    if (!content.trim()) return;
    setIsSubmitting(true);
    try { await onSave(content); onClose(); } catch (err) { alert('Failed to update post'); } finally { setIsSubmitting(false); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose}></div>
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-lg z-10">
        <div className="flex justify-between items-center p-4 border-b border-slate-200">
          <h3 className="font-bold text-slate-900 text-lg">Edit Post</h3>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-900 text-2xl leading-none w-8 h-8 flex items-center justify-center rounded-full hover:bg-slate-100">×</button>
        </div>
        <div className="p-4">
          <textarea value={content} onChange={(e) => setContent(e.target.value)} className="w-full h-40 p-3 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none text-sm text-slate-900 placeholder-slate-400" placeholder="Update your post..." />
        </div>
        <div className="flex justify-end gap-3 p-4 border-t border-slate-200">
          <button onClick={onClose} className="px-4 py-2 text-slate-700 hover:bg-slate-100 rounded-lg font-medium transition text-sm">Cancel</button>
          <button onClick={handleSubmit} disabled={isSubmitting || !content.trim()} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white rounded-lg font-medium transition text-sm">{isSubmitting ? 'Saving...' : 'Save Changes'}</button>
        </div>
      </div>
    </div>
  );
};

const Sidebar = ({ isOpen, onClose }) => {
  const navigate = useNavigate();
  const { user, logout } = useContext(AuthContext);
  const isMobile = useMediaQuery('(max-width: 768px)');
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose}></div>
      <div className={`relative bg-white h-full shadow-2xl flex flex-col ${isMobile ? 'w-full' : 'w-72'}`}>
        <div className="flex justify-between items-center p-4 border-b border-slate-200">
          <span className="text-xl font-bold text-indigo-600">MindShare</span>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-900 text-3xl leading-none w-10 h-10 flex items-center justify-center rounded-full hover:bg-slate-100 transition">×</button>
        </div>
        {isMobile && user && (
          <div className="p-4 border-b border-slate-200 bg-slate-50">
            <div className="flex items-center gap-3">
              <img src={`https://ui-avatars.com/api/?name=${getInitials(user.name)}&background=6366f1&color=fff`} alt="Profile" className="w-12 h-12 rounded-full" />
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-slate-900 truncate">{user.name}</p>
                <p className="text-xs text-slate-500 truncate">{user.email}</p>
              </div>
            </div>
          </div>
        )}
        <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
          <button onClick={() => { navigate('/dashboard'); onClose(); }} className="w-full flex items-center gap-3 px-4 py-3 text-slate-700 hover:bg-slate-100 rounded-lg transition text-left font-medium">Home</button>
          <button onClick={() => { navigate('/create'); onClose(); }} className="w-full flex items-center gap-3 px-4 py-3 text-slate-700 hover:bg-slate-100 rounded-lg transition text-left font-medium">Post</button>
          {user && <button onClick={() => { navigate(`/profile/${user.id}`); onClose(); }} className="w-full flex items-center gap-3 px-4 py-3 text-slate-700 hover:bg-slate-100 rounded-lg transition text-left font-medium">My Profile</button>}
        </nav>
        {isMobile && user && (
          <div className="p-4 border-t border-slate-200">
            <button onClick={() => { logout(); onClose(); }} className="w-full flex items-center gap-3 px-4 py-3 text-red-600 hover:bg-red-50 rounded-lg transition text-left font-medium">Logout</button>
          </div>
        )}
      </div>
    </div>
  );
};

const NotificationPanel = ({ isOpen, onClose }) => {
  const { notifications, markNotificationsRead, unreadCount } = useContext(AuthContext);
  const navigate = useNavigate();
  const isMobile = useMediaQuery('(max-width: 768px)');
  if (!isOpen) return null;
  const handleNotifClick = (postId) => { markNotificationsRead(); navigate(`/post/${postId}`); onClose(); };
  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose}></div>
      <div className={`relative bg-white shadow-2xl flex flex-col ${isMobile ? 'w-full h-full' : 'w-96 h-auto max-h-[80vh] absolute right-0 top-0 rounded-xl overflow-hidden'}`}>
        <div className="p-4 border-b border-slate-200 flex justify-between items-center sticky top-0 bg-white">
          <div>
            <h3 className="font-bold text-slate-900 text-lg">Notifications</h3>
            {unreadCount > 0 && <p className="text-xs text-slate-500">{unreadCount} unread</p>}
          </div>
          <div className="flex items-center gap-2">
            {unreadCount > 0 && <button onClick={markNotificationsRead} className="text-xs text-indigo-600 hover:text-indigo-700 font-medium px-3 py-1.5 rounded-lg hover:bg-indigo-50 transition">Mark all read</button>}
            <button onClick={onClose} className="text-slate-500 hover:text-slate-900 text-2xl w-8 h-8 flex items-center justify-center rounded-full hover:bg-slate-100">×</button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {notifications.length === 0 ? (
            <div className="p-12 text-center"><p className="text-slate-500 font-medium">No notifications yet</p><p className="text-slate-400 text-sm mt-2">When someone interacts with your posts, you'll see it here</p></div>
          ) : (
            <div className="divide-y divide-slate-100">
              {notifications.map(n => (
                <div key={n.id} onClick={() => handleNotifClick(n.post_id)} className={`p-4 hover:bg-slate-50 cursor-pointer flex gap-3 transition ${n.read ? 'opacity-60' : 'bg-indigo-50/30'}`}>
                  <img src={n.profile_image || `https://ui-avatars.com/api/?name=${getInitials(n.user)}&background=e0e7ff&color=4f46e5`} alt={n.user} className="w-10 h-10 rounded-full flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-slate-900"><span className="font-semibold">{n.user}</span> <span className="text-slate-600">{n.content}</span></p>
                    <p className="text-xs text-slate-500 mt-1 flex items-center gap-1">
                      {!n.read && <span className="w-2 h-2 bg-indigo-600 rounded-full"></span>}
                      {n.time}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const TopBar = () => {
  const { user, logout, unreadCount } = useContext(AuthContext);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [showNotif, setShowNotif] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const profileRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (profileRef.current && !profileRef.current.contains(event.target)) setShowProfile(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const initials = user ? getInitials(user.name) : 'MF';

  return (
    <>
      <Sidebar isOpen={isMenuOpen} onClose={() => setIsMenuOpen(false)} />
      <NotificationPanel isOpen={showNotif} onClose={() => setShowNotif(false)} />
      <header className="bg-white border-b border-slate-200 sticky top-0 z-40 shadow-sm">
        <div className="max-w-6xl mx-auto px-3 sm:px-4 lg:px-8 h-14 sm:h-16 flex justify-between items-center gap-2">
          <div className="flex items-center gap-2 sm:gap-3">
            <button onClick={() => setIsMenuOpen(true)} className="text-slate-600 hover:text-slate-900 text-xl sm:text-2xl p-1.5 sm:p-2 rounded-lg hover:bg-slate-100 transition">☰</button>
            <Link to="/dashboard" className="text-lg sm:text-xl font-bold text-indigo-600">MindShare</Link>
          </div>
          <div className="flex items-center gap-2 sm:gap-4 ml-auto">
            <button onClick={() => setShowNotif(true)} className="relative p-2 text-slate-600 hover:bg-slate-100 rounded-full transition">
              🔔
              {unreadCount > 0 && <span className="absolute top-1 right-1 min-w-[18px] h-[18px] bg-red-500 text-white text-[10px] font-bold flex items-center justify-center rounded-full px-1 animate-pulse">{unreadCount > 9 ? '9+' : unreadCount}</span>}
            </button>
            {user && (
              <div className="relative" ref={profileRef}>
                <button onClick={() => { setShowProfile(!showProfile); setShowNotif(false); }} className="flex items-center justify-center hover:bg-slate-100 p-0.5 rounded-full transition ring-2 ring-transparent hover:ring-indigo-100" title="Account">
                  <img src={`https://ui-avatars.com/api/?name=${initials}&background=6366f1&color=fff&size=128`} alt="Account" className="w-9 h-9 sm:w-10 sm:h-10 rounded-full border-2 border-slate-200" />
                </button>
                {showProfile && (
                  <div className="absolute right-0 mt-2 w-64 bg-white border border-slate-200 rounded-xl shadow-xl z-50 overflow-hidden">
                    <div className="p-4 border-b border-slate-200 bg-slate-50">
                      <p className="font-semibold text-slate-900 truncate">{user.name}</p>
                      <p className="text-xs text-slate-500 truncate mt-1">{user.email}</p>
                    </div>
                    <div className="p-3">
                      <button onClick={() => { logout(); setShowProfile(false); }} className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition group border border-red-100">
                        <span className="flex items-center gap-2"><span className="text-lg group-hover:scale-110 transition-transform"></span><span>Logout</span></span>
                        <svg className="w-4 h-4 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </header>
    </>
  );
};

const BottomNav = () => {
  const { user } = useContext(AuthContext);
  const location = useLocation();
  const navigate = useNavigate();
  const isMobile = useMediaQuery('(max-width: 768px)');
  if (!isMobile || !user) return null;
  const navItems = [{ path: '/dashboard', label: 'Home' }, { path: '/create', label: 'Post' }, { path: `/profile/${user.id}`, label: 'Profile' }];
  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 z-40 shadow-lg md:hidden">
      <div className="flex justify-around items-center h-16">
        {navItems.map(item => {
          const isActive = location.pathname === item.path;
          return (
            <button key={item.path} onClick={() => navigate(item.path)} className={`flex flex-col items-center justify-center flex-1 h-full transition relative ${isActive ? 'text-indigo-600' : 'text-slate-500'}`}>
              <span className="text-sm font-medium">{item.label}</span>
              {isActive && <div className="absolute top-0 w-12 h-0.5 bg-indigo-600 rounded-b"></div>}
            </button>
          );
        })}
      </div>
    </nav>
  );
};

// --- PAGE COMPONENTS ---
const Dashboard = () => {
  const { user } = useContext(AuthContext);
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newPostContent, setNewPostContent] = useState('');
  const [editingPost, setEditingPost] = useState(null);
  const isMobile = useMediaQuery('(max-width: 768px)');

  useEffect(() => {
    setLoading(true);
    API.get('/posts').then(res => setPosts(res.data)).finally(() => setLoading(false));
  }, []);

  const handleCreatePost = async () => {
    if (!newPostContent.trim()) return;
    const res = await API.post('/posts', { content: newPostContent });
    setPosts([{ ...res.data, name: user.name, profile_image: user.profile_image, comment_count: 0, created_at: new Date().toISOString() }, ...posts]);
    setNewPostContent('');
  };

  const handleUpdatePost = async (postId, content) => {
    await API.put(`/posts/${postId}`, { content });
    setPosts(posts.map(p => p.id === postId ? { ...p, content, updated_at: new Date().toISOString() } : p));
  };

  const handleDeletePost = async (postId) => {
    if (!window.confirm('Are you sure you want to delete this post? This action cannot be undone.')) return;
    try {
      await API.delete(`/posts/${postId}`);
      setPosts(posts.filter(p => p.id !== postId));
    } catch (err) { alert('Failed to delete post'); }
  };


  return (
    <div className="max-w-3xl mx-auto px-3 sm:px-4 lg:px-8 py-4 sm:py-6 lg:py-8 pb-24 md:pb-8">
      {editingPost && <EditPostModal post={editingPost} onClose={() => setEditingPost(null)} onSave={(content) => handleUpdatePost(editingPost.id, content)} />}
      <div className="mb-4 sm:mb-6">
        <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-slate-900"> </h1>
        <p className="text-slate-500 text-sm sm:text-base mt-1">See what people are discussing.</p>
      </div>
      {!isMobile && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-6 mb-4 sm:mb-6">
          <div className="flex gap-3">
            <img src={`https://ui-avatars.com/api/?name=${getInitials(user?.name)}&background=6366f1&color=fff`} alt="You" className="w-10 h-10 rounded-full flex-shrink-0" />
            <div className="flex-1">
              <textarea value={newPostContent} onChange={(e) => setNewPostContent(e.target.value)} placeholder="What's on your mind?" className="w-full p-3 border border-slate-200 bg-white text-slate-900 placeholder-slate-400 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none text-sm sm:text-base" rows="2" />
              <div className="flex justify-end mt-3">
                <button onClick={handleCreatePost} disabled={!newPostContent.trim()} className="px-4 sm:px-6 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white rounded-lg font-medium transition text-sm sm:text-base">Publish</button>
              </div>
            </div>
          </div>
        </div>
      )}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base sm:text-lg font-bold text-slate-900">Latest Posts</h2>
        <span className="text-xs sm:text-sm text-slate-500">{posts.length} {posts.length === 1 ? 'post' : 'posts'}</span>
      </div>
      {loading ? (
        <div className="space-y-4"><PostSkeleton /><PostSkeleton /><PostSkeleton /></div>
      ) : posts.length === 0 ? (
        <div className="text-center py-12 sm:py-16 bg-white border border-slate-200 rounded-xl">
          <p className="text-slate-500 font-medium">No posts yet</p>
          <p className="text-slate-400 text-sm mt-2">Be the first to share your thoughts!</p>
          <Link to="/create" className="inline-block mt-4 px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium transition">Create Post</Link>
        </div>
      ) : (
        <div className="space-y-3 sm:space-y-4">
          {posts.map(post => (
            <div key={post.id} className="bg-white border border-slate-200 rounded-xl p-4 sm:p-6 hover:shadow-md transition">
              <div className="flex items-start gap-3 mb-3">
                <img src={post.profile_image || `https://ui-avatars.com/api/?name=${getInitials(post.name)}&background=6366f1&color=fff`} alt={post.name} className="w-9 h-9 sm:w-10 sm:h-10 rounded-full flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <Link to={`/profile/${post.user_id}`} className="font-semibold text-slate-900 hover:text-indigo-600 text-sm sm:text-base block truncate">{post.name}</Link>
                  <p className="text-xs text-slate-500">{formatRelativeTime(post.created_at)}{post.updated_at && post.updated_at !== post.created_at && <span className="italic ml-1">(edited)</span>}</p>
                </div>
                {user && user.id === post.user_id && <PostMenu post={post} onEdit={() => setEditingPost(post)} onDelete={() => handleDeletePost(post.id)} />}
              </div>
              <p className="text-slate-900 mb-4 whitespace-pre-wrap leading-relaxed text-sm sm:text-base">{post.content}</p>
              <div className="pt-3 border-t border-slate-100">
                <Link to={`/post/${post.id}`} className="inline-flex items-center gap-2 text-xs sm:text-sm font-medium text-slate-600 hover:text-indigo-600 transition py-1">
                  💬 {post.comment_count || 0} {isMobile ? '' : 'Comments'} <span className="hidden sm:inline">View →</span>
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const CreatePost = () => {
  const [content, setContent] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const navigate = useNavigate();
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!content.trim()) return;
    setIsSubmitting(true);
    try { await API.post('/posts', { content }); navigate('/dashboard'); } catch (err) { alert('Failed to create post'); } finally { setIsSubmitting(false); }
  };
  return (
    <div className="max-w-2xl mx-auto px-3 sm:px-4 lg:px-8 py-4 sm:py-6 lg:py-8 pb-24 md:pb-8">
      <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-slate-600 hover:text-slate-900 mb-4 sm:mb-6 font-medium transition">← Back</button>
      <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-6 lg:p-8">
        <h1 className="text-lg sm:text-xl font-bold text-slate-900 mb-2">CREATE A POST</h1>
        <p className="text-slate-500 text-sm sm:text-base mb-4 sm:mb-6">Share your thoughts with the MindShare community.</p>
        <form onSubmit={handleSubmit}>
          <textarea required value={content} onChange={e => setContent(e.target.value)} placeholder="What's on your mind?" className="w-full h-40 sm:h-48 p-3 sm:p-4 border border-slate-200 bg-white text-slate-900 placeholder-slate-400 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none text-sm sm:text-base" />
          <div className="flex flex-col sm:flex-row sm:justify-end gap-3 mt-4 sm:mt-6">
            <button type="button" onClick={() => navigate(-1)} className="order-2 sm:order-1 px-4 py-2.5 text-slate-700 hover:bg-slate-100 rounded-lg font-medium transition">Cancel</button>
            <button type="submit" disabled={isSubmitting || !content.trim()} className="order-1 sm:order-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white font-medium py-2.5 px-6 rounded-lg transition">{isSubmitting ? 'Publishing...' : 'Publish Post'}</button>
          </div>
        </form>
      </div>
    </div>
  );
};

const PostDetail = () => {
  const { id } = useParams();
  const { user, fetchNotifications } = useContext(AuthContext);
  const [post, setPost] = useState(null);
  const [comments, setComments] = useState([]);
  const [replies, setReplies] = useState({});
  const [commentText, setCommentText] = useState('');
  const [replyText, setReplyText] = useState({});
  const [showReplyBox, setShowReplyBox] = useState({});
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingPost, setEditingPost] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    setLoading(true);
    API.get(`/posts/${id}`).then(res => setPost(res.data));
    API.get(`/posts/${id}/comments`).then(async res => {
      setComments(res.data);
      const replyData = {};
      for (const comment of res.data) {
        const r = await API.get(`/comments/${comment.id}/replies`).catch(() => ({ data: [] }));
        replyData[comment.id] = r.data || [];
      }
      setReplies(replyData);
    }).finally(() => setLoading(false));
  }, [id]);

  const handleUpdatePost = async (content) => { await API.put(`/posts/${id}`, { content }); setPost({ ...post, content, updated_at: new Date().toISOString() }); };
  const handleDeletePost = async () => {
    if (!window.confirm('Are you sure you want to delete this post? This action cannot be undone.')) return;
    try { await API.delete(`/posts/${id}`); navigate('/dashboard'); } catch (err) { alert('Failed to delete post'); }
  };
  const addComment = async () => {
    if (!commentText.trim()) return;
    setIsSubmitting(true);
    try {
      const res = await API.post(`/posts/${id}/comments`, { content: commentText });
      setComments([...comments, { ...res.data, name: user.name, profile_image: user.profile_image }]);
      setCommentText(''); fetchNotifications();
    } finally { setIsSubmitting(false); }
  };
  const addReply = async (commentId) => {
    if (!replyText[commentId]?.trim()) return;
    setIsSubmitting(true);
    try {
      const res = await API.post(`/comments/${commentId}/replies`, { content: replyText[commentId] });
      setReplies({ ...replies, [commentId]: [...(replies[commentId] || []), { ...res.data, name: user.name, profile_image: user.profile_image }] });
      setReplyText({ ...replyText, [commentId]: '' }); setShowReplyBox({ ...showReplyBox, [commentId]: false }); fetchNotifications();
    } finally { setIsSubmitting(false); }
  };

  if (loading) return <div className="max-w-3xl mx-auto px-3 sm:px-4 lg:px-8 py-4 sm:py-6 lg:py-8 pb-24 md:pb-8"><Skeleton className="h-8 w-20 mb-6" /><div className="bg-white border border-slate-200 rounded-xl p-6 mb-8"><Skeleton className="h-10 w-10 rounded-full mb-4" /><Skeleton className="h-4 w-full mb-2" /><Skeleton className="h-4 w-3/4" /></div></div>;
  if (!post) return <div className="max-w-3xl mx-auto px-4 py-12 text-center"><p className="text-slate-500 font-medium">Post not found</p><button onClick={() => navigate('/dashboard')} className="mt-4 px-6 py-2 bg-indigo-600 text-white rounded-lg">Go Home</button></div>;

  return (
    <div className="max-w-3xl mx-auto px-3 sm:px-4 lg:px-8 py-4 sm:py-6 lg:py-8 pb-24 md:pb-8">
      {editingPost && <EditPostModal post={editingPost} onClose={() => setEditingPost(null)} onSave={handleUpdatePost} />}
      <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-slate-600 hover:text-slate-900 mb-4 sm:mb-6 font-medium transition">← Back</button>
      <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-6 mb-4 sm:mb-8">
        <div className="flex items-start gap-3 mb-4">
          <img src={post.profile_image || `https://ui-avatars.com/api/?name=${getInitials(post.name)}&background=6366f1&color=fff`} alt={post.name} className="w-10 h-10 sm:w-12 sm:h-12 rounded-full" />
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-slate-900 text-sm sm:text-base">{post.name}</div>
            <div className="text-xs text-slate-500">{formatRelativeTime(post.created_at)}{post.updated_at && post.updated_at !== post.created_at && <span className="italic ml-1">(edited)</span>}</div>
          </div>
          {user && user.id === post.user_id && <PostMenu post={post} onEdit={() => setEditingPost(post)} onDelete={handleDeletePost} />}
        </div>
        <p className="text-slate-900 whitespace-pre-wrap leading-relaxed text-sm sm:text-base">{post.content}</p>
      </div>
      <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-6">
        <h3 className="font-bold text-slate-900 mb-4 sm:mb-6 text-base sm:text-lg">COMMENTS ({comments.length})</h3>
        {user && (
          <div className="flex gap-2 sm:gap-3 mb-6 sm:mb-8">
            <img src={`https://ui-avatars.com/api/?name=${getInitials(user.name)}&background=6366f1&color=fff`} alt="You" className="w-8 h-8 sm:w-10 sm:h-10 rounded-full flex-shrink-0 mt-1" />
            <div className="flex-1 flex flex-col sm:flex-row gap-2">
              <input type="text" value={commentText} onChange={e => setCommentText(e.target.value)} placeholder="Write a comment..." className="flex-1 border border-slate-200 bg-white text-slate-900 placeholder-slate-400 rounded-lg px-3 sm:px-4 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm sm:text-base" onKeyDown={e => e.key === 'Enter' && !e.shiftKey && addComment()} />
              <button onClick={addComment} disabled={isSubmitting || !commentText.trim()} className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white px-4 py-2 rounded-lg font-medium transition text-sm sm:text-base">{isSubmitting ? '...' : 'Send'}</button>
            </div>
          </div>
        )}
        <div className="space-y-4 sm:space-y-6">
          {comments.map(comment => (
            <div key={comment.id} className="border-b border-slate-100 last:border-0 pb-4 sm:pb-6 last:pb-0">
              <div className="flex gap-2 sm:gap-3">
                <img src={comment.profile_image || `https://ui-avatars.com/api/?name=${getInitials(comment.name)}&background=6366f1&color=fff`} alt={comment.name} className="w-7 h-7 sm:w-8 sm:h-8 rounded-full flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-slate-900 text-xs sm:text-sm">{comment.name}</div>
                  <p className="text-slate-700 mt-1 text-sm sm:text-base break-words">{comment.content}</p>
                  <div className="flex items-center gap-3 sm:gap-4 mt-2">
                    {user && <button onClick={() => setShowReplyBox({...showReplyBox, [comment.id]: !showReplyBox[comment.id]})} className="text-xs font-medium text-slate-500 hover:text-indigo-600 transition">Reply</button>}
                    <span className="text-xs text-slate-400">{formatRelativeTime(comment.created_at)}</span>
                  </div>
                  {user && showReplyBox[comment.id] && (
                    <div className="flex gap-2 mt-3">
                      <input type="text" value={replyText[comment.id] || ''} onChange={e => setReplyText({...replyText, [comment.id]: e.target.value})} placeholder="Write a reply..." className="flex-1 border border-slate-200 bg-white text-slate-900 placeholder-slate-400 rounded-lg px-3 py-1.5 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" onKeyDown={e => e.key === 'Enter' && addReply(comment.id)} autoFocus />
                      <button onClick={() => addReply(comment.id)} disabled={isSubmitting || !replyText[comment.id]?.trim()} className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white text-xs sm:text-sm px-3 py-1.5 rounded-lg transition">Send</button>
                    </div>
                  )}
                  {(replies[comment.id] || []).length > 0 && (
                    <div className="mt-3 sm:mt-4 ml-3 sm:ml-4 pl-3 sm:pl-4 border-l-2 border-slate-200 space-y-3 sm:space-y-4">
                      {replies[comment.id].map(reply => (
                        <div key={reply.id}>
                          <div className="flex gap-2">
                            <img src={reply.profile_image || `https://ui-avatars.com/api/?name=${getInitials(reply.name)}&background=6366f1&color=fff`} alt={reply.name} className="w-6 h-6 sm:w-7 sm:h-7 rounded-full flex-shrink-0" />
                            <div className="flex-1 min-w-0">
                              <div className="font-semibold text-slate-900 text-xs">{reply.name}</div>
                              <p className="text-slate-700 text-xs sm:text-sm mt-0.5 break-words">{reply.content}</p>
                              <span className="text-xs text-slate-400 mt-1 block">{formatRelativeTime(reply.created_at)}</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

const Profile = () => {
  const { id } = useParams();
  const { user } = useContext(AuthContext);
  const [profile, setProfile] = useState(null);
  const [posts, setPosts] = useState([]);
  const [userComments, setUserComments] = useState([]);
  const [userReplies, setUserReplies] = useState([]);
  const [activeTab, setActiveTab] = useState('posts');
  const [loading, setLoading] = useState(true);
  const [editingPost, setEditingPost] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    setLoading(true);
    Promise.all([
      API.get(`/users/${id}`).then(res => setProfile(res.data)),
      API.get(`/users/${id}/posts`).then(res => setPosts(res.data)),
      API.get(`/users/${id}/comments`).then(res => { setUserComments(res.data.comments || []); setUserReplies(res.data.replies || []); })
    ]).finally(() => setLoading(false));
  }, [id]);

  const handleUpdatePost = async (postId, content) => { await API.put(`/posts/${postId}`, { content }); setPosts(posts.map(p => p.id === postId ? { ...p, content, updated_at: new Date().toISOString() } : p)); };
  const handleDeletePost = async (postId) => {
    if (!window.confirm('Are you sure you want to delete this post?')) return;
    try { await API.delete(`/posts/${postId}`); setPosts(posts.filter(p => p.id !== postId)); } catch (err) { alert('Failed to delete post'); }
  };

  if (loading) return <div className="max-w-3xl mx-auto px-4 py-8"><div className="bg-white border border-slate-200 rounded-xl p-8 text-center mb-8"><Skeleton className="w-24 h-24 rounded-full mx-auto mb-4" /><Skeleton className="h-6 w-40 mx-auto mb-2" /><Skeleton className="h-4 w-32 mx-auto" /></div></div>;
  if (!profile) return <div className="max-w-3xl mx-auto px-4 py-12 text-center"><p className="text-slate-500 font-medium">User not found</p><button onClick={() => navigate('/dashboard')} className="mt-4 px-6 py-2 bg-indigo-600 text-white rounded-lg">Go Home</button></div>;

  const isOwnProfile = user && user.id === parseInt(id);
  const totalComments = userComments.length + userReplies.length;

  return (
    <div className="max-w-3xl mx-auto px-3 sm:px-4 lg:px-8 py-4 sm:py-6 lg:py-8 pb-24 md:pb-8">
      {editingPost && <EditPostModal post={editingPost} onClose={() => setEditingPost(null)} onSave={(content) => handleUpdatePost(editingPost.id, content)} />}
      <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-slate-600 hover:text-slate-900 mb-4 sm:mb-6 font-medium transition">← Back</button>
      <div className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8 text-center mb-6 sm:mb-8">
        <img src={`https://ui-avatars.com/api/?name=${getInitials(profile.name)}&background=6366f1&color=fff&size=128`} alt={profile.name} className="w-20 h-20 sm:w-24 sm:h-24 rounded-full mx-auto mb-4" />
        <h1 className="text-xl sm:text-2xl font-bold text-slate-900">{profile.name}</h1>
        <p className="text-slate-500 text-sm sm:text-base mt-1">MindShare Member</p>
        {isOwnProfile && <p className="text-xs sm:text-sm text-slate-400 mt-2 truncate">{profile.email}</p>}
        <div className="flex justify-center gap-6 sm:gap-8 mt-6 pt-6 border-t border-slate-200">
          <div className="text-center"><div className="text-xl sm:text-2xl font-bold text-slate-900">{posts.length}</div><div className="text-xs text-slate-500 uppercase tracking-wide">Posts</div></div>
          <div className="text-center"><div className="text-xl sm:text-2xl font-bold text-slate-900">{totalComments}</div><div className="text-xs text-slate-500 uppercase tracking-wide">Comments</div></div>
        </div>
      </div>
      <div className="flex border-b border-slate-200 mb-4 sm:mb-6 bg-white rounded-t-xl overflow-hidden">
        <button onClick={() => setActiveTab('posts')} className={`flex-1 py-3 text-xs sm:text-sm font-semibold transition ${activeTab === 'posts' ? 'text-indigo-600 border-b-2 border-indigo-600 bg-indigo-50/30' : 'text-slate-500 hover:text-slate-900'}`}>Posts ({posts.length})</button>
        <button onClick={() => setActiveTab('comments')} className={`flex-1 py-3 text-xs sm:text-sm font-semibold transition ${activeTab === 'comments' ? 'text-indigo-600 border-b-2 border-indigo-600 bg-indigo-50/30' : 'text-slate-500 hover:text-slate-900'}`}>Comments ({totalComments})</button>
      </div>
      {activeTab === 'posts' && (
        <>
          {posts.length === 0 ? <div className="text-center py-12 bg-white border border-slate-200 rounded-xl"><p className="text-slate-500 font-medium">No posts yet</p></div> : (
            <div className="space-y-3 sm:space-y-4">
              {posts.map(post => (
                <div key={post.id} className="bg-white border border-slate-200 rounded-xl p-4 sm:p-6 relative">
                  <div className="flex items-start gap-2 mb-2">
                    <p className="text-slate-900 flex-1 whitespace-pre-wrap text-sm sm:text-base">{post.content}</p>
                    {isOwnProfile && <PostMenu post={post} onEdit={() => setEditingPost(post)} onDelete={() => handleDeletePost(post.id)} />}
                  </div>
                  <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 text-xs sm:text-sm text-slate-500">
                    <Link to={`/post/${post.id}`} className="hover:text-indigo-600 font-medium">💬 {post.comment_count || 0} Comments</Link>
                    <div className="flex items-center gap-3 sm:gap-4"><span>{formatRelativeTime(post.created_at)}{post.updated_at && post.updated_at !== post.created_at && <span className="italic ml-1">(edited)</span>}</span></div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
      {activeTab === 'comments' && (
        <>
          {userComments.length === 0 && userReplies.length === 0 ? <div className="text-center py-12 bg-white border border-slate-200 rounded-xl"><p className="text-slate-500 font-medium">No comments yet</p><p className="text-slate-400 text-sm mt-2">Join a discussion!</p></div> : (
            <div className="space-y-3 sm:space-y-4">
              {userComments.map(comment => (
                <div key={`c_${comment.id}`} className="bg-white border border-slate-200 rounded-xl p-4 sm:p-6">
                  <div className="flex items-start gap-3 mb-3"><div className="bg-indigo-100 text-indigo-600 text-xs font-bold px-2 py-1 rounded">COMMENT</div></div>
                  <p className="text-slate-900 mb-3 whitespace-pre-wrap text-sm sm:text-base">{comment.content}</p>
                  <div className="bg-slate-50 border-l-2 border-slate-300 p-3 rounded-r-lg mb-3">
                    <p className="text-xs text-slate-500 mb-1">On post by <span className="font-semibold text-slate-700">{comment.post_author_name}</span></p>
                    <p className="text-xs sm:text-sm text-slate-600 line-clamp-2">{comment.post_content}</p>
                  </div>
                  <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 text-xs sm:text-sm text-slate-500">
                    <Link to={`/post/${comment.post_id}`} className="hover:text-indigo-600 font-medium">View post →</Link>
                    <span>{formatRelativeTime(comment.created_at)}</span>
                  </div>
                </div>
              ))}
              {userReplies.map(reply => (
                <div key={`r_${reply.id}`} className="bg-white border border-slate-200 rounded-xl p-4 sm:p-6">
                  <div className="flex items-start gap-3 mb-3"><div className="bg-purple-100 text-purple-600 text-xs font-bold px-2 py-1 rounded">REPLY</div></div>
                  <p className="text-slate-900 mb-3 whitespace-pre-wrap text-sm sm:text-base">{reply.content}</p>
                  <div className="bg-slate-50 border-l-2 border-slate-300 p-3 rounded-r-lg mb-3">
                    <p className="text-xs text-slate-500 mb-1">Replying on post by <span className="font-semibold text-slate-700">{reply.post_author_name}</span></p>
                    <p className="text-xs sm:text-sm text-slate-600 line-clamp-2">{reply.post_content}</p>
                  </div>
                  <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 text-xs sm:text-sm text-slate-500">
                    <Link to={`/post/${reply.post_id}`} className="hover:text-indigo-600 font-medium">View post →</Link>
                    <span>{formatRelativeTime(reply.created_at)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
};

// --- AUTH COMPONENTS ---
const GoogleButton = ({ onSuccess }) => {
  const buttonRef = useRef(null);
  useEffect(() => {
    let attempts = 0;
    const maxAttempts = 15;
    const initGoogle = () => {
      if (!window.google || !window.google.accounts || !window.google.accounts.id) {
        if (attempts < maxAttempts) { attempts++; setTimeout(initGoogle, 500); }
        return;
      }
      try {
        window.google.accounts.id.initialize({
          client_id: '472201379054-lttri42ksmnh5flgfv9562p7oie2tcd5.apps.googleusercontent.com', // ⚠️ REPLACE THIS WITH YOUR ACTUAL CLIENT ID
          callback: (response) => { if (response.credential) onSuccess(response.credential); },
          auto_select: false, cancel_on_tap_outside: true, context: 'signin', ux_mode: 'popup'
        });
        if (buttonRef.current) {
          window.google.accounts.id.renderButton(buttonRef.current, { theme: 'outline', size: 'large', width: '100%', text: 'continue_with', shape: 'rectangular', logo_alignment: 'center', type: 'standard' });
        }
      } catch (err) { console.error('Google initialization error:', err); }
    };
    initGoogle();
    return () => { attempts = maxAttempts; };
  }, [onSuccess]);
  return <div className="w-full mt-4 flex justify-center"><div ref={buttonRef}></div></div>;
};

const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { login, googleLogin } = useContext(AuthContext);
  const location = useLocation();
  const successMessage = location.state?.success;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError('');
    try { await login(email, password); } catch (err) { setError(err.response?.data?.error || 'Sign in failed'); } finally { setIsSubmitting(false); }
  };

  const handleGoogleSuccess = async (credential) => {
    try { await googleLogin(credential); } catch (err) { setError('Google sign in failed. Please try again.'); }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-8 sm:py-12 px-4">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center mb-6 sm:mb-8">
        <h1 className="text-3xl sm:text-4xl font-bold text-indigo-600 mb-2">MindShare</h1>
        <p className="mt-2 text-slate-500 text-sm sm:text-base">Share ideas. Join discussions.</p>
      </div>
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white border border-slate-200 rounded-xl py-6 sm:py-8 px-5 sm:px-6 shadow-sm">
          <h2 className="text-lg sm:text-xl font-semibold text-slate-900 mb-4 sm:mb-6">Welcome back</h2>
          {error && <div className="mb-4 bg-red-50 text-red-600 p-3 rounded-lg text-sm border border-red-100">{error}</div>}
          {successMessage && <div className="mb-4 bg-green-50 text-green-700 p-3 rounded-lg text-sm border border-green-100">{successMessage}</div>}
          <form className="space-y-4 sm:space-y-5" onSubmit={handleSubmit}>
            <div>
              <label className="block text-xs sm:text-sm font-medium text-slate-700 mb-1">Email</label>
              <input type="email" required value={email} onChange={e => setEmail(e.target.value)} className="w-full border border-slate-200 bg-white text-slate-900 placeholder-slate-400 rounded-lg px-3 sm:px-4 py-2 sm:py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm sm:text-base" placeholder="enter your email" />
            </div>
            <div>
              <label className="block text-xs sm:text-sm font-medium text-slate-700 mb-1">Password</label>
              <input type="password" required value={password} onChange={e => setPassword(e.target.value)} className="w-full border border-slate-200 bg-white text-slate-900 placeholder-slate-400 rounded-lg px-3 sm:px-4 py-2 sm:py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm sm:text-base" placeholder="enter your password" />
            </div>
            <button type="submit" disabled={isSubmitting} className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white font-medium py-2 sm:py-2.5 rounded-lg transition text-sm sm:text-base">{isSubmitting ? 'Signing in...' : 'Sign In'}</button>
          </form>
          <div className="mt-5 sm:mt-6">
            <div className="relative">
              <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-200"></div></div>
              <div className="relative flex justify-center text-xs sm:text-sm"><span className="px-4 bg-white text-slate-500">OR</span></div>
            </div>
            <GoogleButton onSuccess={handleGoogleSuccess} />
          </div>
          <p className="mt-5 sm:mt-6 text-center text-xs sm:text-sm text-slate-600">Don't have an account? <Link to="/register" className="font-medium text-indigo-600 hover:text-indigo-700">Create account</Link></p>
        </div>
      </div>
    </div>
  );
};

const Register = () => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { register, googleLogin } = useContext(AuthContext);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError('');
    try { await register(name, email, password, confirmPassword); } catch (err) { setError(err.response?.data?.error || 'Registration failed'); } finally { setIsSubmitting(false); }
  };

  const handleGoogleSuccess = async (credential) => {
    try { await googleLogin(credential); } catch (err) { setError('Google sign in failed. Please try again.'); }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-8 sm:py-12 px-4">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white border border-slate-200 rounded-xl py-6 sm:py-8 px-5 sm:px-6 shadow-sm">
          <h2 className="text-lg sm:text-xl font-semibold text-slate-900 mb-4 sm:mb-6 text-center">Create your account</h2>
          {error && <div className="mb-4 bg-red-50 text-red-600 p-3 rounded-lg text-sm border border-red-100">{error}</div>}
          <form className="space-y-3 sm:space-y-4" onSubmit={handleSubmit}>
            <div>
              <label className="block text-xs sm:text-sm font-medium text-slate-700 mb-1">Full Name</label>
              <input type="text" required value={name} onChange={e => setName(e.target.value)} className="w-full border border-slate-200 bg-white text-slate-900 placeholder-slate-400 rounded-lg px-3 sm:px-4 py-2 sm:py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm sm:text-base" placeholder="enter your fullname" />
            </div>
            <div>
              <label className="block text-xs sm:text-sm font-medium text-slate-700 mb-1">Email</label>
              <input type="email" required value={email} onChange={e => setEmail(e.target.value)} className="w-full border border-slate-200 bg-white text-slate-900 placeholder-slate-400 rounded-lg px-3 sm:px-4 py-2 sm:py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm sm:text-base" placeholder="enter your email" />
            </div>
            <div>
              <label className="block text-xs sm:text-sm font-medium text-slate-700 mb-1">Password</label>
              <input type="password" required value={password} onChange={e => setPassword(e.target.value)} className="w-full border border-slate-200 bg-white text-slate-900 placeholder-slate-400 rounded-lg px-3 sm:px-4 py-2 sm:py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm sm:text-base" placeholder="create password" />
            </div>
            <div>
              <label className="block text-xs sm:text-sm font-medium text-slate-700 mb-1">Confirm Password</label>
              <input type="password" required value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} className="w-full border border-slate-200 bg-white text-slate-900 placeholder-slate-400 rounded-lg px-3 sm:px-4 py-2 sm:py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm sm:text-base" placeholder="confirm password" />
            </div>
            <button type="submit" disabled={isSubmitting} className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white font-medium py-2 sm:py-2.5 rounded-lg transition text-sm sm:text-base mt-2">{isSubmitting ? 'Creating account...' : 'Create Account'}</button>
          </form>
          <div className="mt-5 sm:mt-6">
            <div className="relative">
              <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-200"></div></div>
              <div className="relative flex justify-center text-xs sm:text-sm"><span className="px-4 bg-white text-slate-500">OR</span></div>
            </div>
            <GoogleButton onSuccess={handleGoogleSuccess} />
          </div>
          <p className="mt-5 sm:mt-6 text-center text-xs sm:text-sm text-slate-600">Already have an account? <Link to="/login" className="font-medium text-indigo-600 hover:text-indigo-700">Sign In</Link></p>
        </div>
      </div>
    </div>
  );
};

// --- MAIN APP ---
function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <div className="min-h-screen bg-slate-50 text-slate-900">
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/*" element={
              <>
                <TopBar />
                <Routes>
                  <Route path="/dashboard" element={<Dashboard />} />
                  <Route path="/create" element={<CreatePost />} />
                  <Route path="/post/:id" element={<PostDetail />} />
                  <Route path="/profile/:id" element={<Profile />} />
                  <Route path="*" element={<Dashboard />} />
                </Routes>
                <BottomNav />
                <ScrollToTop />
              </>
            } />
          </Routes>
        </div>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;