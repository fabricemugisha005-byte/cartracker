import React, { useState, useEffect, createContext, useContext, useRef } from 'react';
import { BrowserRouter as Router, Routes, Route, useNavigate, useParams, Link, useSearchParams, useLocation } from 'react-router-dom';
import axios from 'axios';
import io from 'socket.io-client';
import { GoogleLogin, GoogleOAuthProvider } from '@react-oauth/google';
import {
  Home, FileText, Bookmark, Users, Bell, User, Settings, Search,
  MessageCircle, Heart, MoreHorizontal, Eye, Plus, Flag,
  Mail, Lock, LinkIcon, X, Edit3, Trash2, Save, Hash,
  Send, Reply, ChevronDown, LogOut, Menu, CheckCircle, BarChart2, Shield, Sparkles, Megaphone,
  LayoutDashboard, AlertTriangle, FolderOpen, MessageSquare, FileBarChart, UserPlus
} from 'lucide-react';

const GlobalStyles = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
    @keyframes shimmer {
      0% { background-position: -200% 0; }
      100% { background-position: 200% 0; }
    }
    .shimmer-bg {
      background: linear-gradient(90deg, #f1f5f9 25%, #e2e8f0 50%, #f1f5f9 75%);
      background-size: 200% 100%;
      animation: shimmer 0.9s infinite;
    }
    .dark .shimmer-bg {
      background: linear-gradient(90deg, #1e293b 25%, #334155 50%, #1e293b 75%);
      background-size: 200% 100%;
    }
    body { font-family: 'Inter', sans-serif; }
  `}</style>
);

const API_URL = import.meta.env.VITE_API_URL || process.env.REACT_APP_API_URL || 'http://localhost:5000/api';
const SOCKET_URL = API_URL.replace('/api', '');
const GOOGLE_CLIENT_ID = '472201379054-8cv9lm1652m5vf3ed37oo26vkmrrau1m.apps.googleusercontent.com';

const api = axios.create({ baseURL: API_URL });
api.interceptors.request.use(config => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

const Skeleton = ({ className }) => <div className={`shimmer-bg rounded-lg ${className}`}></div>;

const ThemeContext = createContext();
const ThemeProvider = ({ children }) => {
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'light');
  useEffect(() => {
    localStorage.setItem('theme', theme);
    if (theme === 'dark') document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
  }, [theme]); 
  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
};

const AuthContext = createContext();
const useAuth = () => useContext(AuthContext);
const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const token = localStorage.getItem('token');
    const savedUser = localStorage.getItem('user');
    if (token && savedUser && savedUser !== 'undefined') {
      try {
        const parsed = JSON.parse(savedUser);
        if (parsed && (parsed.id || parsed._id)) {
          parsed.id = parsed.id || parsed._id;
          setUser(parsed);
        } else {
          localStorage.removeItem('token');
          localStorage.removeItem('user');
        }
      } catch (e) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
      }
    }
    setLoading(false);
  }, []);
  
  const login = (userData, token) => {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(userData));
    setUser(userData);
    window.location.href = userData.isAdmin ? '/admin' : '/dashboard';
  };
  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
    window.location.href = '/login';
  };
  const updateUser = (newData) => {
    const updatedUser = { ...user, ...newData };
    localStorage.setItem('user', JSON.stringify(updatedUser));
    setUser(updatedUser);
  };
  if (loading) return <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-black"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div></div>;
  return <AuthContext.Provider value={{ user, login, logout, updateUser }}>{children}</AuthContext.Provider>;
};

const Badge = ({ type }) => {
  const colors = {
    Education: 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-800',
    Technology: 'bg-purple-100 text-purple-700 border-purple-200 dark:bg-purple-900/20 dark:text-purple-400 dark:border-purple-800',
    Science: 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-800',
    Society: 'bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-900/20 dark:text-orange-400 dark:border-orange-800',
    Lifestyle: 'bg-pink-100 text-pink-700 border-pink-200 dark:bg-pink-900/20 dark:text-pink-400 dark:border-pink-800',
    Business: 'bg-indigo-100 text-indigo-700 border-indigo-200 dark:bg-indigo-900/20 dark:text-indigo-400 dark:border-indigo-800',
    Creativity: 'bg-yellow-100 text-yellow-700 border-yellow-200 dark:bg-yellow-900/20 dark:text-yellow-400 dark:border-yellow-800'
  };
  return <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium border ${colors[type] || 'bg-gray-100 text-gray-700 border-gray-200 dark:bg-zinc-800 dark:text-zinc-400 dark:border-zinc-700'}`}>{type}</span>;
};

