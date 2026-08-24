require('dotenv').config(); // MUST BE AT THE VERY TOP

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');

const app = express();
app.use(cors());
app.use(express.json());

// --- CONFIGURATION ---
const JWT_SECRET = process.env.JWT_SECRET || 'mindshare_super_secret_key_2024';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com'; // ⚠️ REPLACE THIS
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

// Connect to MongoDB (Smart fallback: uses .env if available, otherwise local)
const dbUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/mindshare';

mongoose.connect(dbUri)
  .then(() => console.log('✅ MongoDB Connected Successfully to:', dbUri.includes('127.0.0.1') ? 'Local' : 'Atlas Cloud'))
  .catch(err => console.error('MongoDB connection error:', err));

// --- DATABASE MODELS ---
const User = mongoose.model('User', new mongoose.Schema({
  name: String, 
  email: { type: String, unique: true }, 
  password: String, 
  googleId: String, 
  profileImage: String,
  createdAt: { type: Date, default: Date.now }
}));

const Reply = new mongoose.Schema({ 
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, 
  content: String, 
  createdAt: { type: Date, default: Date.now } 
});

const Comment = mongoose.model('Comment', new mongoose.Schema({
  postId: { type: mongoose.Schema.Types.ObjectId, ref: 'Post' },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  content: String,
  replies: [Reply],
  createdAt: { type: Date, default: Date.now }
}));

const Post = mongoose.model('Post', new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  content: String,
  createdAt: { type: Date, default: Date.now }
}));

// --- AUTH MIDDLEWARE ---
const auth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'No token provided' });
  }
  const token = authHeader.split(' ')[1];
  try { 
    req.user = jwt.verify(token, JWT_SECRET); 
    next(); 
  } catch (err) { 
    return res.status(401).json({ message: 'Invalid or expired token' }); 
  }
};

// --- AUTH ROUTES ---
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (await User.findOne({ email })) return res.status(400).json({ message: 'Email already exists' });
    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create({ name, email, password: hashed, profileImage: `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=random` });
    const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user._id, name: user.name, email: user.email, profileImage: user.profileImage } });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user || !user.password) return res.status(400).json({ message: 'Invalid credentials or use Google' });
    if (!(await bcrypt.compare(password, user.password))) return res.status(400).json({ message: 'Invalid credentials' });
    const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user._id, name: user.name, email: user.email, profileImage: user.profileImage } });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.post('/api/auth/google', async (req, res) => {
  try {
    const ticket = await googleClient.verifyIdToken({ idToken: req.body.credential, audience: GOOGLE_CLIENT_ID });
    const { sub, email, name, picture } = ticket.getPayload();
    let user = await User.findOne({ email });
    if (!user) {
      user = await User.create({ name, email, googleId: sub, profileImage: picture });
    } else if (!user.googleId) {
      user.googleId = sub; 
      user.profileImage = picture || user.profileImage; 
      await user.save();
    }
    const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user._id, name: user.name, email: user.email, profileImage: user.profileImage } });
  } catch (e) { res.status(400).json({ message: 'Invalid Google token' }); }
});

// --- POST ROUTES ---
app.get('/api/posts', async (req, res) => {
  const posts = await Post.find().sort({ createdAt: -1 }).populate('userId', 'name profileImage');
  res.json(posts);
});

app.get('/api/posts/:id', async (req, res) => {
  const post = await Post.findById(req.params.id).populate('userId', 'name profileImage');
  if (!post) return res.status(404).json({ message: 'Post not found' });
  res.json(post);
});

app.post('/api/posts', auth, async (req, res) => {
  const post = await Post.create({ userId: req.user.id, content: req.body.content });
  const populated = await post.populate('userId', 'name profileImage');
  res.status(201).json(populated);
});

app.put('/api/posts/:id', auth, async (req, res) => {
  const post = await Post.findById(req.params.id);
  if (!post) return res.status(404).json({ message: 'Post not found' });
  if (post.userId.toString() !== req.user.id) return res.status(403).json({ message: 'Unauthorized' });
  post.content = req.body.content;
  await post.save();
  const populated = await post.populate('userId', 'name profileImage');
  res.json(populated);
});

app.delete('/api/posts/:id', auth, async (req, res) => {
  const post = await Post.findById(req.params.id);
  if (!post) return res.status(404).json({ message: 'Post not found' });
  if (post.userId.toString() !== req.user.id) return res.status(403).json({ message: 'Unauthorized' });
  await Post.findByIdAndDelete(req.params.id);
  await Comment.deleteMany({ postId: req.params.id }); 
  res.json({ message: 'Post deleted successfully' });
});

// --- COMMENT & REPLY ROUTES ---
app.get('/api/posts/:postId/comments', async (req, res) => {
  const comments = await Comment.find({ postId: req.params.postId })
    .populate('userId', 'name profileImage')
    .populate('replies.userId', 'name profileImage')
    .sort({ createdAt: 1 });
  res.json(comments);
});

app.post('/api/posts/:postId/comments', auth, async (req, res) => {
  const comment = await Comment.create({ postId: req.params.postId, userId: req.user.id, content: req.body.content });
  const populated = await comment.populate('userId', 'name profileImage');
  res.status(201).json(populated);
});

app.post('/api/comments/:commentId/replies', auth, async (req, res) => {
  const comment = await Comment.findById(req.params.commentId);
  if (!comment) return res.status(404).json({ message: 'Comment not found' });
  comment.replies.push({ userId: req.user.id, content: req.body.content });
  await comment.save();
  const updated = await Comment.findById(comment._id).populate('userId', 'name profileImage').populate('replies.userId', 'name profileImage');
  res.json(updated);
});

// --- USER ROUTES ---
app.get('/api/users/:id', async (req, res) => {
  const user = await User.findById(req.params.id).select('-password -googleId');
  if (!user) return res.status(404).json({ message: 'User not found' });
  res.json(user);
});

app.get('/api/users/:id/posts', async (req, res) => {
  const posts = await Post.find({ userId: req.params.id }).sort({ createdAt: -1 }).populate('userId', 'name profileImage');
  res.json(posts);
});

// --- START SERVER ---
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 MindShare Backend running on port ${PORT}`));