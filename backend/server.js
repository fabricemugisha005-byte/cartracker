require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');

const app = express();
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// --- MIDDLEWARE ---
app.use(cors({ 
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (origin.match(/^http:\/\/localhost:\d+$/)) return callback(null, true);
    if (origin.match(/\.vercel\.app$/)) return callback(null, true);
    if (origin.match(/\.onrender\.com$/)) return callback(null, true);
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true 
}));
app.use(express.json());
app.use(cookieParser());

// --- DATABASE CONNECTION (MongoDB Atlas) ---
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ MongoDB Connected Successfully'))
  .catch(err => console.error('❌ MongoDB Connection Error:', err));

// --- MONGOOSE MODELS (No SQL Tables Needed!) ---
const User = mongoose.model('User', new mongoose.Schema({
  name: String, 
  email: { type: String, unique: true }, 
  password: String,
  googleId: String, 
  profileImage: String
}, { timestamps: true }));

const Post = mongoose.model('Post', new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  content: String
}, { timestamps: true }));

const Comment = mongoose.model('Comment', new mongoose.Schema({
  postId: { type: mongoose.Schema.Types.ObjectId, ref: 'Post' },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  content: String
}, { timestamps: true }));

const Reply = mongoose.model('Reply', new mongoose.Schema({
  commentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Comment' },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  content: String
}, { timestamps: true }));

// --- AUTH MIDDLEWARE ---
const authenticateToken = async (req, res, next) => {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: 'Access denied.' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = await User.findById(decoded.id).select('-password');
    if (!req.user) return res.status(401).json({ error: 'Invalid token.' });
    next();
  } catch (err) {
    res.status(403).json({ error: 'Invalid or expired token.' });
  }
};

const generateToken = (userId) => jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: '7d' });

// ==========================================
// 🔐 AUTHENTICATION ROUTES
// ==========================================
app.post('/api/auth/register', async (req, res) => {
  const { name, email, password, confirmPassword } = req.body;
  if (!name || !email || !password || !confirmPassword) return res.status(400).json({ error: 'All fields required.' });
  if (password !== confirmPassword) return res.status(400).json({ error: 'Passwords do not match.' });
  
  try {
    if (await User.findOne({ email })) return res.status(400).json({ error: 'Email already registered.' });
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await User.create({ name, email, password: hashedPassword });
    const token = generateToken(user._id);
    res.cookie('token', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax', maxAge: 7 * 24 * 60 * 60 * 1000 })
       .json({ message: 'Registered successfully.' });
  } catch (err) {
    res.status(500).json({ error: 'Server error.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await User.findOne({ email });
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(400).json({ error: 'Invalid email or password.' });
    }
    const token = generateToken(user._id);
    res.cookie('token', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax', maxAge: 7 * 24 * 60 * 60 * 1000 })
       .json({ message: 'Logged in successfully.' });
  } catch (err) {
    res.status(500).json({ error: 'Server error.' });
  }
});

app.post('/api/auth/google', async (req, res) => {
  const { token } = req.body;
  try {
    const ticket = await client.verifyIdToken({ idToken: token, audience: process.env.GOOGLE_CLIENT_ID });
    const { sub: googleId, email, name, picture } = ticket.getPayload();
    let user = await User.findOne({ $or: [{ googleId }, { email }] });
    
    if (!user) {
      user = await User.create({ name, email, googleId, profileImage: picture });
    } else if (!user.googleId) {
      user.googleId = googleId;
      user.profileImage = picture;
      await user.save();
    }
    const jwtToken = generateToken(user._id);
    res.cookie('token', jwtToken, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax', maxAge: 7 * 24 * 60 * 60 * 1000 })
       .json({ message: 'Google login successful.' });
  } catch (err) {
    res.status(400).json({ error: 'Invalid Google token.' });
  }
});

app.get('/api/auth/me', authenticateToken, (req, res) => {
  res.json({ id: req.user._id, name: req.user.name, email: req.user.email, profile_image: req.user.profileImage });
});

app.post('/api/auth/logout', (req, res) => res.clearCookie('token').json({ message: 'Logged out.' }));

// ==========================================
// 📝 POSTS ROUTES
// ==========================================
app.get('/api/posts', async (req, res) => {
  try {
    const posts = await Post.find().sort({ createdAt: -1 }).populate('userId', 'name profileImage');
    const postsWithCounts = await Promise.all(posts.map(async (post) => {
      const count = await Comment.countDocuments({ postId: post._id });
      return { 
        id: post._id, content: post.content, user_id: post.userId._id, 
        name: post.userId.name, profile_image: post.userId.profileImage, 
        comment_count: count, created_at: post.createdAt, updated_at: post.updatedAt 
      };
    }));
    res.json(postsWithCounts);
  } catch (err) { res.status(500).json({ error: 'Server error.' }); }
});

app.post('/api/posts', authenticateToken, async (req, res) => {
  const { content } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: 'Post content required.' });
  try {
    const post = await Post.create({ userId: req.user._id, content });
    res.status(201).json({ id: post._id, content, user_id: req.user._id });
  } catch (err) { res.status(500).json({ error: 'Server error.' }); }
});

app.get('/api/posts/:id', async (req, res) => {
  try {
    const post = await Post.findById(req.params.id).populate('userId', 'name profileImage');
    if (!post) return res.status(404).json({ error: 'Post not found.' });
    res.json({ 
      id: post._id, content: post.content, user_id: post.userId._id, 
      name: post.userId.name, profile_image: post.userId.profileImage, 
      created_at: post.createdAt, updated_at: post.updatedAt 
    });
  } catch (err) { res.status(500).json({ error: 'Server error.' }); }
});

app.put('/api/posts/:id', authenticateToken, async (req, res) => {
  const { content } = req.body;
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ error: 'Post not found.' });
    if (post.userId.toString() !== req.user._id.toString()) return res.status(403).json({ error: 'Not authorized.' });
    post.content = content;
    await post.save();
    res.json({ message: 'Post updated.' });
  } catch (err) { res.status(500).json({ error: 'Server error.' }); }
});

