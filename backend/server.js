require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');

const app = express();
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// --- MIDDLEWARE ---
app.use(cors({ 
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) return callback(null, true);
    
    // Allowed origins (add your Vercel URL after deployment)
    const allowedOrigins = [
      'http://localhost:3000',
      'http://localhost:5173',
      'https://mindshare.vercel.app',  // ← Replace with your Vercel URL later
      'https://mindshare-*.vercel.app' // ← For preview deployments
    ];
    
    // Allow localhost for development
    if (origin.match(/^http:\/\/localhost:\d+$/)) {
      return callback(null, true);
    }
    
    // Allow Vercel domains
    if (origin.match(/\.vercel\.app$/)) {
      return callback(null, true);
    }
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      return callback(null, true);
    }
    
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true 
}));
app.use(express.json());
app.use(cookieParser());

// --- DATABASE CONNECTION ---
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Test DB connection
pool.getConnection()
  .then(conn => {
    console.log('✅ MySQL Connected Successfully');
    conn.release();
  })
  .catch(err => {
    console.error('❌ MySQL Connection Error:', err.message);
  });

// --- MIDDLEWARE: AUTHENTICATE ---
const authenticateToken = async (req, res, next) => {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: 'Access denied. No token provided.' });
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const [rows] = await pool.execute(
      'SELECT id, name, email, profile_image FROM users WHERE id = ?', 
      [decoded.id]
    );
    if (rows.length === 0) return res.status(401).json({ error: 'Invalid token.' });
    req.user = rows[0];
    next();
  } catch (err) {
    res.status(403).json({ error: 'Invalid or expired token.' });
  }
};

// --- MIDDLEWARE: AUTHORIZE OWNER ---
const authorizeOwner = (resourceUserId) => (req, res, next) => {
  if (req.user.id !== resourceUserId) {
    return res.status(403).json({ error: 'Not authorized.' });
  }
  next();
};

// --- HELPER: GENERATE TOKEN ---
const generateToken = (userId) => 
  jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: '7d' });

// ==========================================
// 🔐 AUTHENTICATION ROUTES
// ==========================================

// Register
app.post('/api/auth/register', async (req, res) => {
  const { name, email, password, confirmPassword } = req.body;
  
  if (!name || !email || !password || !confirmPassword) {
    return res.status(400).json({ error: 'All fields required.' });
  }
  if (password !== confirmPassword) {
    return res.status(400).json({ error: 'Passwords do not match.' });
  }
  
  try {
    const [existing] = await pool.execute('SELECT id FROM users WHERE email = ?', [email]);
    if (existing.length > 0) {
      return res.status(400).json({ error: 'Email already registered.' });
    }
    
    const hashedPassword = await bcrypt.hash(password, 10);
    const [result] = await pool.execute(
      'INSERT INTO users (name, email, password, created_at) VALUES (?, ?, ?, NOW())',
      [name, email, hashedPassword]
    );
    
    const token = generateToken(result.insertId);
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000
    }).json({ message: 'Registered successfully.' });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// Login
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required.' });
  }
  
  try {
    const [rows] = await pool.execute('SELECT id, password FROM users WHERE email = ?', [email]);
    if (rows.length === 0 || !(await bcrypt.compare(password, rows[0].password))) {
      return res.status(400).json({ error: 'Invalid email or password.' });
    }
    
    const token = generateToken(rows[0].id);
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000
    }).json({ message: 'Logged in successfully.' });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// Google Login - IMPROVED VERSION
