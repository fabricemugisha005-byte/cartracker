require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: process.env.FRONTEND_URL || "http://localhost:3000", methods: ["GET", "POST", "PUT", "DELETE"] }
});

io.on('connection', (socket) => {
  socket.on('joinPost', (postId) => socket.join(`post_${postId}`));
  socket.on('joinUser', (userId) => socket.join(`user_${userId}`));
  socket.on('joinAdmin', () => socket.join('admin_room'));
});

const JWT_SECRET = process.env.JWT_SECRET || 'mindshare_super_secret_2024';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com';
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);
const dbUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/mindshare';

mongoose.connect(dbUri)
  .then(() => console.log('✅ MongoDB Connected Successfully'))
  .catch(err => console.error('❌ MongoDB Connection Error:', err));

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

// --- MODELS ---
const User = mongoose.model('User', new mongoose.Schema({
  name: String, email: { type: String, unique: true }, password: String,
  googleId: String, profileImage: String, bio: String,
  isAdmin: { type: Boolean, default: false }, isBanned: { type: Boolean, default: false },
  points: { type: Number, default: 0 }, createdAt: { type: Date, default: Date.now }
}));

const Post = mongoose.model('Post', new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  title: String, content: String, category: String, imageUrl: String, link: String,
  likes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  saves: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  isPoll: { type: Boolean, default: false },
  pollOptions: [{ text: String, votes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }] }],
  status: { type: String, enum: ['Published', 'Pending', 'Deleted'], default: 'Published' },
  createdAt: { type: Date, default: Date.now }
}));

const Comment = mongoose.model('Comment', new mongoose.Schema({
  postId: { type: mongoose.Schema.Types.ObjectId, ref: 'Post' },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  content: String,
  replies: [{ userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, content: String, createdAt: { type: Date, default: Date.now } }],
  createdAt: { type: Date, default: Date.now }
}));

const Notification = mongoose.model('Notification', new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  type: String, fromUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  post: { type: mongoose.Schema.Types.ObjectId, ref: 'Post' },
  comment: { type: mongoose.Schema.Types.ObjectId, ref: 'Comment' },
  content: String, read: { type: Boolean, default: false },
  isAnnouncement: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
}));

const Report = mongoose.model('Report', new mongoose.Schema({
  reportedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  post: { type: mongoose.Schema.Types.ObjectId, ref: 'Post' },
  comment: { type: mongoose.Schema.Types.ObjectId, ref: 'Comment' },
  reason: String, description: String,
  status: { type: String, enum: ['pending', 'resolved', 'dismissed'], default: 'pending' },
  action: { type: String, enum: ['none', 'delete', 'warn', 'ban'] },
  createdAt: { type: Date, default: Date.now }
}));

const Category = mongoose.model('Category', new mongoose.Schema({
  name: { type: String, unique: true }, description: String, icon: String,
  createdAt: { type: Date, default: Date.now }
}));

async function seedAdmin() {
  const adminEmail = 'admin@mindshare.com';
  const existing = await User.findOne({ email: adminEmail });
  if (!existing) {
    const hashed = await bcrypt.hash('admin123', 10);
    await User.create({
      name: 'Admin', email: adminEmail, password: hashed,
      profileImage: 'https://ui-avatars.com/api/?name=Admin&background=6366f1&color=fff',
      isAdmin: true, points: 999
    });
  }
  const defaults = ['Technology', 'Education', 'Science', 'Business', 'Lifestyle', 'Society', 'Creativity'];
  for (const n of defaults) { 
    await Category.findOneAndUpdate({ name: n }, { name: n }, { upsert: true });
  }
}
seedAdmin();

// --- MIDDLEWARE ---
const auth = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'No token provided' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(401).json({ message: 'Invalid token' }); }
};

const adminAuth = (req, res, next) => {
  if (!req.user?.isAdmin) return res.status(403).json({ message: 'Admin access required' });
  next();
};