app.delete('/api/posts/:id', authenticateToken, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ error: 'Post not found.' });
    if (post.userId.toString() !== req.user._id.toString()) return res.status(403).json({ error: 'Not authorized.' });
    
    // Cascade delete comments and replies
    const comments = await Comment.find({ postId: post._id });
    const commentIds = comments.map(c => c._id);
    await Reply.deleteMany({ commentId: { $in: commentIds } });
    await Comment.deleteMany({ postId: post._id });
    await post.deleteOne();
    
    res.json({ message: 'Post deleted.' });
  } catch (err) { res.status(500).json({ error: 'Server error.' }); }
});

// ==========================================
// 💬 COMMENTS & REPLIES ROUTES
// ==========================================
app.get('/api/posts/:id/comments', async (req, res) => {
  try {
    const comments = await Comment.find({ postId: req.params.id }).sort({ createdAt: 1 }).populate('userId', 'name profileImage');
    res.json(comments.map(c => ({ 
      id: c._id, content: c.content, user_id: c.userId._id, 
      name: c.userId.name, profile_image: c.userId.profileImage, created_at: c.createdAt 
    })));
  } catch (err) { res.status(500).json({ error: 'Server error.' }); }
});

app.post('/api/posts/:id/comments', authenticateToken, async (req, res) => {
  const { content } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: 'Comment content required.' });
  try {
    const comment = await Comment.create({ postId: req.params.id, userId: req.user._id, content });
    res.status(201).json({ id: comment._id, content, user_id: req.user._id });
  } catch (err) { res.status(500).json({ error: 'Server error.' }); }
});

app.get('/api/comments/:id/replies', async (req, res) => {
  try {
    const replies = await Reply.find({ commentId: req.params.id }).sort({ createdAt: 1 }).populate('userId', 'name profileImage');
    res.json(replies.map(r => ({ 
      id: r._id, content: r.content, user_id: r.userId._id, 
      name: r.userId.name, profile_image: r.userId.profileImage, created_at: r.createdAt 
    })));
  } catch (err) { res.status(500).json({ error: 'Server error.' }); }
});