app.post('/api/auth/google', async (req, res) => {
  const { token } = req.body;
  
  if (!token) {
    console.error('❌ Google login: No token received');
    return res.status(400).json({ error: 'Google token required.' });
  }
  
  try {
    console.log('🔐 Verifying Google token...');
    
    // Verify the token with Google
    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: process.env.GOOGLE_CLIENT_ID
    });
    
    const payload = ticket.getPayload();
    const { 
      sub: googleId, 
      email, 
      name, 
      picture,
      email_verified 
    } = payload;
    
    console.log('✅ Google token verified for:', email);
    console.log('📧 Email verified:', email_verified);
    
    // Check if user exists by google_id OR email
    let [rows] = await pool.execute(
      'SELECT * FROM users WHERE google_id = ? OR email = ?', 
      [googleId, email]
    );
    
    let user = rows[0];
    let isNewUser = false;
    
    if (!user) {
      // CREATE NEW USER
      console.log('🆕 Creating new user for:', email);
      const [result] = await pool.execute(
        'INSERT INTO users (name, email, google_id, profile_image, created_at) VALUES (?, ?, ?, ?, NOW())',
        [name, email, googleId, picture]
      );
      
      // Fetch the newly created user
      [rows] = await pool.execute('SELECT * FROM users WHERE id = ?', [result.insertId]);
      user = rows[0];
      isNewUser = true;
      console.log('✅ New user created with ID:', user.id);
      
    } else {
      // USER EXISTS - Update if needed
      console.log('👤 Existing user found:', user.email);
      
      // If user exists but doesn't have google_id linked, link it now
      if (!user.google_id) {
        console.log('🔗 Linking Google account to existing user');
        await pool.execute(
          'UPDATE users SET google_id = ?, profile_image = COALESCE(?, profile_image) WHERE id = ?',
          [googleId, picture, user.id]
        );
        user.google_id = googleId;
        if (picture) user.profile_image = picture;
      }
    }
    
    // Generate JWT token
    const jwtToken = generateToken(user.id);
    
    // Set cookie
    res.cookie('token', jwtToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });
    
    // Return user info
    res.json({ 
      message: isNewUser ? 'Account created successfully!' : 'Login successful!',
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        profile_image: user.profile_image
      }
    });
    
  } catch (err) {
    console.error('❌ Google login error:', err.message);
    console.error('Error details:', err);
    
    if (err.message.includes('audience')) {
      return res.status(400).json({ 
        error: 'Google Client ID mismatch. Check your GOOGLE_CLIENT_ID in .env file.' 
      });
    }
    
    if (err.message.includes('Token used too late')) {
      return res.status(400).json({ 
        error: 'Google token expired. Please try again.' 
      });
    }
    
    res.status(400).json({ 
      error: 'Invalid Google token. Please try again.' 
    });
  }
});
// Get Current User
app.get('/api/auth/me', authenticateToken, (req, res) => {
  res.json(req.user);
});

// Logout
app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token').json({ message: 'Logged out.' });
});

// ==========================================
// 📝 POSTS ROUTES
// ==========================================