// --- AUTH ROUTES ---
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (await User.findOne({ email })) return res.status(400).json({ message: 'Email already exists' });
    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create({ name, email, password: hashed, profileImage: `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=random` });
    const token = jwt.sign({ id: user._id, isAdmin: user.isAdmin }, JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ token, user: { id: user._id, name: user.name, email: user.email, profileImage: user.profileImage, bio: user.bio, isAdmin: user.isAdmin, points: user.points } });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user || !user.password) return res.status(400).json({ message: 'User not found or uses Google auth' });
    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) return res.status(400).json({ message: 'Invalid password' });
    if (user.isBanned) return res.status(403).json({ message: 'Account banned' });
    const token = jwt.sign({ id: user._id, isAdmin: user.isAdmin }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user._id, name: user.name, email: user.email, profileImage: user.profileImage, bio: user.bio, isAdmin: user.isAdmin, points: user.points } });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.post('/api/auth/google', async (req, res) => {
  try {
    const ticket = await googleClient.verifyIdToken({ idToken: req.body.credential, audience: GOOGLE_CLIENT_ID });
    const { sub, email, name, picture } = ticket.getPayload();
    let user = await User.findOne({ email });
    if (!user) user = await User.create({ name, email, googleId: sub, profileImage: picture });
    if (user.isBanned) return res.status(403).json({ message: 'Account banned' });
    const token = jwt.sign({ id: user._id, isAdmin: user.isAdmin }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user._id, name: user.name, email: user.email, profileImage: user.profileImage, bio: user.bio, isAdmin: user.isAdmin, points: user.points } });
  } catch (e) { res.status(400).json({ message: 'Invalid Google token' }); }
});

app.put('/api/users/profile', auth, async (req, res) => {
  try {
    const { name, bio } = req.body;
    const user = await User.findByIdAndUpdate(req.user.id, { name, bio }, { returnDocument: 'after' }).select('-password');
    res.json(user);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// --- POST ROUTES ---
app.get('/api/posts', async (req, res) => {
  try {
    const { search, category } = req.query;
    let query = { status: 'Published' };
    if (search) query.$or = [{ title: { $regex: search, $options: 'i' } }, { content: { $regex: search, $options: 'i' } }];
    if (category && category !== 'All') query.category = category;
    const posts = await Post.find(query).sort({ createdAt: -1 })
      .populate('userId', 'name profileImage')
      .populate('likes', 'name profileImage')
      .limit(50);
    const postsWithCounts = await Promise.all(posts.map(async (p) => {
      const count = await Comment.countDocuments({ postId: p._id });
      return { ...p.toObject(), commentCount: count };
    }));
    res.json(postsWithCounts);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.get('/api/posts/:id', async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ message: 'Invalid ID' });
    const post = await Post.findById(req.params.id)
      .populate('userId', 'name profileImage')
      .populate('likes', 'name profileImage');
    if (!post) return res.status(404).json({ message: 'Post not found' });
    const count = await Comment.countDocuments({ postId: post._id });
    res.json({ ...post.toObject(), commentCount: count });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.post('/api/posts', auth, async (req, res) => {
  try {
    const post = await Post.create({ userId: req.user.id, ...req.body });
    const populated = await post.populate([
      { path: 'userId', select: 'name profileImage' },
      { path: 'likes', select: 'name profileImage' }
    ]);
    const postWithCount = { ...populated.toObject(), commentCount: 0 };
    io.emit('newPost', postWithCount);
    res.status(201).json(postWithCount);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.put('/api/posts/:id', auth, async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ message: 'Invalid ID' });
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ message: 'Post not found' });
    if (post.userId.toString() !== req.user.id && !req.user.isAdmin) return res.status(403).json({ message: 'Unauthorized' });
    Object.assign(post, {
      title: req.body.title || post.title, content: req.body.content || post.content, 
      category: req.body.category || post.category,
      imageUrl: req.body.imageUrl !== undefined ? req.body.imageUrl : post.imageUrl,
      link: req.body.link !== undefined ? req.body.link : post.link
    });
    await post.save();
    const populated = await post.populate([
      { path: 'userId', select: 'name profileImage' },
      { path: 'likes', select: 'name profileImage' },
      { path: 'pollOptions.votes', select: 'name profileImage' }
    ]);
    io.to(`post_${post._id}`).emit('postUpdated', populated);
    res.json(populated);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.delete('/api/posts/:id', auth, async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ message: 'Invalid ID' });
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ message: 'Post not found' });
    if (post.userId.toString() !== req.user.id && !req.user.isAdmin) return res.status(403).json({ message: 'Unauthorized' });
    await Post.findByIdAndDelete(req.params.id);
    await Comment.deleteMany({ postId: req.params.id });
    io.emit('postDeleted', req.params.id);
    res.json({ message: 'Post deleted' });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.post('/api/posts/:id/like', auth, async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ message: 'Invalid ID' });
    const post = await Post.findById(req.params.id).populate('userId', 'name profileImage');
    const userId = req.user.id;
    const idx = post.likes.indexOf(userId);
    if (idx === -1) {
      post.likes.push(userId);
      const postOwnerId = post.userId ? (post.userId._id || post.userId).toString() : null;
      if (postOwnerId && postOwnerId !== userId) {
        await Notification.create({ userId: postOwnerId, type: 'like', fromUser: userId, post: post._id, content: 'liked your discussion' });
        io.to(`user_${postOwnerId}`).emit('newNotification');
      }
    } else {
      post.likes.splice(idx, 1);
    }
    await post.save();
    const populated = await post.populate([
      { path: 'userId', select: 'name profileImage' },
      { path: 'likes', select: 'name profileImage' },
      { path: 'pollOptions.votes', select: 'name profileImage' }
    ]);
    io.to(`post_${post._id}`).emit('postUpdated', populated);
    res.json(populated);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.post('/api/posts/:id/save', auth, async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ message: 'Invalid ID' });
    const post = await Post.findById(req.params.id);
    const idx = post.saves.indexOf(req.user.id);
    if (idx === -1) post.saves.push(req.user.id); else post.saves.splice(idx, 1);
    await post.save();
    res.json({ saved: idx === -1 });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.get('/api/posts/:id/comments', async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ message: 'Invalid ID' });
    const comments = await Comment.find({ postId: req.params.id })
      .populate('userId', 'name profileImage')
      .populate('replies.userId', 'name profileImage')
      .sort({ createdAt: 1 });
    res.json(comments);
  } catch (e) { 
    res.status(500).json({ message: e.message }); 
  }
});