app.post('/api/comments/:id/replies', authenticateToken, async (req, res) => {
  const { content } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: 'Reply content required.' });
  try {
    const reply = await Reply.create({ commentId: req.params.id, userId: req.user._id, content });
    res.status(201).json({ id: reply._id, content, user_id: req.user._id });
  } catch (err) { res.status(500).json({ error: 'Server error.' }); }
});

// ==========================================
// 👤 USERS & NOTIFICATIONS ROUTES
// ==========================================
app.get('/api/users/:id', async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password');
    if (!user) return res.status(404).json({ error: 'User not found.' });
    res.json({ id: user._id, name: user.name, email: user.email, profile_image: user.profileImage, created_at: user.createdAt });
  } catch (err) { res.status(500).json({ error: 'Server error.' }); }
});

app.get('/api/users/:id/posts', async (req, res) => {
  try {
    const posts = await Post.find({ userId: req.params.id }).sort({ createdAt: -1 }).populate('userId', 'name profileImage');
    const postsWithCounts = await Promise.all(posts.map(async (post) => {
      const count = await Comment.countDocuments({ postId: post._id });
      return { 
        id: post._id, content: post.content, user_id: post.userId._id, 
        name: post.userId.name, profile_image: post.userId.profileImage, 
        comment_count: count, created_at: post.createdAt, updated_at: post.updatedAt 
      };
    }));
    res.json(postsWithCounts);
  } catch (err) { res.status(500).json({ error: 'Server error.' }); }
});

app.get('/api/users/:id/comments', async (req, res) => {
  try {
    const comments = await Comment.find({ userId: req.params.id }).populate('postId', 'content userId');
    const replies = await Reply.find({ userId: req.params.id }).populate('commentId.postId', 'content userId');
    
    const formattedComments = comments.map(c => ({
      id: c._id, content: c.content, created_at: c.createdAt, post_id: c.postId._id,
      post_content: c.postId.content, post_author_name: 'User' 
    }));
    const formattedReplies = replies.map(r => ({
      id: r._id, content: r.content, created_at: r.createdAt, post_id: r.commentId.postId._id,
      post_content: r.commentId.postId.content, post_author_name: 'User'
    }));
    res.json({ comments: formattedComments, replies: formattedReplies });
  } catch (err) { res.status(500).json({ error: 'Server error.' }); }
});

app.get('/api/notifications', authenticateToken, async (req, res) => {
  try {
    const userPosts = await Post.find({ userId: req.user._id }).distinct('_id');
    const userComments = await Comment.find({ userId: req.user._id }).distinct('_id');
    
    const commentsOnMyPosts = await Comment.find({ postId: { $in: userPosts }, userId: { $ne: req.user._id } })
      .sort({ createdAt: -1 }).limit(20).populate('userId', 'name profileImage').populate('postId');
      
    const repliesToMyComments = await Reply.find({ commentId: { $in: userComments }, userId: { $ne: req.user._id } })
      .sort({ createdAt: -1 }).limit(20).populate('userId', 'name profileImage').populate('commentId.postId');

    const formatted = [
      ...commentsOnMyPosts.map(c => ({ id: `c_${c._id}`, user: c.userId.name, profile_image: c.userId.profileImage, content: `commented: "${c.content.substring(0, 40)}..."`, post_id: c.postId._id, created_at: c.createdAt })),
      ...repliesToMyComments.map(r => ({ id: `r_${r._id}`, user: r.userId.name, profile_image: r.userId.profileImage, content: `replied: "${r.content.substring(0, 40)}..."`, post_id: r.commentId.postId._id, created_at: r.createdAt }))
    ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 20);

    res.json(formatted);
  } catch (err) { res.status(500).json({ error: 'Server error.' }); }
});

// --- HOME ROUTE ---
app.get('/', (req, res) => res.send('MindShare Backend Running'));

// --- START SERVER ---
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🚀 MindShare Backend running on port ${PORT}`);
});