const jwt = require('jsonwebtoken');
const Parent = require('../models/Parent');
const Specialist = require('../models/Specialist');
const Admin = require('../models/Admin');

exports.protect = async (req, res, next) => {
  try {
    let token;

    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Not authorized to access this route'
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Determine which collection to query based on role in token
    let user;

    if (decoded.role === 'parent') {
      user = await Parent.findById(decoded.id);
    } else if (decoded.role === 'specialist') {
      user = await Specialist.findById(decoded.id);
    } else if (['admin', 'superadmin'].includes(decoded.role)) {
      user = await Admin.findById(decoded.id);
    } else {
      // Fallback for legacy tokens or unknown roles: try finding in all (expensive but safe)
      user = await Parent.findById(decoded.id) ||
        await Specialist.findById(decoded.id) ||
        await Admin.findById(decoded.id);
    }

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User not found or token invalid'
      });
    }

    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: 'Not authorized to access this route'
    });
  }
};

exports.authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `User role '${req.user.role}' is not authorized to access this route`
      });
    }
    next();
  };
};

exports.requireEmailVerification = (req, res, next) => {
  if (!req.user.emailVerified) {
    return res.status(403).json({
      success: false,
      message: 'Email verification required to access this resource'
    });
  }
  next();
};
