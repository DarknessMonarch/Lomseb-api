const jwt = require('jsonwebtoken');
const User = require('../models/users');

exports.protect = async (req, res, next) => {
  try {
    
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        status: 'error',
        message: 'No token provided. Please log in'
      });
    }

    const token = authHeader.split(' ')[1];

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        return res.status(401).json({
          status: 'error',
          message: 'Token expired. Please log in again'
        });
      }
      return res.status(401).json({
        status: 'error',
        message: 'Invalid token. Please log in again'
      });
    }

    const user = await User.findById(decoded.id);
    if (!user) {
      return res.status(401).json({
        status: 'error',
        message: 'User no longer exists'
      });
    }

    if (!user.emailVerified) {
      return res.status(401).json({
        status: 'error',
        message: 'Please verify your email to access this resource'
      });
    }

    req.user = {
      id: user._id,
      email: user.email,
      username: user.username,
      isAdmin: user.isAdmin,
      isAuthorized: user.isAuthorized,
      emailVerified: user.emailVerified
    };
    
    next();
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: 'Authentication failed'
    });
  }
};

exports.authenticateAdmin = async (req, res, next) => {
  try {
    
    if (!req.user || !req.user.id) {
      return res.status(403).json({
        status: 'error',
        message: 'Access denied. User not authenticated.'
      });
    }
    
    if (!req.user.isAdmin) {
      return res.status(403).json({
        status: 'error',
        message: 'Access denied. Admin privileges required'
      });
    }
    
    next();
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: 'Admin authentication failed'
    });
  }
};

exports.authenticateAuthorizedAdmin = async (req, res, next) => {
  try {
    
    if (!req.user || !req.user.id) {
      return res.status(403).json({
        status: 'error',
        message: 'Access denied. User not authenticated.'
      });
    }
    
    if (!req.user.isAdmin || !req.user.isAuthorized) {
      return res.status(403).json({
        status: 'error',
        message: 'Access denied. Authorized admin privileges required'
      });
    }
    
    next();
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: 'Authorized admin authentication failed'
    });
  }
};

module.exports = exports;