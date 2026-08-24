import React, { useState, useEffect, createContext, useContext } from 'react';
import { BrowserRouter as Router, Routes, Route, useNavigate, useParams, Link } from 'react-router-dom';
import axios from 'axios';
import { GoogleOAuthProvider, GoogleLogin } from '@react-oauth/google';
import { Menu, User, LogOut, Home, PenLine, ArrowLeft, MessageCircle, Trash2, Edit3, Save, X } from 'lucide-react';

// --- CONFIGURATION ---
const API_URL = 'http://localhost:5000/api';
const GOOGLE_CLIENT_ID = '505107838201-19u5tmj64hkj55pgcufc2ulqf0vuhtj5.apps.googleusercontent.com'; // ⚠️ REPLACE THIS

const api = axios.create({ baseURL: API_URL });
// Bulletproof Token Interceptor
api.interceptors.request.use(config => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// --- AUTH CONTEXT ---
const AuthContext = createContext();
const useAuth = () => useContext(AuthContext);

const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('token');
    const savedUser = localStorage.getItem('user');
    if (token && savedUser) {
      setUser(JSON.parse(savedUser));
    }
    setLoading(false);
  }, []);

  const login = (userData, token) => {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(userData));
    setUser(userData);
    window.location.href = '/dashboard';
  };

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
    window.location.href = '/login';
  };

  return <AuthContext.Provider value={{ user, loading, login, logout }}>{children}</AuthContext.Provider>;
};

// --- LAYOUT COMPONENTS ---
const Navbar = ({ toggleMenu, toggleProfile }) => {
  const { user } = useAuth();
  return (
    <nav className="bg-white border-b border-slate-200 sticky top-0 z-50">
      <div className="max-w-4xl mx-auto px-4 h-16 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={toggleMenu} className="p-2 hover:bg-slate-100 rounded-lg text-slate-600"><Menu size={24} /></button>
          <log className="text-xl font-bold text-indigo-600 flex items-center gap-2"> MindShare</log>
        </div>
        <button onClick={toggleProfile} className="flex items-center gap-2 p-1 pr-3 hover:bg-slate-100 rounded-full border border-transparent hover:border-slate-200 transition">
          <img src={user?.profileImage || `https://ui-avatars.com/api/?name=${user?.name}`} alt="Profile" className="w-8 h-8 rounded-full" />
          <span className="text-sm font-medium text-slate-900 hidden sm:block">{user?.name}</span>
        </button>
      </div>
    </nav>
  );
};

const SidebarMenu = ({ isOpen, close }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-black/30" onClick={close}></div>
      <div className="relative bg-white w-64 h-full shadow-xl border-r border-slate-200 p-4 flex flex-col">
        <div className="flex items-center justify-between mb-6">
          <span className="text-xl font-bold text-indigo-600"> MindShare</span>
          <button onClick={close} className="p-1 hover:bg-slate-100 rounded"><X size={20} /></button>
        </div>
        <nav className="flex flex-col gap-2">
          <Link to="/dashboard" onClick={close} className="flex items-center gap-3 p-3 rounded-lg hover:bg-slate-50 text-slate-700 font-medium"><Home size={20} className="text-indigo-600" /> Home</Link>
          <Link to="/create-post" onClick={close} className="flex items-center gap-3 p-3 rounded-lg hover:bg-slate-50 text-slate-700 font-medium"><PenLine size={20} className="text-indigo-600" /> Create Post</Link>
        </nav>
      </div>
    </div>
  );
};

const ProfileDropdown = ({ isOpen, close }) => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end pt-16 pr-4">
      <div className="absolute inset-0" onClick={close}></div>
      <div className="relative bg-white w-64 rounded-xl shadow-xl border border-slate-200 overflow-hidden">
        <div className="p-4 border-b border-slate-200">
          <p className="font-bold text-slate-900">{user?.name}</p>
          <p className="text-sm text-slate-500 truncate">{user?.email}</p>
        </div>
        <div className="py-2">
          <button onClick={() => { navigate(`/profile/${user?.id}`); close(); }} className="w-full flex items-center gap-3 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"><User size={18} /> My Profile</button>
        </div>
        <div className="border-t border-slate-200 py-2">
          <button onClick={() => { logout(); close(); }} className="w-full flex items-center gap-3 px-4 py-2 text-sm text-red-600 hover:bg-red-50"><LogOut size={18} /> Logout</button>
        </div>
      </div>
    </div>
  );
};