const timeAgo = (date) => {
  const seconds = Math.floor((new Date() - new Date(date)) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
};

const OnlineUsers = () => {
  const [onlineUsers, setOnlineUsers] = useState([]);
  const { user } = useAuth();
  const socketRef = useRef(null);

  useEffect(() => {
    if (!user) return;
    socketRef.current = io(SOCKET_URL, { auth: { token: localStorage.getItem('token') } });
    socketRef.current.emit('joinOnline');
    
    socketRef.current.on('onlineUsers', (users) => {
      const filtered = users.filter(u => u._id !== user.id).slice(0, 5);
      setOnlineUsers(filtered);
    });
    socketRef.current.on('userOnline', (userData) => {
      if (userData._id !== user.id) {
        setOnlineUsers(prev => {
          const exists = prev.find(u => u._id === userData._id);
          if (!exists && prev.length < 5) return [...prev, userData];
          return prev;
        });
      }
    });
    socketRef.current.on('userOffline', (userId) => {
      setOnlineUsers(prev => prev.filter(u => u._id !== userId));
    });
    return () => { if (socketRef.current) socketRef.current.disconnect(); };
  }, [user]);

  if (onlineUsers.length === 0) return null;

  return (
    <div className="px-3 py-4 border-t border-gray-200 dark:border-zinc-800">
      <div className="flex items-center justify-between mb-3 px-1">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
          <p className="text-xs font-semibold text-gray-500 dark:text-zinc-500 uppercase tracking-wider">Online Now</p>
        </div>
        <span className="text-xs font-bold text-green-600">{onlineUsers.length}</span>
      </div>
      <div className="space-y-2">
        {onlineUsers.map((onlineUser) => (
          <Link key={onlineUser._id} to={`/profile/${onlineUser._id}`} className="flex items-center gap-3 px-1 py-1.5 rounded-lg text-gray-700 dark:text-zinc-300 hover:bg-gray-100 dark:hover:bg-zinc-800 transition-all">
            <div className="relative">
              <img src={onlineUser.profileImage || `https://ui-avatars.com/api/?name=${onlineUser.name}&background=random&color=fff`} alt={onlineUser.name} className="w-8 h-8 rounded-full" />
              <div className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-green-500 border-2 border-white dark:border-zinc-900 rounded-full"></div>
            </div>
            <span className="text-sm font-medium truncate">{onlineUser.name}</span>
          </Link>
        ))}
      </div>
    </div>
  );
};

const UserLayout = ({ children }) => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const userId = user?.id || user?._id || 'me';
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [notifCount, setNotifCount] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [categories, setCategories] = useState([]);

  useEffect(() => { 
    api.get('/categories').then(res => setCategories(res.data)).catch(() => {}); 
  }, []);

  const fetchNotifCount = async () => {
    try { 
      const res = await api.get('/notifications'); 
      setNotifCount(res.data.filter(n => !n.read).length); 
    } catch (err) {}
  };
  
  useEffect(() => { 
    fetchNotifCount(); 
    const socket = io(SOCKET_URL, { auth: { token: localStorage.getItem('token') } });
    socket.on('newNotification', fetchNotifCount);
    return () => { socket.off('newNotification', fetchNotifCount); socket.disconnect(); };
  }, []);

  const handleSearch = (e) => { 
    e.preventDefault(); 
    if (searchQuery.trim()) navigate(`/dashboard?search=${encodeURIComponent(searchQuery.trim())}`); 
  };

  const navItems = [
    { icon: Home, label: 'Home', path: '/dashboard' },
    { icon: Bookmark, label: 'Saved', path: `/profile/${userId}?tab=saved` },
    { icon: Users, label: 'Communities', path: '/communities' },
    { icon: Bell, label: 'Notifications', path: '/notifications', badge: notifCount, onClick: () => setNotifCount(0) },
    { icon: User, label: 'Profile', path: `/profile/${userId}` },
  ];

  const isActive = (path) => location.pathname === path || (path.startsWith('/profile') && location.pathname.startsWith('/profile'));

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-black flex transition-colors duration-300">
      {isMobileMenuOpen && <div className="fixed inset-0 bg-black/60 z-30 lg:hidden backdrop-blur-sm" onClick={() => setIsMobileMenuOpen(false)} />}
      
      <aside className={`fixed lg:static inset-y-0 left-0 z-40 w-64 bg-white dark:bg-zinc-900 border-r border-gray-200 dark:border-zinc-800 flex flex-col transform transition-transform duration-300 lg:transform-none ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}>
        <div className="p-5 flex items-center justify-between">
          <div className="flex items-center gap-2 cursor-pointer" onClick={() => { navigate('/dashboard'); setIsMobileMenuOpen(false); }}>
            <div className="w-9 h-9 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-lg flex items-center justify-center text-white font-bold text-lg shadow-md">M</div>
            <span className="text-xl font-bold text-gray-900 dark:text-zinc-100">MindShare</span>
          </div>
          <button onClick={() => setIsMobileMenuOpen(false)} className="lg:hidden p-1 text-gray-500"><X size={20} /></button>
        </div>
        
        <nav className="flex-1 px-3 space-y-1 overflow-y-auto">
          {navItems.map((item) => (
            <Link key={item.label} to={item.path} onClick={() => { setIsMobileMenuOpen(false); if (item.onClick) item.onClick(); }}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg font-medium text-sm transition-all ${
                isActive(item.path)
                  ? 'bg-indigo-600 text-white' 
                  : 'text-gray-700 dark:text-zinc-400 hover:bg-gray-100 dark:hover:bg-zinc-800'
              }`}>
              <item.icon size={20} />
              <span>{item.label}</span>
              {item.badge > 0 && <span className="ml-auto bg-red-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">{item.badge > 9 ? '9+' : item.badge}</span>}
            </Link>
          ))}
          {user?.isAdmin && (
            <Link to="/admin" onClick={() => setIsMobileMenuOpen(false)} className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/20 hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition-all font-medium text-sm mt-2">
              <LayoutDashboard size={20} />
              <span>Admin Panel</span>
            </Link>
          )}
        </nav>

        <OnlineUsers />
        
        <div className="p-3 space-y-3 border-t border-gray-200 dark:border-zinc-800">
          <button onClick={logout} className="w-full flex items-center justify-center gap-2 px-3 py-2 text-gray-600 dark:text-zinc-400 hover:bg-gray-100 dark:hover:bg-zinc-800 rounded-lg text-sm font-medium">
            <LogOut size={18} /> Logout
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-h-screen w-full lg:mr-80">
        <header className="h-16 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-md border-b border-gray-200 dark:border-zinc-800 sticky top-0 z-20 px-4 lg:px-6 flex items-center shadow-sm">
          <div className="flex items-center gap-3 lg:hidden">
            <button onClick={() => setIsMobileMenuOpen(true)} className="p-2 text-gray-600 dark:text-zinc-400 hover:bg-gray-100 dark:hover:bg-zinc-800 rounded-lg"><Menu size={22} /></button>
          </div>
          <div className="flex-1 flex justify-center px-2 lg:px-8">
            <form onSubmit={handleSearch} className="relative w-full max-w-xl">
              <Search className="absolute left-3 top-2.5 text-gray-400" size={18} />
              <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search discussions..."
                className="w-full pl-10 pr-4 py-2 bg-gray-100 dark:bg-zinc-800 border-none rounded-full focus:ring-2 focus:ring-indigo-500 focus:bg-white dark:focus:bg-zinc-800 outline-none text-sm text-gray-900 dark:text-zinc-100 transition-all" />
            </form>
          </div>
          <div className="profile-menu-container relative flex items-center gap-4">
            <button className="relative p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-zinc-800 rounded-full transition-colors" onClick={() => navigate('/notifications')}>
              <Bell size={20} />
              {notifCount > 0 && <span className="absolute top-1 right-1 w-4 h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">{notifCount > 9 ? '9+' : notifCount}</span>}
            </button>
            <div className="flex items-center gap-2 pl-2 lg:pl-3 border-l border-gray-200 dark:border-zinc-700 cursor-pointer hover:bg-gray-100 dark:hover:bg-zinc-800 rounded-lg px-2 py-1 transition-all" onClick={() => setIsProfileOpen(!isProfileOpen)}>
              <div className="relative">
                <img src={user?.profileImage || `https://ui-avatars.com/api/?name=${user?.name}&background=random&color=fff`} alt="Profile" className="w-8 h-8 lg:w-9 lg:h-9 rounded-full" />
                <div className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-green-500 border-2 border-white dark:border-zinc-900 rounded-full"></div>
              </div>
              <div className="hidden md:block"><p className="text-sm font-semibold text-gray-900 dark:text-zinc-100">{user?.name}</p></div>
              <ChevronDown size={16} className={`text-gray-400 transition-transform ${isProfileOpen ? 'rotate-180' : ''}`} />
            </div>
            {isProfileOpen && (
              <div className="absolute right-0 top-full mt-2 w-48 bg-white dark:bg-zinc-900 rounded-xl shadow-xl border border-gray-200 dark:border-zinc-700 py-2 z-50">
                <Link to={`/profile/${userId}?tab=settings`} onClick={() => setIsProfileOpen(false)} className="flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 dark:text-zinc-300 hover:bg-gray-100 dark:hover:bg-zinc-800">
                  <Settings size={16} /> Settings
                </Link>
                <button onClick={() => { setIsProfileOpen(false); logout(); }} className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 text-left">
                  <LogOut size={16} /> Logout
                </button>
              </div>
            )}
          </div>
        </header>
        <div className="flex-1 p-4 lg:p-6">
          <div className="max-w-3xl mx-auto">
            {children}
          </div>
        </div>
      </div>

      <aside className="hidden lg:block w-80 bg-white dark:bg-zinc-900 border-l border-gray-200 dark:border-zinc-800 fixed right-0 top-0 h-full overflow-y-auto pt-16">
        <div className="p-6 space-y-6">
          <div className="bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 rounded-2xl p-5 shadow-lg text-white">
            <div className="flex items-center gap-2 mb-4"><Sparkles size={20} className="text-yellow-300" /><h3 className="font-bold text-lg">How MindShare Works</h3></div>
            <div className="space-y-3 text-sm">
              <div className="flex items-start gap-3"><div className="w-6 h-6 bg-white/20 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">1</div><p>Create and share posts with the community</p></div>
              <div className="flex items-start gap-3"><div className="w-6 h-6 bg-white/20 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">2</div><p>Choose or discover topics to organize discussions</p></div>
              <div className="flex items-start gap-3"><div className="w-6 h-6 bg-white/20 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">3</div><p>Like and comment on posts that interest you</p></div>
              <div className="flex items-start gap-3"><div className="w-6 h-6 bg-white/20 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">4</div><p>Reply to comments and engage in discussions</p></div>
              <div className="flex items-start gap-3"><div className="w-6 h-6 bg-white/20 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">5</div><p>Save posts for later reference</p></div>
            </div>
          </div>

          <div className="bg-gray-50 dark:bg-zinc-800 rounded-2xl p-5 border border-gray-200 dark:border-zinc-700">
            <div className="flex items-center gap-2 mb-4">
              <Hash className="text-indigo-600 dark:text-indigo-400" size={20} />
              <h3 className="font-bold text-gray-900 dark:text-zinc-100">Topics</h3>
            </div>
            <div className="space-y-2">
              {categories.map((topic) => (
                <Link key={topic._id} to={`/dashboard?category=${topic.name}`} className="flex items-center justify-between p-2 hover:bg-white dark:hover:bg-zinc-700 rounded-lg transition-colors cursor-pointer group">
                  <div className="flex items-center gap-2">
                    <Hash className="text-gray-400 group-hover:text-indigo-600" size={16} />
                    <span className="text-sm font-medium text-gray-700 dark:text-zinc-300 group-hover:text-indigo-600 dark:group-hover:text-indigo-400">{topic.name}</span>
                  </div>
                  <span className="text-xs text-gray-500 dark:text-zinc-400 bg-white dark:bg-zinc-700 px-2 py-1 rounded-full border border-gray-200 dark:border-zinc-600">{topic.postCount || 0}</span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
};

const AuthPage = () => {
  const { login } = useAuth();
  const [isRegister, setIsRegister] = useState(false);
  const [formData, setFormData] = useState({ name: '', email: '', password: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleGoogle = async (res) => {
    try { const response = await api.post('/auth/google', { credential: res.credential }); login(response.data.user, response.data.token); } 
    catch (err) { alert('Google login failed.'); }
  };
  const handleSubmit = async (e) => {
    e.preventDefault(); setLoading(true);
    try {
      const endpoint = isRegister ? '/auth/register' : '/auth/login';
      const payload = isRegister ? formData : { email: formData.email, password: formData.password };
      const res = await api.post(endpoint, payload);
      if (isRegister) { setIsRegister(false); setFormData({ name: '', email: formData.email, password: '' }); alert('Account created!'); } 
      else { login(res.data.user, res.data.token); }
    } catch (err) { alert(err.response?.data?.message || 'Authentication failed'); }
    finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen flex bg-gray-50 dark:bg-black">
      <div className="hidden lg:flex w-1/2 bg-gradient-to-br from-indigo-600 via-purple-600 to-indigo-800 relative overflow-hidden flex-col justify-between p-12 text-white">
        <div className="absolute inset-0 opacity-20">
          <div className="absolute top-20 left-20 w-72 h-72 bg-white rounded-full blur-3xl"></div>
          <div className="absolute bottom-20 right-20 w-96 h-96 bg-purple-300 rounded-full blur-3xl"></div>
        </div>
        <div className="relative z-10">
          <div className="flex items-center gap-2 mb-12"><div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center text-indigo-600 font-bold text-xl shadow-lg">M</div><span className="text-2xl font-bold">MindShare</span></div>
          <h1 className="text-5xl font-bold leading-tight mb-6">Share Ideas.<br/>Start Conversations.<br/><span className="text-indigo-200">Grow Together.</span></h1>
          <p className="text-lg  text-white max-w-md">MindShare is a community platform where people share ideas, ask questions, and learn from each other.</p>
        </div>
      </div>
      <div className="w-full lg:w-1/2 flex items-center justify-center p-4 sm:p-8">
        <div className="w-full max-w-md">
          <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-zinc-100 text-center mb-2">{isRegister ? 'Create Account' : 'Welcome back'}</h2>
          <p className="text-gray-500 dark:text-zinc-400 text-center mb-6 sm:mb-8">{isRegister ? 'Join MindShare today' : 'Log in to continue'}</p>
          <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-xl border border-gray-200 dark:border-zinc-800 p-6 sm:p-8 space-y-6">
            <form onSubmit={handleSubmit} className="space-y-4">
              {isRegister && (
                <div className="relative group">
                  <User className="absolute left-3 top-3 text-gray-400" size={18} />
                  <input type="text" value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} required placeholder="Full Name" className="w-full pl-10 pr-4 py-3 border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-zinc-100 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none" />
                </div>
              )}
              <div className="relative group">
                <Mail className="absolute left-3 top-3 text-gray-400" size={18} />
                <input type="email" value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })} required placeholder="Email" className="w-full pl-10 pr-4 py-3 border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-zinc-100 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none" />
              </div>
              <div className="relative group">
                <Lock className="absolute left-3 top-3 text-gray-400" size={18} />
                <input type={showPassword ? 'text' : 'password'} value={formData.password} onChange={e => setFormData({ ...formData, password: e.target.value })} required placeholder="Password" className="w-full pl-10 pr-10 py-3 border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-zinc-100 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none" />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-3 text-gray-400"><Eye size={18} /></button>
              </div>
              <button type="submit" disabled={loading} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-3 rounded-xl font-semibold shadow-lg shadow-indigo-200 dark:shadow-none transition-all disabled:opacity-50">
                {loading ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin mx-auto"></div> : (isRegister ? 'Sign Up' : 'Log In')}
              </button>
            </form>
            <div className="relative flex items-center py-2"><div className="flex-grow border-t border-gray-200 dark:border-zinc-700"></div><span className="px-4 text-gray-400 text-xs uppercase">Or</span><div className="flex-grow border-t border-gray-200 dark:border-zinc-700"></div></div>
            <div className="flex justify-center"><GoogleLogin onSuccess={handleGoogle} onError={() => alert('Google login failed')} width="100%" theme={localStorage.getItem('theme') === 'dark' ? 'filled_black' : 'outline'} shape="pill" /></div>
            <p className="text-center text-gray-600 dark:text-zinc-400 text-sm">
              {isRegister ? 'Already have an account?' : "Don't have an account? "}
              <button onClick={() => { setIsRegister(!isRegister); setFormData({ ...formData, password: '' }); }} className="text-indigo-600 dark:text-indigo-400 font-semibold hover:underline ml-1">{isRegister ? 'Sign In' : 'Sign up'}</button>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

const CreatePost = () => {
  const [form, setForm] = useState({ title: '', content: '', category: 'Technology', link: '' });
  const [postType, setPostType] = useState('text');
  const [pollOptions, setPollOptions] = useState(['', '']);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault(); setLoading(true);
    try {
      const postData = { ...form };
      if (postType === 'poll') { postData.pollOptions = pollOptions.filter(opt => opt.trim() !== '').map(text => ({ text, votes: [] })); postData.isPoll = true; }
      await api.post('/posts', postData); navigate('/dashboard');
    } catch (err) { alert('Failed to create post'); }
    finally { setLoading(false); }
  };

  return (
    <UserLayout>
      <div className="w-full">
        <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-gray-500 dark:text-zinc-400 hover:text-gray-900 dark:hover:text-zinc-100 mb-6 font-medium text-sm"><X size={16} /> Back</button>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-zinc-100 mb-6">Start a Discussion</h2>
        <form onSubmit={handleSubmit} className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-xl p-6 space-y-4 shadow-sm">
          <div className="flex gap-2 p-1 bg-gray-100 dark:bg-zinc-800 rounded-lg">
            <button type="button" onClick={() => setPostType('text')} className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-all ${postType === 'text' ? 'bg-white dark:bg-zinc-700 text-indigo-600 dark:text-indigo-400 shadow-sm' : 'text-gray-600 dark:text-zinc-400'}`}>Text</button>
            <button type="button" onClick={() => setPostType('poll')} className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-all ${postType === 'poll' ? 'bg-white dark:bg-zinc-700 text-indigo-600 dark:text-indigo-400 shadow-sm' : 'text-gray-600 dark:text-zinc-400'}`}>Poll</button>
          </div>
          <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Discussion Title" className="w-full p-3 border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-zinc-100 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none font-semibold" required />
          <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} className="w-full p-3 border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-zinc-100 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none">
            {['Technology', 'Education', 'Science', 'Business', 'Lifestyle', 'Society', 'Creativity'].map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <textarea value={form.content} onChange={e => setForm({ ...form, content: e.target.value })} placeholder="What's on your mind?" className="w-full h-40 p-3 border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-zinc-100 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none resize-none" required />
          {postType === 'poll' && (
            <div className="space-y-2 p-4 bg-indigo-50 dark:bg-indigo-900/20 rounded-lg border border-indigo-100 dark:border-indigo-800">
              <p className="text-sm font-semibold text-indigo-900 dark:text-indigo-300 mb-2">Poll Options (2-6)</p>
              {pollOptions.map((option, index) => (
                <div key={index} className="flex gap-2">
                  <input value={option} onChange={(e) => { const n = [...pollOptions]; n[index] = e.target.value; setPollOptions(n); }} placeholder={`Option ${index + 1}`} className="flex-1 p-2 border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-zinc-100 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-sm" />
                  {pollOptions.length > 2 && <button type="button" onClick={() => setPollOptions(pollOptions.filter((_, i) => i !== index))} className="p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg"><X size={16} /></button>}
                </div>
              ))}
              {pollOptions.length < 6 && <button type="button" onClick={() => setPollOptions([...pollOptions, ''])} className="text-sm text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 font-medium flex items-center gap-1"><Plus size={14} /> Add Option</button>}
            </div>
          )}
          <input value={form.link} onChange={e => setForm({ ...form, link: e.target.value })} placeholder="Link (optional)" className="w-full p-3 border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-zinc-100 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none" />
          <button type="submit" disabled={loading} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-3 rounded-lg transition-all disabled:opacity-50 shadow-lg shadow-indigo-200 dark:shadow-none">
            {loading ? 'Posting...' : 'Post Discussion'}
          </button>
        </form>
      </div>
    </UserLayout>
  );
};

const PostCard = ({ post, onUpdate }) => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const userIdStr = String(user?.id || user?._id || '');
  const isOwner = (currentPost) => String(currentPost.userId?._id || currentPost.userId) === userIdStr && userIdStr !== '';
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({ title: post.title, content: post.content, category: post.category, imageUrl: post.imageUrl, link: post.link });
  const [loadingAction, setLoadingAction] = useState(null);
  const [localPost, setLocalPost] = useState(post);
  const [showMenu, setShowMenu] = useState(false);
  
  useEffect(() => { setLocalPost(post); setEditForm({ title: post.title, content: post.content, category: post.category, imageUrl: post.imageUrl, link: post.link }); }, [post]);

  const hasLiked = localPost.likes?.some(l => String(typeof l === 'string' ? l : l._id) === userIdStr);
  const isSaved = localPost.saves?.some(s => String(typeof s === 'string' ? s : s._id) === userIdStr);

  const handleLike = async () => {
    if (loadingAction === 'like') return;
    setLoadingAction('like');
    const currentLikes = localPost.likes || [];
    const newLikes = hasLiked ? currentLikes.filter(l => String(typeof l === 'string' ? l : l._id) !== userIdStr) : [...currentLikes, { _id: user.id, name: user.name, profileImage: user.profileImage }];
    setLocalPost({ ...localPost, likes: newLikes });
    try { const res = await api.post(`/posts/${localPost._id}/like`); setLocalPost(res.data); if (onUpdate) onUpdate(res.data); } catch (e) { setLocalPost(post); } finally { setLoadingAction(null); }
  };

  const handleSave = async () => {
    if (loadingAction === 'save') return; setLoadingAction('save');
    const currentSaves = localPost.saves || [];
    const newSaves = isSaved ? currentSaves.filter(s => String(typeof s === 'string' ? s : s._id) !== userIdStr) : [...currentSaves, user.id];
    setLocalPost({ ...localPost, saves: newSaves });
    try { await api.post(`/posts/${localPost._id}/save`); const res = await api.get(`/posts/${localPost._id}`); setLocalPost(res.data); if (onUpdate) onUpdate(res.data); } catch (e) { setLocalPost(post); } finally { setLoadingAction(null); }
  };

  const handleDelete = async () => { if (!window.confirm('Delete?')) return; try { await api.delete(`/posts/${localPost._id}`); if (onUpdate) onUpdate(null); } catch (err) { alert('Failed'); } };
  const handleSaveEdit = async () => { try { const res = await api.put(`/posts/${localPost._id}`, editForm); setIsEditing(false); setLocalPost(res.data); if (onUpdate) onUpdate(res.data); } catch (err) { alert('Failed'); } };
  const handleVote = async (optionIndex) => {
    if (loadingAction === 'vote') return; setLoadingAction('vote');
    const currentOptions = localPost.pollOptions || [];
    const newOptions = currentOptions.map((opt, idx) => ({ ...opt, votes: idx === optionIndex ? [...(opt.votes || []).filter(v => String(typeof v === 'string' ? v : v._id) !== userIdStr), { _id: user.id, name: user.name, profileImage: user.profileImage }] : (opt.votes || []).filter(v => String(typeof v === 'string' ? v : v._id) !== userIdStr) }));
    setLocalPost({ ...localPost, pollOptions: newOptions });
    try { const res = await api.post(`/posts/${localPost._id}/vote`, { optionIndex }); setLocalPost(res.data); if (onUpdate) onUpdate(res.data); } catch (e) { setLocalPost(post); } finally { setLoadingAction(null); }
  };

  if (isEditing) {
    return (
      <div className="bg-white dark:bg-zinc-900 rounded-2xl p-6 border border-indigo-200 dark:border-indigo-800 space-y-4 shadow-sm">
        <input value={editForm.title} onChange={e => setEditForm({...editForm, title: e.target.value})} className="w-full p-2 border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 rounded-lg font-semibold text-gray-900 dark:text-zinc-100" />
        <select value={editForm.category} onChange={e => setEditForm({...editForm, category: e.target.value})} className="w-full p-2 border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 rounded-lg text-gray-900 dark:text-zinc-100">
          {['Technology', 'Education', 'Science', 'Business', 'Lifestyle', 'Society', 'Creativity'].map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <textarea value={editForm.content} onChange={e => setEditForm({...editForm, content: e.target.value})} className="w-full h-32 p-2 border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 rounded-lg resize-none text-gray-900 dark:text-zinc-100" />
        <div className="flex gap-2 justify-end">
          <button onClick={() => setIsEditing(false)} className="px-4 py-2 text-gray-600 dark:text-zinc-400 hover:bg-gray-100 dark:hover:bg-zinc-800 rounded-lg flex items-center gap-1"><X size={16} /> Cancel</button>
          <button onClick={handleSaveEdit} className="px-4 py-2 bg-indigo-600 text-white rounded-lg flex items-center gap-1"><Save size={16} /> Save</button>
        </div>
      </div>
    );
  }

  const totalVotes = localPost.pollOptions?.reduce((sum, opt) => sum + (opt.votes?.length || 0), 0) || 0;

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-2xl p-4 sm:p-6 border border-gray-200 dark:border-zinc-800 hover:shadow-md hover:-translate-y-0.5 transition-all duration-300 relative group shadow-sm mb-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3 cursor-pointer" onClick={() => navigate(`/profile/${localPost.userId?._id}`)}>
          <img src={localPost.userId?.profileImage || `https://ui-avatars.com/api/?name=${localPost.userId?.name}&background=random&color=fff`} alt="User" className="w-10 h-10 sm:w-11 sm:h-11 rounded-full" />
          <div>
            <p className="font-semibold text-gray-900 dark:text-zinc-100 text-sm">{localPost.userId?.name}</p>
            <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-zinc-400">
              <span>{timeAgo(localPost.createdAt)}</span>
              <span className="w-1 h-1 bg-gray-300 dark:bg-zinc-600 rounded-full"></span>
              <Badge type={localPost.category} />
            </div>
          </div>
        </div>
        <div className="relative">
          <button onClick={() => setShowMenu(!showMenu)} className="p-1.5 text-gray-400 dark:text-zinc-500 hover:text-gray-600 dark:hover:text-zinc-300 hover:bg-gray-100 dark:hover:bg-zinc-800 rounded-lg transition"><MoreHorizontal size={18} /></button>
          {showMenu && (
            <div className="absolute right-0 top-full mt-1 w-32 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl shadow-xl z-20 overflow-hidden">
              {isOwner(localPost) && (
                <>
                  <button onClick={() => { setIsEditing(true); setShowMenu(false); }} className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-gray-700 dark:text-zinc-300 hover:bg-gray-50 dark:hover:bg-zinc-800"><Edit3 size={16} /> Edit</button>
                  <button onClick={() => { handleDelete(); setShowMenu(false); }} className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"><Trash2 size={16} /> Delete</button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
      <h3 className="text-lg font-bold text-gray-900 dark:text-zinc-100 mb-2 cursor-pointer hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors" onClick={() => navigate(`/post/${localPost._id}`)}>{localPost.title}</h3>
      <p className="text-gray-600 dark:text-zinc-300 text-sm leading-relaxed mb-4">{localPost.content}</p>
      {localPost.imageUrl && <img src={localPost.imageUrl} alt="Post" className="w-full h-48 object-cover rounded-xl mb-3" />}
      {localPost.link && <a href={localPost.link} target="_blank" rel="noreferrer" className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline mb-3 block flex items-center gap-1"><LinkIcon size={14} /> {localPost.link}</a>}
      
      {localPost.isPoll && localPost.pollOptions && localPost.pollOptions.length > 0 && (
        <div className="mb-4 space-y-2">
          {localPost.pollOptions.map((option, idx) => {
            const voteCount = option.votes?.length || 0;
            const percentage = totalVotes > 0 ? Math.round((voteCount / totalVotes) * 100) : 0;
            const hasVoted = option.votes?.some(v => String(typeof v === 'string' ? v : v._id) === userIdStr);
            return (
              <div key={idx} onClick={() => !hasVoted && handleVote(idx)} className={`relative overflow-hidden rounded-xl border-2 transition-all ${hasVoted ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20' : 'border-gray-200 dark:border-zinc-700 hover:border-indigo-400 cursor-pointer'}`}>
                {hasVoted && <div className="absolute inset-y-0 left-0 bg-gradient-to-r from-indigo-100 to-purple-100 dark:from-indigo-900/40 dark:to-purple-900/40 transition-all duration-500" style={{ width: `${percentage}%` }}></div>}
                <div className="relative flex items-center justify-between p-3">
                  <div className="flex items-center gap-2">
                    {hasVoted ? <CheckCircle size={18} className="text-indigo-600 dark:text-indigo-400" /> : <div className="w-4 h-4 rounded-full border-2 border-gray-400 dark:border-zinc-500"></div>}
                    <span className="text-sm font-medium text-gray-700 dark:text-zinc-200">{option.text}</span>
                  </div>
                  <span className="text-sm font-bold text-indigo-600 dark:text-indigo-400">{percentage}%</span>
                </div>
              </div>
            );
          })}
          <p className="text-xs text-gray-500 dark:text-zinc-400 text-center mt-2">📊 {totalVotes} votes total</p>
        </div>
      )}
      
      <div className="flex items-center justify-between pt-3 border-t border-gray-100 dark:border-zinc-800">
        <div className="flex items-center gap-2 sm:gap-4">
          <button onClick={handleLike} disabled={loadingAction === 'like'} className={`flex items-center gap-1.5 transition-all active:scale-95 p-2 -m-2 ${hasLiked ? 'text-red-500' : 'text-gray-500 dark:text-zinc-400 hover:text-red-500'} disabled:opacity-50`}>
            <Heart size={20} fill={hasLiked ? "currentColor" : "none"} /> 
            <span className="text-sm">{(localPost.likes?.length || 0)}</span>
          </button>
          <button onClick={() => navigate(`/post/${localPost._id}`)} className="flex items-center gap-1.5 text-sm font-medium text-gray-500 dark:text-zinc-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors p-2 -m-2">
            <MessageCircle size={20} /> 
            <span className="text-sm">{localPost.commentCount || 0}</span>
          </button>
          <button onClick={handleSave} disabled={loadingAction === 'save'} className={`flex items-center gap-1.5 transition-all active:scale-95 p-2 -m-2 ${isSaved ? 'text-indigo-600 dark:text-indigo-400' : 'text-gray-500 dark:text-zinc-400 hover:text-indigo-600 dark:hover:text-indigo-400'} disabled:opacity-50`}>
            <Bookmark size={20} fill={isSaved ? "currentColor" : "none"} /> 
          </button>
        </div>
      </div>
    </div>
  );
};

const Dashboard = () => {
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const category = searchParams.get('category') || 'All';

  useEffect(() => {
    setLoading(true);
    const socket = io(SOCKET_URL);
    const fetchPosts = async () => {
      try { 
        await new Promise(r => setTimeout(r, 600));
        const res = await api.get(`/posts?category=${category}`); 
        setPosts(res.data); 
      } catch (err) {}
      finally { setLoading(false); }
    };
    fetchPosts();
    socket.on('newPost', (newPost) => { setPosts(prev => prev.some(p => p._id === newPost._id) ? prev : [newPost, ...prev]); });
    socket.on('postUpdated', (updatedPost) => { if (updatedPost) setPosts(prev => prev.map(p => p._id === updatedPost._id ? updatedPost : p)); });
    socket.on('postDeleted', (deletedId) => { setPosts(prev => prev.filter(p => p._id !== deletedId)); });
    return () => { socket.off('newPost'); socket.off('postUpdated'); socket.off('postDeleted'); socket.disconnect(); };
  }, [category]);

  return (
    <UserLayout>
      <div className="space-y-6">
        <div className="bg-white dark:bg-zinc-900 rounded-2xl p-4 sm:p-6 shadow-sm border border-gray-200 dark:border-zinc-800">
          <div className="flex items-start gap-4 mb-4">
            <img src={user?.profileImage || `https://ui-avatars.com/api/?name=${user?.name}&background=random&color=fff`} alt="User" className="w-10 h-10 sm:w-12 sm:h-12 rounded-full" />
            <input readOnly placeholder="What's on your mind?" className="flex-1 text-base font-medium text-gray-900 dark:text-zinc-100 placeholder-gray-400 dark:placeholder-zinc-500 outline-none bg-transparent pt-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-zinc-800 rounded-lg px-3 transition-colors" onClick={() => navigate('/create-post')} />
          </div>
          <div className="flex items-center justify-between pt-4 border-t border-gray-100 dark:border-zinc-800 flex-wrap gap-2">
            <div className="flex gap-1 flex-wrap">
              <button onClick={() => navigate('/create-post')} className="flex items-center gap-2 px-3 py-2 text-gray-600 dark:text-zinc-400 hover:bg-gray-100 dark:hover:bg-zinc-800 rounded-lg text-sm font-medium transition-all active:scale-95"><FileText size={18} /> Text</button>
              <button onClick={() => navigate('/create-post')} className="flex items-center gap-2 px-3 py-2 text-gray-600 dark:text-zinc-400 hover:bg-gray-100 dark:hover:bg-zinc-800 rounded-lg text-sm font-medium transition-all active:scale-95"><BarChart2 size={18} /> Poll</button>
              <button onClick={() => navigate('/create-post')} className="flex items-center gap-2 px-3 py-2 text-gray-600 dark:text-zinc-400 hover:bg-gray-100 dark:hover:bg-zinc-800 rounded-lg text-sm font-medium transition-all active:scale-95"><LinkIcon size={18} /> Link</button>
            </div>
            <button onClick={() => navigate('/create-post')} className="bg-indigo-600 hover:bg-indigo-700 active:scale-[0.98] text-white px-6 py-2.5 rounded-lg font-semibold transition-all shadow-md shadow-indigo-200 dark:shadow-none hover:shadow-lg text-sm w-full sm:w-auto">Post</button>
          </div>
        </div>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <h2 className="text-xl font-bold text-gray-900 dark:text-zinc-100">Latest Discussions</h2>
          <div className="flex items-center gap-3 flex-wrap">
            <select value={category} onChange={e => setSearchParams(prev => { prev.set('category', e.target.value); return prev; })} className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 text-sm font-medium text-gray-700 dark:text-zinc-300 rounded-lg px-3 py-2 outline-none cursor-pointer hover:border-gray-300 dark:hover:border-zinc-600 transition-colors active:scale-95">
              <option value="All">All Topics</option>
              {['Technology', 'Education', 'Science', 'Business', 'Lifestyle', 'Society', 'Creativity'].map(c => ( <option key={c} value={c}>{c}</option>))}
            </select>
          </div>
        </div>
        <div className="space-y-4">
          {loading && posts.length === 0 ? (
            [1, 2, 3].map(i => (
              <div key={i} className="bg-white dark:bg-zinc-900 rounded-2xl p-6 shadow-sm border border-gray-200 dark:border-zinc-800">
                <div className="flex items-center gap-3 mb-4">
                  <Skeleton className="w-11 h-11 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-3 w-24" />
                  </div>
                </div>
                <Skeleton className="h-4 w-full mb-2" />
                <Skeleton className="h-4 w-5/6 mb-4" />
                <div className="flex items-center gap-4 pt-4 border-t border-gray-100 dark:border-zinc-800">
                  <Skeleton className="h-5 w-16" />
                  <Skeleton className="h-5 w-16" />
                  <Skeleton className="h-5 w-16" />
                </div>
              </div>
            ))
          ) : posts.length === 0 ? (
            <p className="text-center text-gray-500 dark:text-zinc-400 py-10 bg-white dark:bg-zinc-900 rounded-2xl border border-gray-200 dark:border-zinc-800">No discussions found. Be the first!</p>
          ) : (
            posts.map(post => <PostCard key={post._id} post={post} onUpdate={(updated) => {
              if (!updated) setPosts(prev => prev.filter(p => p._id !== post._id));
              else setPosts(prev => prev.map(p => p._id === updated._id ? updated : p));
            }} />)
          )}
        </div>
        {loading && posts.length > 0 && (
          <div className="text-center py-4">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mx-auto mb-2"></div>
            <p className="text-gray-500 dark:text-zinc-400 text-sm">Loading more discussions...</p>
          </div>
        )}
      </div>
    </UserLayout>
  );
};

const PostDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [post, setPost] = useState(null);
  const [comments, setComments] = useState([]);
  const [notFound, setNotFound] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [loading, setLoading] = useState(false);
  const [editingCommentId, setEditingCommentId] = useState(null);
  const [editCommentText, setEditCommentText] = useState('');
  const [replyingTo, setReplyingTo] = useState(null);
  const [replyText, setReplyText] = useState('');
  const [replyLoading, setReplyLoading] = useState(false);
  const [newComment, setNewComment] = useState('');
  const { user } = useAuth();
  const socketRef = useRef(null);

  useEffect(() => {
    socketRef.current = io(SOCKET_URL);
    socketRef.current.emit('joinPost', id);
    socketRef.current.on('newComment', (c) => {
      setComments(prev => {
        if (prev.some(pc => pc._id === c._id)) return prev;
        const withoutOptimistic = prev.filter(pc => !(pc._id?.startsWith('optimistic') && pc.userId._id === user.id && pc.content === c.content));
        return [...withoutOptimistic, c];
      });
    });
    socketRef.current.on('commentUpdated', (c) => { setComments(prev => prev.map(comment => comment._id === c._id ? c : comment)); });
    socketRef.current.on('commentDeleted', (data) => {
      const commentId = typeof data === 'object' ? data.commentId : data;
      setComments(prev => prev.filter(c => c._id !== commentId));
    });
    socketRef.current.on('postUpdated', (p) => setPost(p));
    socketRef.current.on('postDeleted', () => { alert('Post deleted.'); navigate('/dashboard'); });
    const fetchData = async () => {
      try {
        const [postRes, commentRes] = await Promise.all([api.get(`/posts/${id}`), api.get(`/posts/${id}/comments`)]);
        setPost(postRes.data); setComments(commentRes.data);
      } catch (err) { if (err.response?.status === 404) setNotFound(true); }
    };
    fetchData();
    return () => { if (socketRef.current) { socketRef.current.off('newComment'); socketRef.current.off('commentUpdated'); socketRef.current.off('commentDeleted'); socketRef.current.off('postUpdated'); socketRef.current.off('postDeleted'); socketRef.current.disconnect(); } };
  }, [id, navigate, user.id]);

  if (notFound) return (<UserLayout><div className="text-center pt-20 w-full"><div className="w-16 h-16 bg-gray-100 dark:bg-zinc-800 rounded-full flex items-center justify-center mx-auto mb-4"><Search size={32} className="text-gray-400 dark:text-zinc-500" /></div><h2 className="text-2xl font-bold text-gray-900 dark:text-zinc-100 mb-2">Post Not Found</h2><button onClick={() => navigate('/dashboard')} className="bg-indigo-600 text-white px-6 py-2.5 rounded-lg hover:bg-indigo-700 active:scale-95 transition-all font-medium">Back to Home</button></div></UserLayout>);
  if (!post) return <div className="max-w-2xl mx-auto p-4 text-center pt-20"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto mb-4"></div><p className="text-gray-500 dark:text-zinc-400">Loading...</p></div>;

  const addComment = async (e) => {
    e.preventDefault(); if (!newComment.trim() || loading) return; setLoading(true);
    const tempId = 'optimistic-' + Date.now();
    const optimisticComment = { _id: tempId, content: newComment, userId: { _id: user.id, name: user.name, profileImage: user.profileImage }, createdAt: new Date().toISOString(), replies: [] };
    setComments(prev => [...prev, optimisticComment]); setNewComment('');
    try {
      const res = await api.post(`/posts/${id}/comments`, { content: newComment });
      setComments(prev => { const filtered = prev.filter(c => c._id !== tempId); if (filtered.some(c => c._id === res.data._id)) return filtered; return [...filtered, res.data]; });
    } catch (err) { alert('Failed'); setComments(prev => prev.filter(c => c._id !== tempId)); } finally { setLoading(false); }
  };

  const handleCommentEdit = async (commentId) => { try { await api.put(`/comments/${commentId}`, { content: editCommentText }); setEditingCommentId(null); } catch (err) { alert('Failed'); } };
  const handleCommentDelete = async (commentId) => { if (!window.confirm('Delete?')) return; try { await api.delete(`/comments/${commentId}`); setComments(prev => prev.filter(c => c._id !== commentId)); } catch (err) { alert('Failed'); } };
  
  const handleReply = async (commentId) => {
    if (!replyText.trim() || replyLoading) return; setReplyLoading(true);
    const optimisticReplyId = 'opt-reply-' + Date.now();
    const optimisticReply = { _id: optimisticReplyId, userId: { _id: user.id, name: user.name, profileImage: user.profileImage }, content: replyText, createdAt: new Date().toISOString() };
    setComments(prev => prev.map(c => c._id === commentId ? { ...c, replies: [...(c.replies || []), optimisticReply] } : c));
    const currentReplyText = replyText; setReplyText(''); setReplyingTo(null);
    try {
      const res = await api.post(`/comments/${commentId}/replies`, { content: currentReplyText });
      setComments(prev => {
        const hasRealReply = prev.some(c => c._id === commentId && (c.replies || []).some(r => r._id && !r._id.startsWith('opt-reply-') && r.content === currentReplyText));
        if (hasRealReply) { return prev.map(c => c._id === commentId ? { ...c, replies: (c.replies || []).filter(r => !r._id?.startsWith('opt-reply-')) } : c); }
        return prev.map(c => c._id === commentId ? res.data : c);
      });
    } catch (err) { alert('Failed'); setComments(prev => prev.map(c => c._id === commentId ? { ...c, replies: (c.replies || []).filter(r => r._id !== optimisticReplyId) } : c)); } finally { setReplyLoading(false); }
  };

  const submitReport = async (reason) => { try { await api.post('/reports', { postId: id, reason, description: 'Reported' }); setShowReport(false); alert('Reported.'); } catch (err) { alert('Failed'); } };

  return (
    <UserLayout>
      <div className="w-full">
        <button onClick={() => window.history.back()} className="flex items-center gap-2 text-gray-500 dark:text-zinc-400 hover:text-gray-900 dark:hover:text-zinc-100 mb-6 font-medium text-sm"><X size={16} /> Back</button>
        <PostCard post={post} onUpdate={setPost} />
        <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-4 sm:p-6 mt-6 shadow-sm">
          <div className="flex items-center justify-between mb-6">
            <h3 className="font-bold text-gray-900 dark:text-zinc-100 text-lg flex items-center gap-2"><MessageCircle size={20} className="text-indigo-600 dark:text-indigo-400" /> Comments ({comments.length})</h3>
            <button onClick={() => setShowReport(!showReport)} className="flex items-center gap-1 text-sm text-gray-500 dark:text-zinc-400 hover:text-red-600 transition-colors"><Flag size={16} /> Report</button>
          </div>
          {showReport && (
            <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex flex-wrap gap-2">
              <button onClick={() => submitReport('spam')} className="text-xs bg-white dark:bg-zinc-800 border border-red-200 dark:border-red-800 px-3 py-1.5 rounded hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors">Spam</button>
              <button onClick={() => submitReport('inappropriate')} className="text-xs bg-white dark:bg-zinc-800 border border-red-200 dark:border-red-800 px-3 py-1.5 rounded hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors">Inappropriate</button>
              <button onClick={() => setShowReport(false)} className="text-xs text-gray-500 dark:text-zinc-400 hover:text-gray-700 dark:hover:text-zinc-200">Cancel</button>
            </div>
          )}
          <div className="space-y-4 mb-6">
            {comments.length === 0 && <p className="text-center text-gray-400 dark:text-zinc-500 py-8">No comments yet. Be the first!</p>}
            {comments.map(c => {
              const userIdStr = String(user?.id || user?._id || '');
              const isCommentOwner = String(c.userId?._id || c.userId) === userIdStr;
              return (
                <div key={c._id} className="space-y-3">
                  <div className="flex gap-3 p-4 bg-gray-50 dark:bg-zinc-800/50 rounded-xl group hover:bg-gray-100 dark:hover:bg-zinc-800 transition-colors">
                    <img src={c.userId?.profileImage || `https://ui-avatars.com/api/?name=${c.userId?.name}&background=random&color=fff`} alt="User" className="w-9 h-9 rounded-full flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <p className="font-semibold text-sm text-gray-900 dark:text-zinc-100 truncate">{c.userId?.name}</p>
                        {isCommentOwner && (
                          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={() => { setEditingCommentId(c._id); setEditCommentText(c.content); }} className="p-1 text-gray-400 dark:text-zinc-500 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 rounded"><Edit3 size={14} /></button>
                            <button onClick={() => handleCommentDelete(c._id)} className="p-1 text-gray-400 dark:text-zinc-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"><Trash2 size={14} /></button>
                          </div>
                        )}
                      </div>
                      {editingCommentId === c._id ? (
                        <div className="mt-2 flex flex-col sm:flex-row gap-2">
                          <input value={editCommentText} onChange={e => setEditCommentText(e.target.value)} className="flex-1 p-2 text-sm border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none" />
                          <div className="flex gap-2">
                            <button onClick={() => handleCommentEdit(c._id)} className="px-3 py-2 bg-indigo-600 text-white text-sm rounded-lg">Save</button>
                            <button onClick={() => setEditingCommentId(null)} className="px-3 py-2 text-gray-600 dark:text-zinc-400 hover:bg-gray-200 dark:hover:bg-zinc-700 rounded-lg">Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <p className="text-gray-700 dark:text-zinc-300 text-sm mt-1.5 leading-relaxed break-words">{c.content}</p>
                      )}
                      <div className="flex items-center gap-3 mt-2">
                        <button onClick={() => setReplyingTo(replyingTo === c._id ? null : c._id)} className="flex items-center gap-1 text-xs font-medium text-gray-500 dark:text-zinc-400 hover:text-indigo-600 dark:hover:text-indigo-400"><Reply size={13} /> Reply</button>
                        <span className="text-xs text-gray-400 dark:text-zinc-500">{timeAgo(c.createdAt)}</span>
                      </div>
                    </div>
                  </div>
                  {c.replies && c.replies.length > 0 && (
                    <div className="ml-4 sm:ml-12 space-y-2 border-l-2 border-gray-200 dark:border-zinc-700 pl-4">
                      {c.replies.map((reply, rIdx) => (
                        <div key={reply._id || rIdx} className="flex gap-3 p-3 bg-white dark:bg-zinc-900 rounded-lg border border-gray-100 dark:border-zinc-800">
                          <img src={reply.userId?.profileImage || `https://ui-avatars.com/api/?name=${reply.userId?.name}&background=random&color=fff`} alt="User" className="w-7 h-7 rounded-full flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="font-semibold text-xs text-gray-900 dark:text-zinc-100">{reply.userId?.name}</p>
                              <span className="text-xs text-gray-400 dark:text-zinc-500">{timeAgo(reply.createdAt)}</span>
                            </div>
                            <p className="text-gray-700 dark:text-zinc-300 text-sm mt-1 break-words">{reply.content}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {replyingTo === c._id && (
                    <div className="mt-3 flex flex-col sm:flex-row gap-2 ml-4 sm:ml-12 p-3 bg-indigo-50 dark:bg-indigo-900/10 rounded-xl border border-indigo-100 dark:border-indigo-800/30">
                      <input value={replyText} onChange={e => setReplyText(e.target.value)} placeholder={`Reply to ${c.userId?.name}...`} className="flex-1 p-2 text-sm  border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none" onKeyDown={(e) => e.key === 'Enter' && handleReply(c._id)} />
                      <div className="flex gap-2">
                        <button onClick={() => handleReply(c._id)} disabled={replyLoading} className="px-3 py-2 bg-indigo-600 text-white text-sm rounded-lg disabled:opacity-50 flex items-center gap-1"><Send size={14} /> {replyLoading ? '...' : 'Send'}</button>
                        <button onClick={() => { setReplyingTo(null); setReplyText(''); }} className="px-3 py-2 text-gray-600 dark:text-zinc-400 hover:bg-gray-200 dark:hover:bg-zinc-700 rounded-lg">Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <form onSubmit={addComment} className="flex flex-col sm:flex-row gap-3 border-t border-gray-200 dark:border-zinc-800 pt-4">
            <img src={user?.profileImage || `https://ui-avatars.com/api/?name=${user?.name}&background=random&color=fff`} alt="User" className="w-9 h-9 rounded-full flex-shrink-0 mx-auto sm:mx-0" />
            <input value={newComment} onChange={e => setNewComment(e.target.value)} placeholder="Add to the discussion..." className="flex-1 p-3 border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-white text-sm" />
            <button type="submit" disabled={loading} className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold px-5 py-3 rounded-lg transition-all disabled:opacity-50 shadow-md shadow-indigo-200 dark:shadow-none hover:shadow-lg flex items-center justify-center gap-2 w-full sm:w-auto">
              <Send size={18} /> <span>{loading ? 'Sending...' : 'Send'}</span>
            </button>
          </form>
        </div>
      </div>
    </UserLayout>
  );
};

const Profile = () => {
  const { id } = useParams();
  const { user: currentUser, updateUser } = useAuth();
  const [profileUser, setProfileUser] = useState(null);
  const [myPosts, setMyPosts] = useState([]);
  const [savedPosts, setSavedPosts] = useState([]);
  const [searchParams] = useSearchParams();
  const tab = searchParams.get('tab') || 'posts';
  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [userRes, postsRes] = await Promise.all([api.get(`/users/${id}`), api.get(`/users/${id}/posts`)]);
        setProfileUser(userRes.data); setName(userRes.data.name || ''); setBio(userRes.data.bio || ''); setMyPosts(postsRes.data);
        try { const savedRes = await api.get(`/users/me/saved`); setSavedPosts(savedRes.data); } catch { setSavedPosts([]); }
      } catch (err) {}
    };
    fetchData();
  }, [id]);

  const saveProfile = async () => {
    setLoading(true);
    try { const res = await api.put('/users/profile', { name, bio }); setProfileUser(res.data); updateUser({ name: res.data.name, bio: res.data.bio, profileImage: res.data.profileImage }); } catch (err) { alert('Failed'); }
    finally { setLoading(false); }
  };

  if (!profileUser) return <div className="max-w-2xl mx-auto p-4 text-center pt-20">Loading...</div>;
  const userIdStr = String(currentUser?.id || currentUser?._id || '');
  const isMe = String(profileUser._id) === userIdStr;

  return (
    <UserLayout>
      <div className="w-full">
        <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-4 sm:p-6 mb-6 flex flex-col sm:flex-row items-center sm:items-start gap-4 shadow-sm">
          <img src={profileUser.profileImage || `https://ui-avatars.com/api/?name=${profileUser.name}&background=random&color=fff`} alt="User" className="w-20 h-20 rounded-full border-4 border-white dark:border-zinc-700 shadow-md" />
          <div className="flex-1 text-center sm:text-left">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-zinc-100">{profileUser.name}</h2>
            <p className="text-gray-500 dark:text-zinc-400 mb-3 text-sm break-all">{profileUser.email}</p>
            <p className="text-gray-700 dark:text-zinc-300 text-sm">{profileUser.bio || 'No bio yet.'}</p>
          </div>
        </div>
        {isMe && (
          <div className="flex gap-4 border-b border-gray-200 dark:border-zinc-800 mb-6 overflow-x-auto">
            <Link to={`/profile/${id}?tab=posts`} className={`pb-3 px-2 font-medium text-sm transition-colors whitespace-nowrap ${tab === 'posts' ? 'text-indigo-600 dark:text-indigo-400 border-b-2 border-indigo-600 dark:border-indigo-400' : 'text-gray-500 dark:text-zinc-400 hover:text-gray-700 dark:hover:text-zinc-200'}`}>My Discussions</Link>
            <Link to={`/profile/${id}?tab=saved`} className={`pb-3 px-2 font-medium text-sm transition-colors whitespace-nowrap ${tab === 'saved' ? 'text-indigo-600 dark:text-indigo-400 border-b-2 border-indigo-600 dark:border-indigo-400' : 'text-gray-500 dark:text-zinc-400 hover:text-gray-700 dark:hover:text-zinc-200'}`}>Saved</Link>
            <Link to={`/profile/${id}?tab=settings`} className={`pb-3 px-2 font-medium text-sm transition-colors whitespace-nowrap ${tab === 'settings' ? 'text-indigo-600 dark:text-indigo-400 border-b-2 border-indigo-600 dark:border-indigo-400' : 'text-gray-500 dark:text-zinc-400 hover:text-gray-700 dark:hover:text-zinc-200'}`}>Settings</Link>
          </div>
        )}
        {tab === 'posts' && (
          <div className="space-y-4">
            {myPosts.length === 0 ? <p className="text-center text-gray-500 dark:text-zinc-400 py-8 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl">No discussions yet.</p> : myPosts.map(p => <PostCard key={p._id} post={p} />)}
          </div>
        )}
        {tab === 'saved' && (
          <div className="space-y-4">
            {savedPosts.length === 0 ? <div className="text-center py-12 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl"><Bookmark size={48} className="mx-auto text-gray-300 dark:text-zinc-700 mb-3" /><p className="text-gray-500 dark:text-zinc-400 font-medium">No saved posts.</p></div> : savedPosts.map(p => <PostCard key={p._id} post={p} />)}
          </div>
        )}
        {tab === 'settings' && isMe && (
          <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-4 sm:p-6 shadow-sm space-y-6">
            <div className="space-y-4">
              <h3 className="font-bold text-gray-900 dark:text-zinc-100 text-lg flex items-center gap-2"><Settings size={20} className="text-indigo-600 dark:text-indigo-400" /> Account Settings</h3>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-zinc-300 mb-1">Display Name</label>
                <input value={name} onChange={e => setName(e.target.value)} className="w-full text-white p-3 border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-zinc-300 mb-1">Email</label>
                <input value={profileUser.email} disabled className="w-full p-3 text-white border border-gray-200 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-800/50 text-gray-500 dark:text-zinc-500 rounded-lg" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-zinc-300 mb-1">Bio</label>
                <textarea value={bio} onChange={e => setBio(e.target.value)} className="w-full p-3 border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 rounded-lg focus:ring-2 focus:ring-indigo-500 text-white outline-none resize-none" rows="3" />
              </div>
              <button onClick={saveProfile} disabled={loading} className="w-full sm:w-auto bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2.5 rounded-lg font-medium transition-all shadow-md shadow-indigo-200 dark:shadow-none disabled:opacity-50 flex items-center justify-center gap-2">
                {loading ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div> : 'Save Changes'}
              </button>
            </div>
          </div>
        )}
      </div>
    </UserLayout>
  );
};

const Notifications = () => {
  const [notifs, setNotifs] = useState([]);
  const navigate = useNavigate();
  useEffect(() => {
    const fetchAndMark = async () => {
      try { const res = await api.get('/notifications'); setNotifs(res.data); await api.put('/notifications/read-all'); setNotifs(res.data.map(n => ({ ...n, read: true }))); } catch (err) {}
    };
    fetchAndMark();
  }, []);
  return (
    <UserLayout>
      <div className="w-full">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-zinc-100 mb-6">Notifications</h2>
        <div className="space-y-3">
          {notifs.length === 0 ? <p className="text-gray-500 dark:text-zinc-400 text-center py-8 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl">No notifications</p> : notifs.map(n => (
            <div key={n._id} onClick={() => n.post?._id && navigate(`/post/${n.post._id}`)} className={`bg-white dark:bg-zinc-900 border rounded-xl p-4 flex gap-3 transition-all cursor-pointer hover:shadow-md ${n.read ? 'border-gray-200 dark:border-zinc-800' : 'border-indigo-200 dark:border-indigo-800 bg-indigo-50/30 dark:bg-indigo-900/10 shadow-sm'}`}>
              <div className={`w-2 h-2 rounded-full mt-2 flex-shrink-0 ${n.read ? 'bg-gray-300 dark:bg-zinc-600' : 'bg-indigo-600 dark:bg-indigo-400 animate-pulse'}`} />
              <div className="flex-1 min-w-0">
                <p className="text-gray-900 dark:text-zinc-100 text-sm break-words">
                  <span className="font-semibold">{n.isAnnouncement ? 'Official Admin' : (n.fromUser?.name || 'User')}</span>
                  <span className="text-gray-600 dark:text-zinc-400"> {n.isAnnouncement ? `announced: ${n.content}` : n.content}</span>
                </p>
                <p className="text-xs text-gray-500 dark:text-zinc-400 mt-1">{timeAgo(n.createdAt)}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </UserLayout>
  );
};

const AdminDashboard = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('overview');
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState([]);
  const [posts, setPosts] = useState([]);
  const [comments, setComments] = useState([]);
  const [reports, setReports] = useState([]);
  const [categories, setCategories] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newAdminEmail, setNewAdminEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [isMobileAdminMenuOpen, setIsMobileAdminMenuOpen] = useState(false);

  const fetchAll = async () => {
    try {
      const [statsRes, usersRes, postsRes, commentsRes, reportsRes, catsRes] = await Promise.all([api.get('/admin/stats'), api.get('/admin/users'), api.get('/admin/posts'), api.get('/admin/comments'), api.get('/admin/reports'), api.get('/categories')]);
      setStats(statsRes.data); setUsers(usersRes.data); setPosts(postsRes.data); setComments(commentsRes.data); setReports(reportsRes.data); setCategories(catsRes.data);
    } catch (err) {}
  };

  useEffect(() => {
    if (!user?.isAdmin) { navigate('/dashboard'); return; }
    fetchAll();
    const socket = io(SOCKET_URL);
    socket.emit('joinAdmin');
    const handleUpdate = () => fetchAll();
    ['statsUpdate', 'userCreated', 'postCreated', 'postDeleted', 'commentDeleted', 'reportCreated', 'reportResolved', 'newAnnouncement'].forEach(evt => socket.on(evt, handleUpdate));
    return () => { ['statsUpdate', 'userCreated', 'postCreated', 'postDeleted', 'commentDeleted', 'reportCreated', 'reportResolved', 'newAnnouncement'].forEach(evt => socket.off(evt, handleUpdate)); socket.disconnect(); };
  }, [user, navigate]);

  const handleBanUser = async (userId) => { if (!window.confirm('Toggle ban?')) return; try { await api.put(`/admin/users/${userId}/toggle-ban`); fetchAll(); } catch { alert('Failed'); } };
  const handleToggleAdmin = async (userId) => { if (!window.confirm('Toggle admin?')) return; try { await api.put(`/admin/users/${userId}/toggle-admin`); fetchAll(); } catch (err) { alert(err.response?.data?.message || 'Failed'); } };
  const handleDeleteUser = async (userId) => { if (!window.confirm('Delete user?')) return; try { await api.delete(`/admin/users/${userId}`); fetchAll(); } catch { alert('Failed'); } };
  const handleDeletePost = async (postId) => { if (!window.confirm('Delete post?')) return; try { await api.delete(`/posts/${postId}`); fetchAll(); } catch { alert('Failed'); } };
  const handleDeleteComment = async (commentId) => { if (!window.confirm('Delete comment?')) return; try { await api.delete(`/admin/comments/${commentId}`); fetchAll(); } catch { alert('Failed'); } };
  const handleResolveReport = async (reportId, action) => { try { await api.put(`/admin/reports/${reportId}/resolve`, { action }); fetchAll(); alert('Resolved'); } catch { alert('Failed'); } };
  const handleDismissReport = async (reportId) => { try { await api.put(`/admin/reports/${reportId}/dismiss`); fetchAll(); } catch { alert('Failed'); } };
  const sendAnnouncement = async () => { if (!announcement.trim()) return; setLoading(true); try { await api.post('/admin/announcements', { content: announcement }); setAnnouncement(''); alert('Sent!'); } catch { alert('Failed'); } finally { setLoading(false); } };
  const handleAddCategory = async () => { if (!newCategoryName.trim()) return; try { await api.post('/categories', { name: newCategoryName }); setNewCategoryName(''); fetchAll(); } catch (err) { alert(err.response?.data?.message || 'Failed'); } };
  const handleDeleteCategory = async (catId) => { if (!window.confirm('Delete category?')) return; try { await api.delete(`/categories/${catId}`); fetchAll(); } catch { alert('Failed'); } };
  const filteredUsers = users.filter(u => u.name?.toLowerCase().includes(searchTerm.toLowerCase()) || u.email?.toLowerCase().includes(searchTerm.toLowerCase()));
  const handleToggleAdminByEmail = async (email) => { try { const res = await api.get('/admin/users'); const targetUser = res.data.find(u => u.email.toLowerCase() === email.toLowerCase()); if (!targetUser) { alert('User not found'); return; } await api.put(`/admin/users/${targetUser._id}/toggle-admin`); alert(`${targetUser.name} is now ${targetUser.isAdmin ? 'a regular user' : 'an admin'}!`); } catch (err) { alert(err.response?.data?.message || 'Failed'); } };

  const tabs = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard }, { id: 'users', label: 'Users', icon: Users },
    { id: 'posts', label: 'Discussions', icon: MessageSquare }, { id: 'comments', label: 'Comments', icon: MessageCircle },
    { id: 'reports', label: 'Reports', icon: AlertTriangle }, { id: 'categories', label: 'Categories', icon: FolderOpen },
    { id: 'announcements', label: 'Announcements', icon: Megaphone }, { id: 'analytics', label: 'Analytics', icon: FileBarChart },
  ];

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-black flex flex-col lg:flex-row">
      <div className="lg:hidden bg-white dark:bg-zinc-900 border-b border-gray-200 dark:border-zinc-800 p-4 flex items-center justify-between sticky top-0 z-30">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-gradient-to-br from-red-500 to-orange-600 rounded-lg flex items-center justify-center text-white font-bold">A</div>
          <span className="font-bold text-gray-900 dark:text-zinc-100">Admin Panel</span>
        </div>
        <button onClick={() => setIsMobileAdminMenuOpen(!isMobileAdminMenuOpen)} className="p-2 text-gray-600 dark:text-zinc-400">
          <Menu size={24} />
        </button>
      </div>

      <aside className={`fixed inset-y-0 left-0 z-40 w-64 bg-white dark:bg-zinc-900 border-r border-gray-200 dark:border-zinc-800 transform transition-transform duration-300 lg:static lg:translate-x-0 lg:min-h-screen lg:flex-shrink-0 flex flex-col ${isMobileAdminMenuOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="hidden lg:flex items-center gap-2 mb-6 px-4 pt-4">
          <div className="w-8 h-8 bg-gradient-to-br from-red-500 to-orange-600 rounded-lg flex items-center justify-center text-white font-bold">A</div>
          <span className="font-bold text-gray-900 dark:text-zinc-100">Admin Panel</span>
        </div>
        <div className="lg:hidden p-4 border-b border-gray-200 dark:border-zinc-800 flex justify-between items-center">
          <span className="font-bold text-gray-900 dark:text-zinc-100">Menu</span>
          <button onClick={() => setIsMobileAdminMenuOpen(false)}><X size={20} className="text-gray-500" /></button>
        </div>
        <nav className="flex-1 px-3 space-y-1 overflow-y-auto py-4">
          {tabs.map(tab => (
            <button key={tab.id} onClick={() => { setActiveTab(tab.id); setIsMobileAdminMenuOpen(false); }} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${activeTab === tab.id ? 'bg-indigo-600 text-white shadow-sm' : 'text-gray-700 dark:text-zinc-400 hover:bg-gray-100 dark:hover:bg-zinc-800'}`}>
              <tab.icon size={18} /> {tab.label}
              {tab.id === 'reports' && reports.filter(r => r.status === 'pending').length > 0 && <span className="ml-auto bg-red-500 text-white text-xs px-2 py-0.5 rounded-full">{reports.filter(r => r.status === 'pending').length}</span>}
            </button>
          ))}
        </nav>
        <div className="p-4 border-t border-gray-200 dark:border-zinc-800 space-y-2">
          <button onClick={() => { navigate('/dashboard'); setIsMobileAdminMenuOpen(false); }} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-gray-700 dark:text-zinc-400 hover:bg-gray-100 dark:hover:bg-zinc-800"><Home size={18} /> Back to Site</button>
          <button onClick={logout} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"><LogOut size={18} /> Logout</button>
        </div>
      </aside>

      {isMobileAdminMenuOpen && <div className="fixed inset-0 bg-black/50 z-30 lg:hidden" onClick={() => setIsMobileAdminMenuOpen(false)}></div>}

      <main className="flex-1 p-4 sm:p-6 w-full overflow-x-hidden">
        {activeTab === 'overview' && stats && (
          <div className="space-y-6">
            <h2 className="text-xl font-bold text-gray-900 dark:text-zinc-100">Platform Overview</h2>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                { label: 'Total Users', value: stats.totalUsers, icon: Users, color: 'from-blue-500 to-blue-600' },
                { label: 'Discussions', value: stats.totalDiscussions, icon: MessageSquare, color: 'from-purple-500 to-purple-600' },
                { label: 'Comments', value: stats.totalComments, icon: MessageCircle, color: 'from-emerald-500 to-emerald-600' },
                { label: 'Pending Reports', value: stats.reportedContent, icon: AlertTriangle, color: 'from-red-500 to-red-600' },
              ].map((s, i) => (
                <div key={i} className={`bg-gradient-to-br ${s.color} rounded-2xl p-5 text-white shadow-lg`}>
                  <s.icon size={24} className="mb-2 opacity-80" /><p className="text-2xl font-bold">{s.value}</p><p className="text-xs opacity-90">{s.label}</p>
                </div>
              ))}
            </div>
          </div>
        )}
        {activeTab === 'users' && (
          <div className="space-y-4">
            <div className="flex justify-between items-center flex-wrap gap-3">
              <h2 className="text-xl font-bold text-gray-900 dark:text-zinc-100">User Management</h2>
              <input value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder="Search users..." className="px-4 py-2 border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none w-full sm:w-auto" />
            </div>
            <div className="bg-indigo-50 dark:bg-indigo-900/20 rounded-xl p-5 border border-indigo-100 dark:border-indigo-800">
              <h3 className="font-bold text-gray-900 dark:text-zinc-100 mb-3 flex items-center gap-2"><UserPlus size={18} className="text-indigo-600 dark:text-indigo-400" /> Add New Admin</h3>
              <div className="flex flex-col sm:flex-row gap-2">
                <input value={newAdminEmail} onChange={e => setNewAdminEmail(e.target.value)} placeholder="Enter user email..." className="flex-1 px-4 py-2 border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
                <button onClick={() => { if(newAdminEmail.trim()) { handleToggleAdminByEmail(newAdminEmail.trim()); setNewAdminEmail(''); } }} disabled={loading || !newAdminEmail.trim()} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 flex items-center justify-center gap-2"><UserPlus size={16} /> Make Admin</button>
              </div>
            </div>
            <div className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-800 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[600px]">
                  <thead className="bg-gray-50 dark:bg-zinc-800 border-b border-gray-200 dark:border-zinc-700">
                    <tr>
                      <th className="text-left p-3 text-xs font-semibold text-gray-600 dark:text-zinc-400">User</th>
                      <th className="text-left p-3 text-xs font-semibold text-gray-600 dark:text-zinc-400">Email</th>
                      <th className="text-left p-3 text-xs font-semibold text-gray-600 dark:text-zinc-400">Status</th>
                      <th className="text-left p-3 text-xs font-semibold text-gray-600 dark:text-zinc-400">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredUsers.map(u => (
                      <tr key={u._id} className="border-b border-gray-100 dark:border-zinc-800 hover:bg-gray-50 dark:hover:bg-zinc-800/50">
                        <td className="p-3"><div className="flex items-center gap-2"><img src={u.profileImage} alt={u.name} className="w-8 h-8 rounded-full" /><span className="text-sm font-medium text-gray-900 dark:text-zinc-100">{u.name}</span>{u.isAdmin && <span className="text-xs bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-400 px-2 py-0.5 rounded-full">Admin</span>}</div></td>
                        <td className="p-3 text-sm text-gray-600 dark:text-zinc-400">{u.email}</td>
                        <td className="p-3">{u.isBanned ? <span className="text-xs bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400 px-2 py-1 rounded-full">Banned</span> : <span className="text-xs bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400 px-2 py-1 rounded-full">Active</span>}</td>
                        <td className="p-3">
                          <div className="flex gap-2">
                            <button onClick={() => handleToggleAdmin(u._id)} className={`p-2 rounded-lg ${u.isAdmin ? 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-400' : 'bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-zinc-400'}`}><UserPlus size={16} /></button>
                            {!u.isAdmin && (<><button onClick={() => handleBanUser(u._id)} className="p-2 bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-400 rounded-lg"><Shield size={16} /></button><button onClick={() => handleDeleteUser(u._id)} className="p-2 bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400 rounded-lg"><Trash2 size={16} /></button></>)}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
        {activeTab === 'posts' && (
          <div className="space-y-4">
            <h2 className="text-xl font-bold text-gray-900 dark:text-zinc-100">Discussion Management</h2>
            <div className="space-y-3">
              {posts.map(p => (
                <div key={p._id} className="bg-white dark:bg-zinc-900 rounded-xl p-4 border border-gray-200 dark:border-zinc-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  <div className="flex-1 min-w-0"><h3 className="font-semibold text-gray-900 dark:text-zinc-100 truncate">{p.title}</h3><p className="text-xs text-gray-500 dark:text-zinc-400 mt-1">by {p.userId?.name || 'Unknown'} • {p.category} • {timeAgo(p.createdAt)}</p></div>
                  <button onClick={() => handleDeletePost(p._id)} className="text-xs px-3 py-1.5 bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400 rounded-lg flex-shrink-0 w-full sm:w-auto">Delete</button>
                </div>
              ))}
            </div>
          </div>
        )}
        {activeTab === 'comments' && (
          <div className="space-y-4">
            <h2 className="text-xl font-bold text-gray-900 dark:text-zinc-100">Comment Management</h2>
            <div className="space-y-3">
              {comments.map(c => (
                <div key={c._id} className="bg-white dark:bg-zinc-900 rounded-xl p-4 border border-gray-200 dark:border-zinc-800">
                  <div className="flex flex-col sm:flex-row items-start justify-between gap-3">
                    <div className="flex-1"><p className="text-sm font-medium text-gray-900 dark:text-zinc-100">{c.userId?.name}</p><p className="text-sm text-gray-700 dark:text-zinc-300 mt-1 break-words">{c.content}</p><p className="text-xs text-gray-500 dark:text-zinc-400 mt-2">On: {c.postId?.title || 'Unknown post'} • {timeAgo(c.createdAt)}</p></div>
                    <button onClick={() => handleDeleteComment(c._id)} className="text-xs px-3 py-1.5 bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400 rounded-lg flex-shrink-0 w-full sm:w-auto">Delete</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {activeTab === 'reports' && (
          <div className="space-y-4">
            <h2 className="text-xl font-bold text-gray-900 dark:text-zinc-100">Report Management</h2>
            <div className="space-y-3">
              {reports.map(r => (
                <div key={r._id} className={`bg-white dark:bg-zinc-900 rounded-xl p-4 border-2 ${r.status === 'pending' ? 'border-yellow-300 dark:border-yellow-800' : r.status === 'resolved' ? 'border-green-300 dark:border-green-800' : 'border-gray-200 dark:border-zinc-800'}`}>
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div><p className="text-sm font-semibold text-gray-900 dark:text-zinc-100">Reported by: {r.reportedBy?.name}</p><p className="text-xs text-gray-500 dark:text-zinc-400">Reason: {r.reason} • {timeAgo(r.createdAt)}</p></div>
                    <span className={`text-xs px-2 py-1 rounded-full ${r.status === 'pending' ? 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-400' : r.status === 'resolved' ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400' : 'bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-zinc-400'}`}>{r.status}</span>
                  </div>
                  {r.description && <p className="text-sm text-gray-700 dark:text-zinc-300 mb-3">{r.description}</p>}
                  {r.status === 'pending' && (
                    <div className="flex flex-wrap gap-2">
                      <button onClick={() => handleDismissReport(r._id)} className="text-xs px-3 py-1.5 bg-gray-100 dark:bg-zinc-800 text-gray-700 dark:text-zinc-300 rounded-lg">Dismiss</button>
                      <button onClick={() => handleResolveReport(r._id, 'warn')} className="text-xs px-3 py-1.5 bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-400 rounded-lg">Warn User</button>
                      <button onClick={() => handleResolveReport(r._id, 'delete')} className="text-xs px-3 py-1.5 bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-400 rounded-lg">Delete Content</button>
                      <button onClick={() => handleResolveReport(r._id, 'ban')} className="text-xs px-3 py-1.5 bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400 rounded-lg">Ban User</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
        {activeTab === 'categories' && (
          <div className="space-y-4">
            <h2 className="text-xl font-bold text-gray-900 dark:text-zinc-100">Category Management</h2>
            <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-xl p-5 border border-emerald-100 dark:border-emerald-800">
              <h3 className="font-bold text-gray-900 dark:text-zinc-100 mb-3 flex items-center gap-2"><Plus size={18} className="text-emerald-600 dark:text-emerald-400" /> Add New Topic</h3>
              <div className="flex flex-col sm:flex-row gap-2">
                <input value={newCategoryName} onChange={e => setNewCategoryName(e.target.value)} placeholder="Enter category name..." className="flex-1 px-4 py-2 border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 outline-none" />
                <button onClick={handleAddCategory} disabled={!newCategoryName.trim()} className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 flex items-center justify-center gap-2"><Plus size={16} /> Add Category</button>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {categories.map(c => (
                <div key={c._id} className="bg-white dark:bg-zinc-900 rounded-xl p-4 border border-gray-200 dark:border-zinc-800 flex items-center justify-between">
                  <div className="flex items-center gap-2"><Badge type={c.name} /><span className="font-medium text-gray-900 dark:text-zinc-100">{c.name}</span></div>
                  <button onClick={() => handleDeleteCategory(c._id)} className="text-xs px-3 py-1 bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400 rounded-lg">Delete</button>
                </div>
              ))}
            </div>
          </div>
        )}
        {activeTab === 'announcements' && (
          <div className="space-y-4">
            <h2 className="text-xl font-bold text-gray-900 dark:text-zinc-100">Send Announcement</h2>
            <div className="bg-white dark:bg-zinc-900 rounded-2xl p-6 border border-gray-200 dark:border-zinc-800">
              <p className="text-sm text-gray-600 dark:text-zinc-400 mb-4">Send important notifications to all users instantly.</p>
              <textarea value={announcement} onChange={e => setAnnouncement(e.target.value)} placeholder="Write your announcement..." className="w-full h-32 p-3 border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none resize-none" />
              <button onClick={sendAnnouncement} disabled={!announcement.trim() || loading} className="mt-3 bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2.5 rounded-lg font-medium hover:shadow-lg disabled:opacity-50 flex items-center gap-2"><Megaphone size={18} /> {loading ? 'Sending...' : 'Send to All Users'}</button>
            </div>
          </div>
        )}
        {activeTab === 'analytics' && stats && (
          <div className="space-y-6">
            <h2 className="text-xl font-bold text-gray-900 dark:text-zinc-100">Platform Analytics</h2>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-2xl p-5 text-white shadow-lg"><Users size={24} className="mb-2 opacity-80" /><p className="text-2xl font-bold">{stats.totalUsers}</p><p className="text-xs opacity-90">Total Users</p></div>
              <div className="bg-gradient-to-br from-purple-500 to-purple-600 rounded-2xl p-5 text-white shadow-lg"><MessageSquare size={24} className="mb-2 opacity-80" /><p className="text-2xl font-bold">{stats.totalDiscussions}</p><p className="text-xs opacity-90">Total Discussions</p></div>
              <div className="bg-gradient-to-br from-emerald-500 to-emerald-600 rounded-2xl p-5 text-white shadow-lg"><MessageCircle size={24} className="mb-2 opacity-80" /><p className="text-2xl font-bold">{stats.totalComments}</p><p className="text-xs opacity-90">Total Comments</p></div>
              <div className="bg-gradient-to-br from-pink-500 to-pink-600 rounded-2xl p-5 text-white shadow-lg"><Heart size={24} className="mb-2 opacity-80" /><p className="text-2xl font-bold">{stats.totalAppreciations}</p><p className="text-xs opacity-90">Total Appreciations</p></div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-white dark:bg-zinc-900 rounded-2xl p-5 border border-gray-200 dark:border-zinc-800 shadow-sm"><p className="text-sm text-gray-500 dark:text-zinc-400 mb-1">New Users (Last 7 Days)</p><p className="text-3xl font-bold text-gray-900 dark:text-zinc-100">{stats.newUsers}</p></div>
              <div className="bg-white dark:bg-zinc-900 rounded-2xl p-5 border border-gray-200 dark:border-zinc-800 shadow-sm"><p className="text-sm text-gray-500 dark:text-zinc-400 mb-1">Reported Content</p><p className="text-3xl font-bold text-red-600">{stats.reportedContent}</p></div>
              <div className="bg-white dark:bg-zinc-900 rounded-2xl p-5 border border-gray-200 dark:border-zinc-800 shadow-sm"><p className="text-sm text-gray-500 dark:text-zinc-400 mb-1">Active Users (Last 7 Days)</p><p className="text-3xl font-bold text-emerald-600">{stats.userActivity.reduce((sum, item) => sum + item.count, 0)}</p></div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

const AppShell = () => {
  const { user } = useAuth();
  if (!user || !user.id) return <Routes><Route path="*" element={<AuthPage />} /></Routes>;
  if (user.isAdmin) {
    return (
      <Routes>
        <Route path="/dashboard" element={<Dashboard />} /><Route path="/create-post" element={<CreatePost />} />
        <Route path="/post/:id" element={<PostDetail />} /><Route path="/profile/:id" element={<Profile />} />
        <Route path="/notifications" element={<Notifications />} /><Route path="/admin" element={<AdminDashboard />} />
        <Route path="*" element={<AdminDashboard />} />
      </Routes>
    );
  }
  return (
    <Routes>
      <Route path="/dashboard" element={<Dashboard />} /><Route path="/create-post" element={<CreatePost />} />
      <Route path="/post/:id" element={<PostDetail />} /><Route path="/profile/:id" element={<Profile />} />
      <Route path="/notifications" element={<Notifications />} /><Route path="*" element={<Dashboard />} />
    </Routes>
  );
};

export default function Root() {
  return (
    <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
      <GlobalStyles />
      <ThemeProvider>
        <AuthProvider>
          <Router><AppShell /></Router>
        </AuthProvider>
      </ThemeProvider>
    </GoogleOAuthProvider>
  );
}