app.post('/api/posts/:postId/comments', auth, async (req, res) => {
  try {
    if (!isValidId(req.params.postId)) return res.status(400).json({ message: 'Invalid ID' });
    const post = await Post.findById(req.params.postId).populate('userId', 'name profileImage');
    const comment = await Comment.create({ postId: req.params.postId, userId: req.user.id, content: req.body.content });
    const populatedComment = await comment.populate('userId', 'name profileImage');
    
    const postOwnerId = post.userId ? (post.userId._id || post.userId).toString() : null;
    if (postOwnerId && postOwnerId !== req.user.id) {
      await Notification.create({
        userId: postOwnerId, type: 'comment', fromUser: req.user.id, post: post._id, comment: comment._id, content: 'commented on your discussion'
      });
      io.to(`user_${postOwnerId}`).emit('newNotification');
    }
    io.emit('commentAdded', { postId: req.params.postId });
    io.to(`post_${req.params.postId}`).emit('newComment', populatedComment);
    res.status(201).json(populatedComment);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ✅ FIXED: Re-fetch to safely chain .populate()
app.put('/api/comments/:id', auth, async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ message: 'Invalid ID' });
    const comment = await Comment.findById(req.params.id);
    if (!comment) return res.status(404).json({ message: 'Comment not found' });
    if (comment.userId.toString() !== req.user.id) return res.status(403).json({ message: 'Unauthorized' });
    
    comment.content = req.body.content;
    await comment.save();
    
    // ✅ FIX: Re-fetch the comment to safely populate multiple paths
    const populated = await Comment.findById(comment._id)
      .populate('userId', 'name profileImage')
      .populate('replies.userId', 'name profileImage');
      
    io.to(`post_${comment.postId}`).emit('commentUpdated', populated);
    res.json(populated);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.delete('/api/comments/:id', auth, async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ message: 'Invalid ID' });
    const comment = await Comment.findById(req.params.id);
    if (!comment) return res.status(404).json({ message: 'Comment not found' });
    if (comment.userId.toString() !== req.user.id && !req.user.isAdmin) return res.status(403).json({ message: 'Unauthorized' });
    await Comment.findByIdAndDelete(req.params.id);
    io.emit('commentDeleted', { postId: comment.postId, commentId: req.params.id });
    res.json({ message: 'Comment deleted' });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ✅ FIXED: Re-fetch to safely chain .populate()
app.post('/api/comments/:id/replies', auth, async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ message: 'Invalid ID' });
    
    const comment = await Comment.findById(req.params.id).populate('userId', 'name profileImage');
    if (!comment) return res.status(404).json({ message: 'Comment not found' });
    
    comment.replies.push({ userId: req.user.id, content: req.body.content });
    await comment.save();
    
    // ✅ FIX: Re-fetch the comment to safely populate multiple paths
    const populated = await Comment.findById(comment._id)
      .populate('userId', 'name profileImage')
      .populate('replies.userId', 'name profileImage');
    
    // ✅ Safely get comment owner ID to prevent crashes if user was deleted
    const commentOwnerId = comment.userId ? (comment.userId._id || comment.userId).toString() : null;
    
    if (commentOwnerId && commentOwnerId !== req.user.id) {
      await Notification.create({
        userId: commentOwnerId,
        type: 'reply',
        fromUser: req.user.id,
        post: comment.postId,
        comment: comment._id,
        content: 'replied to your comment'
      });
      io.to(`user_${commentOwnerId}`).emit('newNotification');
    }
    
    io.to(`post_${comment.postId}`).emit('commentUpdated', populated);
    res.json(populated);
  } catch (e) { 
    console.error("Reply Error:", e);
    res.status(500).json({ message: e.message }); 
  }
});