// --- PAGE COMPONENTS ---
const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const { login } = useAuth();

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const res = await api.post('/auth/login', { email, password });
      login(res.data.user, res.data.token);
    } catch (err) { setError(err.response?.data?.message || 'Login failed'); }
  };

  const handleGoogle = async (res) => {
    try {
      const response = await api.post('/auth/google', { credential: res.credential });
      login(response.data.user, response.data.token);
    } catch { setError('Google login failed'); }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm w-full max-w-md p-8">
        <div className="text-center mb-8">
          <div className="text-4xl mb-2"></div>
          <h1 className="text-2xl font-bold text-slate-900">MindShare</h1>
          <p className="text-slate-500 mt-2">Share ideas. Join discussions.</p>
        </div>
        {error && <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm mb-4 text-center">{error}</div>}
        <form onSubmit={handleSubmit} className="space-y-4">
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="Email" className="w-full p-3 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none" />
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} required placeholder="Password" className="w-full p-3 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none" />
          <button type="submit" className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-3 rounded-lg transition">Sign In</button>
        </form>
        <div className="relative my-6"><div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-200"></div></div><div className="relative flex justify-center text-sm"><span className="px-2 bg-white text-slate-500">OR</span></div></div>
        <div className="flex justify-center mb-6"><GoogleLogin onSuccess={handleGoogle} onError={() => setError('Google login failed')} width="300" /></div>
        <p className="text-center text-sm text-slate-600">Don't have an account? <Link to="/register" className="text-indigo-600 font-semibold hover:underline">Create account</Link></p>
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
  const { login } = useAuth();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (password !== confirmPassword) return setError('Passwords do not match');
    try {
      const res = await api.post('/auth/register', { name, email, password });
      login(res.data.user, res.data.token);
    } catch (err) { setError(err.response?.data?.message || 'Registration failed'); }
  };

  const handleGoogle = async (res) => {
    try {
      const response = await api.post('/auth/google', { credential: res.credential });
      login(response.data.user, response.data.token);
    } catch { setError('Google login failed'); }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm w-full max-w-md p-8">
        <h2 className="text-2xl font-bold text-center text-slate-900 mb-6">Create your account</h2>
        {error && <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm mb-4 text-center">{error}</div>}
        <form onSubmit={handleSubmit} className="space-y-4">
          <input type="text" value={name} onChange={e => setName(e.target.value)} required placeholder="Full Name" className="w-full p-3 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none" />
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="Email" className="w-full p-3 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none" />
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} required placeholder="Password" className="w-full p-3 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none" />
          <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required placeholder="Confirm Password" className="w-full p-3 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none" />
          <button type="submit" className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-3 rounded-lg transition">Create Account</button>
        </form>
        <div className="relative my-6"><div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-200"></div></div><div className="relative flex justify-center text-sm"><span className="px-2 bg-white text-slate-500">OR</span></div></div>
        <div className="flex justify-center mb-6"><GoogleLogin onSuccess={handleGoogle} onError={() => setError('Google login failed')} width="300" /></div>
        <p className="text-center text-sm text-slate-600">Already have an account? <Link to="/login" className="text-indigo-600 font-semibold hover:underline">Sign In</Link></p>
      </div>
    </div>
  );
};

const PostCard = ({ post, showActions = true, onUpdate }) => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(post.content);
  const isOwner = user?.id === post.userId?._id || user?.id === post.userId;

  const handleDelete = async () => {
    if (window.confirm('Delete this post?')) {
      await api.delete(`/posts/${post._id}`);
      window.location.reload();
    }
  };

  const handleSave = async () => {
    if (!editContent.trim()) return;
    const res = await api.put(`/posts/${post._id}`, { content: editContent });
    setIsEditing(false);
    if (onUpdate) onUpdate(res.data);
    else window.location.reload();
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 mb-4">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <img src={post.userId?.profileImage || `https://ui-avatars.com/api/?name=${post.userId?.name}`} alt="" className="w-10 h-10 rounded-full" />
          <div>
            <p className="font-semibold text-slate-900">{post.userId?.name}</p>
            <p className="text-xs text-slate-500">{new Date(post.createdAt).toLocaleString()}</p>
          </div>
        </div>
        {showActions && isOwner && !isEditing && (
          <div className="flex gap-2">
            <button onClick={() => setIsEditing(true)} className="p-1 text-slate-400 hover:text-indigo-600"><Edit3 size={18} /></button>
            <button onClick={handleDelete} className="p-1 text-slate-400 hover:text-red-600"><Trash2 size={18} /></button>
          </div>
        )}
      </div>
      
      {isEditing ? (
        <div className="mb-4">
          <textarea value={editContent} onChange={e => setEditContent(e.target.value)} className="w-full p-3 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none" rows="3" />
          <div className="flex gap-2 mt-2 justify-end">
            <button onClick={() => { setIsEditing(false); setEditContent(post.content); }} className="px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 rounded-lg flex items-center gap-1"><X size={16} /> Cancel</button>
            <button onClick={handleSave} className="px-3 py-1.5 text-sm bg-indigo-600 text-white hover:bg-indigo-700 rounded-lg flex items-center gap-1"><Save size={16} /> Save</button>
          </div>
        </div>
      ) : (
        <p className="text-slate-900 mb-4 whitespace-pre-wrap leading-relaxed">{post.content}</p>
      )}
      
      {!isEditing && (
        <button onClick={() => navigate(`/post/${post._id}`)} className="flex items-center gap-2 text-sm text-slate-500 hover:text-indigo-600 font-medium transition">
          <MessageCircle size={18} /> View Comments →
        </button>
      )}
    </div>
  );
};