// Get All Posts
app.get('/api/posts', async (req, res) => {
  try {
    const [posts] = await pool.execute(`
      SELECT p.*, u.name, u.profile_image, 
        (SELECT COUNT(*) FROM comments WHERE post_id = p.id) as comment_count
      FROM posts p
      JOIN users u ON p.user_id = u.id
      ORDER BY p.created_at DESC
    `);
    res.json(posts);
  } catch (err) {
    console.error('Get posts error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// Create Post
app.post('/api/posts', authenticateToken, async (req, res) => {
  const { content } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: 'Post content required.' });
  
  try {
    const [result] = await pool.execute(
      'INSERT INTO posts (user_id, content, created_at, updated_at) VALUES (?, ?, NOW(), NOW())',
      [req.user.id, content]
    );
    res.status(201).json({ 
      id: result.insertId, 
      content, 
      user_id: req.user.id 
    });
  } catch (err) {
    console.error('Create post error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// Get Single Post
app.get('/api/posts/:id', async (req, res) => {
  try {
    const [posts] = await pool.execute(`
      SELECT p.*, u.name, u.profile_image
      FROM posts p
      JOIN users u ON p.user_id = u.id
      WHERE p.id = ?
    `, [req.params.id]);
    
    if (posts.length === 0) return res.status(404).json({ error: 'Post not found.' });
    res.json(posts[0]);
  } catch (err) {
    console.error('Get post error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// Update Post
app.put('/api/posts/:id', authenticateToken, async (req, res) => {
  const { content } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: 'Content required.' });
  
  try {
    const [post] = await pool.execute('SELECT user_id FROM posts WHERE id = ?', [req.params.id]);
    if (post.length === 0) return res.status(404).json({ error: 'Post not found.' });
    
    authorizeOwner(post[0].user_id)(req, res, async () => {
      await pool.execute(
        'UPDATE posts SET content = ?, updated_at = NOW() WHERE id = ?',
        [content, req.params.id]
      );
      res.json({ message: 'Post updated.' });
    });
  } catch (err) {
    console.error('Update post error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// Delete Post
app.delete('/api/posts/:id', authenticateToken, async (req, res) => {
  try {
    const [post] = await pool.execute('SELECT user_id FROM posts WHERE id = ?', [req.params.id]);
    if (post.length === 0) return res.status(404).json({ error: 'Post not found.' });
    
    authorizeOwner(post[0].user_id)(req, res, async () => {
      await pool.execute('DELETE FROM replies WHERE comment_id IN (SELECT id FROM comments WHERE post_id = ?)', [req.params.id]);
      await pool.execute('DELETE FROM comments WHERE post_id = ?', [req.params.id]);
      await pool.execute('DELETE FROM posts WHERE id = ?', [req.params.id]);
      res.json({ message: 'Post deleted.' });
    });
  } catch (err) {
    console.error('Delete post error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ==========================================
// 💬 COMMENTS ROUTES
// ==========================================

// Get Comments for a Post
app.get('/api/posts/:id/comments', async (req, res) => {
  try {
    const [comments] = await pool.execute(`
      SELECT c.*, u.name, u.profile_image
      FROM comments c
      JOIN users u ON c.user_id = u.id
      WHERE c.post_id = ?
      ORDER BY c.created_at ASC
    `, [req.params.id]);
    res.json(comments);
  } catch (err) {
    console.error('Get comments error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// Create Comment
app.post('/api/posts/:id/comments', authenticateToken, async (req, res) => {
  const { content } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: 'Comment content required.' });
  
  try {
    const [postExists] = await pool.execute('SELECT id FROM posts WHERE id = ?', [req.params.id]);
    if (postExists.length === 0) return res.status(404).json({ error: 'Post not found.' });
    
    const [result] = await pool.execute(
      'INSERT INTO comments (post_id, user_id, content, created_at, updated_at) VALUES (?, ?, ?, NOW(), NOW())',
      [req.params.id, req.user.id, content]
    );
    res.status(201).json({ id: result.insertId, content, user_id: req.user.id });
  } catch (err) {
    console.error('Create comment error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// Update Comment
app.put('/api/comments/:id', authenticateToken, async (req, res) => {
  const { content } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: 'Content required.' });
  
  try {
    const [comment] = await pool.execute('SELECT user_id FROM comments WHERE id = ?', [req.params.id]);
    if (comment.length === 0) return res.status(404).json({ error: 'Comment not found.' });
    
    authorizeOwner(comment[0].user_id)(req, res, async () => {
      await pool.execute(
        'UPDATE comments SET content = ?, updated_at = NOW() WHERE id = ?',
        [content, req.params.id]
      );
      res.json({ message: 'Comment updated.' });
    });
  } catch (err) {
    console.error('Update comment error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// Delete Comment
app.delete('/api/comments/:id', authenticateToken, async (req, res) => {
  try {
    const [comment] = await pool.execute('SELECT user_id FROM comments WHERE id = ?', [req.params.id]);
    if (comment.length === 0) return res.status(404).json({ error: 'Comment not found.' });
    
    authorizeOwner(comment[0].user_id)(req, res, async () => {
      await pool.execute('DELETE FROM replies WHERE comment_id = ?', [req.params.id]);
      await pool.execute('DELETE FROM comments WHERE id = ?', [req.params.id]);
      res.json({ message: 'Comment deleted.' });
    });
  } catch (err) {
    console.error('Delete comment error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ==========================================
// ↩️ REPLIES ROUTES
// ==========================================

// Get Replies for a Comment
app.get('/api/comments/:id/replies', async (req, res) => {
  try {
    const [replies] = await pool.execute(`
      SELECT r.*, u.name, u.profile_image
      FROM replies r
      JOIN users u ON r.user_id = u.id
      WHERE r.comment_id = ?
      ORDER BY r.created_at ASC
    `, [req.params.id]);
    res.json(replies);
  } catch (err) {
    console.error('Get replies error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// Create Reply
app.post('/api/comments/:id/replies', authenticateToken, async (req, res) => {
  const { content } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: 'Reply content required.' });
  
  try {
    const [commentExists] = await pool.execute('SELECT id FROM comments WHERE id = ?', [req.params.id]);
    if (commentExists.length === 0) return res.status(404).json({ error: 'Comment not found.' });
    
    const [result] = await pool.execute(
      'INSERT INTO replies (comment_id, user_id, content, created_at, updated_at) VALUES (?, ?, ?, NOW(), NOW())',
      [req.params.id, req.user.id, content]
    );
    res.status(201).json({ id: result.insertId, content, user_id: req.user.id });
  } catch (err) {
    console.error('Create reply error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// Delete Reply
app.delete('/api/replies/:id', authenticateToken, async (req, res) => {
  try {
    const [reply] = await pool.execute('SELECT user_id FROM replies WHERE id = ?', [req.params.id]);
    if (reply.length === 0) return res.status(404).json({ error: 'Reply not found.' });
    
    authorizeOwner(reply[0].user_id)(req, res, async () => {
      await pool.execute('DELETE FROM replies WHERE id = ?', [req.params.id]);
      res.json({ message: 'Reply deleted.' });
    });
  } catch (err) {
    console.error('Delete reply error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ==========================================
// 👤 USERS ROUTES
// ==========================================

// Get User by ID
app.get('/api/users/:id', async (req, res) => {
  try {
    const [users] = await pool.execute(
      'SELECT id, name, email, profile_image, created_at FROM users WHERE id = ?',
      [req.params.id]
    );
    if (users.length === 0) return res.status(404).json({ error: 'User not found.' });
    res.json(users[0]);
  } catch (err) {
    console.error('Get user error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// Get User's Posts
app.get('/api/users/:id/posts', async (req, res) => {
  try {
    const [posts] = await pool.execute(`
      SELECT p.*, u.name, u.profile_image,
        (SELECT COUNT(*) FROM comments WHERE post_id = p.id) as comment_count
      FROM posts p
      JOIN users u ON p.user_id = u.id
      WHERE p.user_id = ?
      ORDER BY p.created_at DESC
    `, [req.params.id]);
    res.json(posts);
  } catch (err) {
    console.error('Get user posts error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// Get User's Comments
app.get('/api/users/:id/comments', async (req, res) => {
  try {
    const [comments] = await pool.execute(`
      SELECT 
        c.id, c.content, c.created_at, c.post_id,
        p.content as post_content,
        p.user_id as post_author_id,
        author.name as post_author_name
      FROM comments c
      JOIN posts p ON c.post_id = p.id
      JOIN users author ON p.user_id = author.id
      WHERE c.user_id = ?
      ORDER BY c.created_at DESC
    `, [req.params.id]);

    const [replies] = await pool.execute(`
      SELECT 
        r.id, r.content, r.created_at, r.comment_id,
        c.post_id,
        c.content as comment_content,
        p.content as post_content,
        p.user_id as post_author_id,
        author.name as post_author_name
      FROM replies r
      JOIN comments c ON r.comment_id = c.id
      JOIN posts p ON c.post_id = p.id
      JOIN users author ON p.user_id = author.id
      WHERE r.user_id = ?
      ORDER BY r.created_at DESC
    `, [req.params.id]);

    res.json({ comments, replies });
  } catch (err) {
    console.error('Get user comments error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ==========================================
// 🔔 NOTIFICATIONS ROUTE
// ==========================================

app.get('/api/notifications', authenticateToken, async (req, res) => {
  try {
    const [comments] = await pool.execute(`
      SELECT c.id, c.content, c.created_at, 
        u.name as commenter_name, u.profile_image as commenter_image, 
        p.id as post_id
      FROM comments c
      JOIN posts p ON c.post_id = p.id
      JOIN users u ON c.user_id = u.id
      WHERE p.user_id = ? AND c.user_id != ?
      ORDER BY c.created_at DESC
      LIMIT 20
    `, [req.user.id, req.user.id]);

    const [replies] = await pool.execute(`
      SELECT r.id, r.content, r.created_at, 
        u.name as replier_name, u.profile_image as replier_image, 
        p.id as post_id
      FROM replies r
      JOIN comments c ON r.comment_id = c.id
      JOIN posts p ON c.post_id = p.id
      JOIN users u ON r.user_id = u.id
      WHERE c.user_id = ? AND r.user_id != ?
      ORDER BY r.created_at DESC
      LIMIT 20
    `, [req.user.id, req.user.id]);

    const formattedComments = comments.map(c => ({
      id: `c_${c.id}`,
      type: 'comment',
      user: c.commenter_name,
      profile_image: c.commenter_image,
      content: `commented: "${c.content.substring(0, 40)}${c.content.length > 40 ? '...' : ''}"`,
      post_id: c.post_id,
      created_at: c.created_at
    }));

    const formattedReplies = replies.map(r => ({
      id: `r_${r.id}`,
      type: 'reply',
      user: r.replier_name,
      profile_image: r.replier_image,
      content: `replied: "${r.content.substring(0, 40)}${r.content.length > 40 ? '...' : ''}"`,
      post_id: r.post_id,
      created_at: r.created_at
    }));

    const allNotifications = [...formattedComments, ...formattedReplies]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 20);

    res.json(allNotifications);
  } catch (err) {
    console.error('Notification error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ==========================================
// 🏠 HOME ROUTE (Test)
// ==========================================

app.get('/', (req, res) => {
  res.send('MindShare Backend Running');
});

// ==========================================
// 🚀 START SERVER
// ==========================================

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 MindShare Backend running on port ${PORT}`);
  console.log(`📍 API available at: http://localhost:${PORT}`);
});