// --- NOTIFICATION ROUTES ---
app.get('/api/notifications', auth, async (req, res) => {
  try {
    const notifs = await Notification.find({ userId: req.user.id })
      .populate('fromUser', 'name profileImage')
      .populate('post', 'title')
      .sort({ createdAt: -1 })
      .limit(50); 
    res.json(notifs);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.put('/api/notifications/read-all', auth, async (req, res) => {
  try {
    await Notification.updateMany({ userId: req.user.id }, { read: true });
    res.json({ message: 'Read all' });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.post('/api/reports', auth, async (req, res) => {
  try {
    const { postId, commentId, reason, description } = req.body;
    await Report.create({ reportedBy: req.user.id, post: postId, comment: commentId, reason, description });
    res.json({ message: 'Report submitted' });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// --- USER ROUTES ---
app.get('/api/users/me/saved', auth, async (req, res) => {
  try {
    const posts = await Post.find({ saves: req.user.id }).sort({ createdAt: -1 }).populate('userId', 'name profileImage');
    const postsWithCounts = await Promise.all(posts.map(async (p) => {
      const count = await Comment.countDocuments({ postId: p._id });
      return { ...p.toObject(), commentCount: count };
    }));
    res.json(postsWithCounts);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.get('/api/users/:id', async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ message: 'Invalid ID' });
    const user = await User.findById(req.params.id).select('-password');
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json(user);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.get('/api/users/:id/posts', async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ message: 'Invalid ID' });
    const posts = await Post.find({ userId: req.params.id, status: 'Published' }).sort({ createdAt: -1 }).populate('userId', 'name profileImage');
    const postsWithCounts = await Promise.all(posts.map(async (p) => {
      const count = await Comment.countDocuments({ postId: p._id });
      return { ...p.toObject(), commentCount: count };
    }));
    res.json(postsWithCounts);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// --- ADMIN ROUTES ---
app.get('/api/admin/stats', auth, adminAuth, async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const totalDiscussions = await Post.countDocuments({ status: 'Published' });
    const totalComments = await Comment.countDocuments();
    const reportedContent = await Report.countDocuments();
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const newUsers = await User.countDocuments({ createdAt: { $gte: sevenDaysAgo } });
    const recentPosts = await Post.countDocuments({ createdAt: { $gte: sevenDaysAgo } });
    const discussionsByCategory = await Post.aggregate([{ $match: { status: 'Published' } }, { $group: { _id: '$category', count: { $sum: 1 } } }]);
    const postsWithLikes = await Post.aggregate([{ $match: { status: 'Published' } }, { $group: { _id: null, totalLikes: { $sum: { $size: "$likes" } } } }]);
    const totalAppreciations = postsWithLikes.length > 0 ? postsWithLikes[0].totalLikes : 0;
    const userActivity = await User.aggregate([
      { $match: { createdAt: { $gte: sevenDaysAgo } } },
      { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } }
    ]);
    res.json({ totalUsers, totalDiscussions, totalComments, totalAppreciations, newUsers, recentPosts, reportedContent, discussionsByCategory, userActivity });
  } catch (e) { res.status(500).json({ message: 'Failed to fetch stats', error: e.message }); }
});

app.get('/api/admin/users', auth, adminAuth, async (req, res) => {
  try {
    const { search } = req.query;
    let query = {};
    if (search) query.name = { $regex: search, $options: 'i' };
    res.json(await User.find(query).select('-password').sort({ createdAt: -1 }));
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.put('/api/admin/users/:id/toggle-ban', auth, adminAuth, async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ message: 'Invalid ID' });
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (user.isAdmin) return res.status(400).json({ message: 'Cannot ban admin' });
    user.isBanned = !user.isBanned;
    await user.save();
    if (user.isBanned) io.to(`user_${user._id}`).emit('forceLogout', { message: 'Your account has been banned.' });
    res.json({ message: `User ${user.isBanned ? 'banned' : 'unbanned'}`, user });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.put('/api/admin/users/:id/toggle-admin', auth, adminAuth, async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ message: 'Invalid ID' });
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (req.user.id === req.params.id) return res.status(400).json({ message: 'Cannot change your own admin status' });
    user.isAdmin = !user.isAdmin;
    await user.save();
    res.json({ message: `User is now ${user.isAdmin ? 'an admin' : 'a regular user'}`, user: { id: user._id, name: user.name, email: user.email, isAdmin: user.isAdmin } });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.delete('/api/admin/users/:id', auth, adminAuth, async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ message: 'Invalid ID' });
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (user.isAdmin) return res.status(400).json({ message: 'Cannot delete admin' });
    await User.findByIdAndDelete(req.params.id);
    await Post.deleteMany({ userId: req.params.id });
    await Comment.deleteMany({ userId: req.params.id });
    res.json({ message: 'User deleted' });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.get('/api/admin/posts', auth, adminAuth, async (req, res) => {
  try {
    const posts = await Post.find().populate('userId', 'name email').sort({ createdAt: -1 });
    const postsWithCounts = await Promise.all(posts.map(async (p) => {
      const count = await Comment.countDocuments({ postId: p._id });
      return { ...p.toObject(), commentCount: count };
    }));
    res.json(postsWithCounts);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.get('/api/admin/comments', auth, adminAuth, async (req, res) => {
  try {
    res.json(await Comment.find().populate('userId', 'name email').populate('postId', 'title').sort({ createdAt: -1 }).limit(100));
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.delete('/api/admin/comments/:id', auth, adminAuth, async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ message: 'Invalid ID' });
    await Comment.findByIdAndDelete(req.params.id);
    res.json({ message: 'Comment deleted' });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.get('/api/admin/reports', auth, adminAuth, async (req, res) => {
  try {
    res.json(await Report.find().populate('reportedBy', 'name email').populate('post').populate('comment').sort({ createdAt: -1 }));
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.put('/api/admin/reports/:id/resolve', auth, adminAuth, async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ message: 'Invalid ID' });
    const { action } = req.body;
    const report = await Report.findById(req.params.id).populate('post').populate('comment');
    report.status = 'resolved'; report.action = action;
    await report.save();
    if (action === 'delete') {
      if (report.post) await Post.findByIdAndDelete(report.post._id);
      if (report.comment) await Comment.findByIdAndDelete(report.comment._id);
    } else if (action === 'ban' && report.post) {
      await User.findByIdAndUpdate(report.post.userId, { isBanned: true });
    }
    res.json({ message: 'Report resolved' });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.put('/api/admin/reports/:id/dismiss', auth, adminAuth, async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ message: 'Invalid ID' });
    await Report.findByIdAndUpdate(req.params.id, { status: 'dismissed', action: 'none' });
    res.json({ message: 'Report dismissed' });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// --- CATEGORY MANAGEMENT ---
app.get('/api/categories', async (req, res) => {
  try {
    let cats = await Category.find().sort({ createdAt: 1 });
    if (cats.length === 0) {
      const defaults = ['Technology', 'Education', 'Science', 'Business', 'Lifestyle', 'Society', 'Creativity'];
      cats = await Category.insertMany(defaults.map(n => ({ name: n })));
    }
    res.json(cats);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.post('/api/categories', auth, adminAuth, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ message: 'Name required' });
    const existing = await Category.findOne({ name });
    if (existing) return res.status(400).json({ message: 'Category exists' });
    const cat = await Category.create({ name });
    io.emit('newCategory', cat);
    res.status(201).json(cat);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.delete('/api/categories/:id', auth, adminAuth, async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ message: 'Invalid ID' });
    await Category.findByIdAndDelete(req.params.id);
    res.json({ message: 'Category deleted' });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.post('/api/admin/announcements', auth, adminAuth, async (req, res) => {
  try {
    const { content } = req.body;
    const users = await User.find({}, '_id');
    const notifs = users.map(u => ({
      userId: u._id, type: 'announcement', fromUser: null, content: content, isAnnouncement: true
    }));
    await Notification.insertMany(notifs);
    io.emit('newAnnouncement', { content, isAnnouncement: true });
    res.json({ message: 'Announcement sent' });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 MindShare Backend is running successfully on port ${PORT}`);
});