const Dashboard = () => {
  const [posts, setPosts] = useState([]);
  useEffect(() => { api.get('/posts').then(res => setPosts(res.data)).catch(console.error); }, []);
  const updatePost = (updated) => setPosts(posts.map(p => p._id === updated._id ? updated : p));

  return (
    <div className="max-w-2xl mx-auto p-4">
      <h2 className="text-xl font-bold text-slate-900 mb-1">SEE SHARED ACTIVITY</h2>
      <p className="text-slate-500 mb-6">Stay updated with recent posts, comments and interactions from your community</p>
      {posts.length === 0 ? <p className="text-center text-slate-500 py-10">No posts yet. Be the first to share!</p> : posts.map(p => <PostCard key={p._id} post={p} onUpdate={updatePost} />)}
    </div>
  );
};

const CreatePost = () => {
  const [content, setContent] = useState('');
  const navigate = useNavigate();
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!content.trim()) return;
    await api.post('/posts', { content });
    navigate('/dashboard');
  };
  return (
    <div className="max-w-2xl mx-auto p-4">
      <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-slate-500 hover:text-slate-900 mb-6 font-medium"><ArrowLeft size={20} /> Back</button>
      <h2 className="text-2xl font-bold text-slate-900 mb-2">CREATE A POST</h2>
      <p className="text-slate-500 mb-6">Share your thoughts with the MindShare community.</p>
      <form onSubmit={handleSubmit} className="bg-white border border-slate-200 rounded-xl p-6">
        <textarea value={content} onChange={e => setContent(e.target.value)} placeholder="What's on your mind?" className="w-full h-40 p-4 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none resize-none" required />
        <div className="flex justify-end mt-4"><button type="submit" className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold px-6 py-2.5 rounded-lg transition">Publish Post</button></div>
      </form>
    </div>
  );
};

