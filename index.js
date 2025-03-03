const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const session = require('express-session');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:5173',
  credentials: true
}));
app.use(express.json());

// Session middleware
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('Connected to MongoDB successfully.'))
  .catch(err => console.error('MongoDB connection error:', err));

// Make db connection available to routes
app.locals.db = mongoose.connection;

// Import routes
const communityRoutes = require('./routes/communityRoutes');
const authRoutes = require('./routes/authRoutes');
const discourseRoutes = require('./routes/discourseRoutes');
const postRoutes = require('./routes/postRoutes');
// Use routes
app.use('/', communityRoutes);
app.use('/', authRoutes);
app.use('/discourse', discourseRoutes); // All discourse routes will be prefixed with /discourse
app.use('/', postRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