const PostDetail = () => {
  const { id } = useParams();
  const [post, setPost] = useState(null);
  const [comments, setComments] = useState([]);
  const [newComment, setNewComment] = useState('');
  const { user } = useAuth();

  useEffect(() => {
    const fetchData = async () => {
      const [postRes, commentRes] = await Promise.all([api.get(`/posts/${id}`), api.get(`/posts/${id}/comments`)]);
      setPost(postRes.data);
      setComments(commentRes.data);
    };
    fetchData();
  }, [id]);

  const addComment = async (e) => {
    e.preventDefault();
    if (!newComment.trim()) return;
    const res = await api.post(`/posts/${id}/comments`, { content: newComment });
    setComments([...comments, res.data]);
    setNewComment('');
  };

  const addReply = async (commentId, content) => {
    const res = await api.post(`/comments/${commentId}/replies`, { content });
    setComments(comments.map(c => c._id === commentId ? res.data : c));
  };

  if (!post) return <div className="max-w-2xl mx-auto p-4 text-center text-slate-500">Loading...</div>;

  return (
    <div className="max-w-2xl mx-auto p-4">
      <button onClick={() => window.history.back()} className="flex items-center gap-2 text-slate-500 hover:text-slate-900 mb-6 font-medium"><ArrowLeft size={20} /> Back</button>
      <PostCard post={post} showActions={true} />
      
      <div className="bg-white border border-slate-200 rounded-xl p-6 mt-6">
        <h3 className="font-bold text-slate-900 mb-6">COMMENTS ({comments.length})</h3>
        <div className="space-y-6 mb-8">
          {comments.map(comment => (
            <div key={comment._id}>
              <div className="flex gap-3">
                <img src={comment.userId?.profileImage} alt="" className="w-8 h-8 rounded-full flex-shrink-0" />
                <div className="flex-1">
                  <p className="font-semibold text-slate-900 text-sm">{comment.userId?.name}</p>
                  <p className="text-slate-700 mt-1">{comment.content}</p>
                  <button onClick={() => document.getElementById(`reply-${comment._id}`).classList.toggle('hidden')} className="text-xs font-medium text-indigo-600 hover:underline mt-2">Reply</button>
                  
                  <form id={`reply-${comment._id}`} className="hidden mt-3 flex gap-2" onSubmit={async (e) => {
                    e.preventDefault();
                    const input = e.target.querySelector('input');
                    if (input.value.trim()) { await addReply(comment._id, input.value); input.value = ''; }
                  }}>
                    <input type="text" placeholder="Write a reply..." className="flex-1 p-2 text-sm border border-slate-200 rounded-lg focus:ring-1 focus:ring-indigo-500 outline-none" />
                    <button type="submit" className="bg-indigo-600 text-white text-xs font-semibold px-3 py-2 rounded-lg hover:bg-indigo-700">Send</button>
                  </form>

                  {comment.replies && comment.replies.length > 0 && (
                    <div className="mt-4 ml-4 pl-4 border-l-2 border-slate-200 space-y-4">
                      {comment.replies.map(reply => (
                        <div key={reply._id} className="flex gap-3">
                          <img src={reply.userId?.profileImage} alt="" className="w-6 h-6 rounded-full flex-shrink-0" />
                          <div>
                            <p className="font-semibold text-slate-900 text-xs">{reply.userId?.name}</p>
                            <p className="text-slate-700 text-sm mt-0.5">{reply.content}</p>
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
        <form onSubmit={addComment} className="flex gap-3 border-t border-slate-200 pt-6">
          <img src={user?.profileImage} alt="" className="w-8 h-8 rounded-full flex-shrink-0" />
          <input value={newComment} onChange={e => setNewComment(e.target.value)} placeholder="Write a comment..." className="flex-1 p-3 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none" />
          <button type="submit" className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold px-5 py-2 rounded-lg transition">Send</button>
        </form>
      </div>
    </div>
  );
};

const Profile = () => {
  const { id } = useParams();
  const { user: currentUser } = useAuth();
  const [profileUser, setProfileUser] = useState(null);
  const [posts, setPosts] = useState([]);

  useEffect(() => {
    const fetchData = async () => {
      const [userRes, postsRes] = await Promise.all([api.get(`/users/${id}`), api.get(`/users/${id}/posts`)]);
      setProfileUser(userRes.data);
      setPosts(postsRes.data);
    };
    fetchData();
  }, [id]);

  if (!profileUser) return <div className="max-w-2xl mx-auto p-4 text-center text-slate-500">Loading...</div>;

  return (
    <div className="max-w-2xl mx-auto p-4">
      <button onClick={() => window.history.back()} className="flex items-center gap-2 text-slate-500 hover:text-slate-900 mb-6 font-medium"><ArrowLeft size={20} /> Back</button>
      <div className="bg-white border border-slate-200 rounded-xl p-8 text-center mb-8">
        <img src={profileUser.profileImage} alt="" className="w-24 h-24 rounded-full mx-auto mb-4 border-4 border-slate-50" />
        <h2 className="text-2xl font-bold text-slate-900">{profileUser.name}</h2>
        <p className="text-slate-500 mt-1">MindShare Member</p>
      </div>
      <h3 className="text-lg font-bold text-slate-900 mb-4 px-1">MY POSTS</h3>
      {posts.length === 0 ? <p className="text-center text-slate-500 py-8 bg-white border border-slate-200 rounded-xl">No posts yet.</p> : posts.map(p => <PostCard key={p._id} post={p} showActions={currentUser?.id === profileUser._id} />)}
    </div>
  );
};

// --- MAIN APP SHELL ---
const AppShell = () => {
  const { user, loading } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  if (loading) return <div className="min-h-screen bg-slate-50 flex items-center justify-center text-slate-500">Loading...</div>;

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="*" element={<Login />} />
      </Routes>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <Navbar toggleMenu={() => setMenuOpen(true)} toggleProfile={() => setProfileOpen(!profileOpen)} />
      <SidebarMenu isOpen={menuOpen} close={() => setMenuOpen(false)} />
      <ProfileDropdown isOpen={profileOpen} close={() => setProfileOpen(false)} />
      <main className="pt-4 pb-12">
        <Routes>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/create-post" element={<CreatePost />} />
          <Route path="/post/:id" element={<PostDetail />} />
          <Route path="/profile/:id" element={<Profile />} />
          <Route path="*" element={<Dashboard />} />
        </Routes>
      </main>
    </div>
  );
};

export default function Root() {
  return (
    <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
      <AuthProvider>
        <Router>
          <AppShell />
        </Router>
      </AuthProvider>
    </GoogleOAuthProvider>
  );
}