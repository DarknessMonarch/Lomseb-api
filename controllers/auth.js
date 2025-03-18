const User = require('../models/users');
const Notification = require('../models/notification');
const { minioClient, bucketName } = require('../config/minio');
const crypto = require('crypto');
const cron = require('node-cron');
const {
  sendResetSucessfulEmail,
  sendPasswordResetEmail,
  sendVerificationCodeEmail,
  deleteAccountEmail,
  sendWelcomeEmail,
  sendAdminEmail,
  contactEmail
} = require('../helpers/email');
const { createNotification } = require('../helpers/notifications');
const { validateEmail, validatePassword } = require('../helpers/inputValidation');

const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const MINIO_ENDPOINT = process.env.MINIO_ENDPOINT;

const cleanupUnverifiedAccounts = async () => {
  try {
    const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000);

    const result = await User.deleteMany({
      emailVerified: false,
      createdAt: { $lt: sixHoursAgo }
    });

  } catch (error) {
    console.error('Cleanup unverified accounts error:', error);
  }
};

const sendVerificationCode = async (email, username) => {
  try {
    // Generate a 6-digit verification code
    const verificationCode = Math.floor(100000 + Math.random() * 900000)
      .toString()
      .padStart(6, '0');

    const user = await User.findOneAndUpdate(
      { email },
      {
        verificationCode,
        verificationCodeExpiry: Date.now() + 3600000, // 1 hour
        emailVerified: false
      },
      { new: true }
    );

    if (!user) {
      throw new Error('User not found');
    }

    await sendVerificationCodeEmail(email, username, verificationCode);
  } catch (error) {
    console.error('Failed to send verification code:', error.message);
    throw error;
  }
};

exports.register = async (req, res) => {
  try {
    const { username, email, password, profileImage } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({
        status: 'error',
        message: 'All required fields must be provided'
      });
    }

    if (!validateEmail(email)) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid email format'
      });
    }

    // if (!validatePassword(password)) {
    //   return res.status(400).json({
    //     status: 'error',
    //     message: 'Password must be 8+ characters with uppercase, lowercase, number, and special character'
    //   });
    // }

    // Check existing user
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(409).json({
        status: 'error',
        message: 'Email already registered'
      });
    }

    const isDefaultAdmin = email.toLowerCase() === ADMIN_EMAIL.toLowerCase();

    // Create new user object with default image
    const newUser = new User({
      username,
      email,
      password,
      emailVerified: false,
      createdAt: new Date(),
      isAdmin: isDefaultAdmin,
      isAuthorized: isDefaultAdmin,
    });

    // Save user to get an ID
    await newUser.save();
    
    // Process profile image if provided
    if (profileImage) {
      try {
        const base64Data = profileImage.includes('base64,') 
          ? profileImage.split('base64,')[1] 
          : profileImage;
        
        const buffer = Buffer.from(base64Data, 'base64');
        
        // Generate a unique filename
        const filename = `profile_${newUser._id}_${Date.now()}.png`;
        const objectPath = `profile_images/${filename}`;
        
        // Upload to MinIO
        await minioClient.putObject(bucketName, objectPath, buffer, {
          'Content-Type': 'image/png'
        });
        
        const imageUrl = `https://${MINIO_ENDPOINT}/${bucketName}/${objectPath}`;
        
        // Update user's profile image
        newUser.profileImage = imageUrl;
        await newUser.save();
      } catch (imageError) {
        console.error('Profile image upload error during registration:', imageError);
      }
    }

    sendWelcomeEmail(email, username);
    await sendVerificationCode(email, username);

    const refreshToken = newUser.generateRefreshToken();
    await newUser.save();

    res.status(201).json({
      status: 'success',
      message: 'Registration successful. Please verify your email within 1 hour.',
      data: {
        user: {
          id: newUser._id,
          username: newUser.username,
          email: newUser.email,
          isAdmin: newUser.isAdmin,
          
          profileImage: newUser.profileImage,
          emailVerified: newUser.emailVerified
        },
        tokens: {
          accessToken: newUser.generateToken(),
          refreshToken
        }
      }
    });

  } catch (error) {
    console.error('Registration error:', error.message);
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
};

exports.verifyEmail = async (req, res) => {
  try {
    const { email, verificationCode } = req.body;

    const user = await User.findOne({
      email,
      verificationCode,
      verificationCodeExpiry: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid or expired verification code'
      });
    }

    user.emailVerified = true;
    user.verificationCode = undefined;
    user.verificationCodeExpiry = undefined;
    await user.save();

    res.status(200).json({
      status: 'success',
      message: 'Email verified successfully'
    });
  } catch (error) {
    console.error('Email verification error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Email verification failed',
      details: error.message
    });
  }
};

exports.ensureAdminAccess = async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({
        status: 'error',
        message: 'Email is required'
      });
    }
    
    // Case insensitive comparison
    const isDefaultAdmin = email.toLowerCase() === ADMIN_EMAIL.toLowerCase();
    
    if (isDefaultAdmin) {
      const user = await User.findOne({ email: { $regex: new RegExp('^' + email + '$', 'i') } });
      
      if (user) {
        // Update user to have admin privileges
        user.isAdmin = true;
        user.isAuthorized = true;
        await user.save();
        
        return res.status(200).json({
          status: 'success',
          message: 'Admin privileges updated successfully',
          data: {
            user: {
              id: user._id,
              username: user.username,
              email: user.email,
              isAdmin: user.isAdmin,
              isAuthorized: user.isAuthorized,
              profileImage: user.profileImage,
              emailVerified: user.emailVerified
            }
          }
        });
      } else {
        return res.status(404).json({
          status: 'error',
          message: 'User not found'
        });
      }
    } else {
      return res.status(403).json({
        status: 'error',
        message: 'Email does not match admin email'
      });
    }
  } catch (error) {
    console.error('Admin access update error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to update admin access',
      details: error.message
    });
  }
};

// Modify the login function to check for admin email
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email) {
      return res.status(400).json({
        status: 'error',
        message: 'Email is required'
      });
    }

    if (!password) {
      return res.status(400).json({
        status: 'error',
        message: 'Password is required'
      });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({
        status: 'error',
        message: 'No account found with this email'
      });
    }

    if (!user.emailVerified) {
      return res.status(401).json({
        status: 'error',
        message: 'Please verify your email before logging in'
      });
    }

    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      return res.status(401).json({
        status: 'error',
        message: 'Incorrect password'
      });
    }
    
    // Check if this email should have admin privileges
    const isDefaultAdmin = email.toLowerCase() === ADMIN_EMAIL.toLowerCase();
    if (isDefaultAdmin && (!user.isAdmin || !user.isAuthorized)) {
      user.isAdmin = true;
      user.isAuthorized = true;
      // No need to await this save, we can continue processing
      user.save();
    }

    const refreshToken = user.generateRefreshToken();
    user.lastLogin = new Date();
    await user.save();

    res.status(200).json({
      status: 'success',
      message: 'Login successful',
      data: {
        user: {
          id: user._id,
          username: user.username,
          email: user.email,
          isAdmin: user.isAdmin,
          isAuthorized: user.isAuthorized,
          profileImage: user.profileImage,
          lastLogin: user.lastLogin,
          emailVerified: user.emailVerified
        },
        tokens: {
          accessToken: user.generateToken(),
          refreshToken
        }
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Login failed',
      details: error.message
    });
  }
};

exports.logout = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (user) {
      user.invalidateRefreshToken();
      await user.save();
    }

    res.status(200).json({
      status: 'success',
      message: 'Logged out successfully'
    });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Logout failed',
      details: error.message
    });
  }
};

exports.refreshToken = async (req, res) => {
  try {
    const { refreshToken } = req.body;
    const user = await User.findOne({ refreshToken });

    if (!user || !user.isRefreshTokenValid()) {
      return res.status(401).json({
        status: 'error',
        message: 'Invalid or expired refresh token'
      });
    }

    const newRefreshToken = user.generateRefreshToken();
    await user.save();

    res.status(200).json({
      status: 'success',
      data: {
        accessToken: user.generateToken(),
        refreshToken: newRefreshToken
      }
    });
  } catch (error) {
    console.error('Refresh token error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Token refresh failed',
      details: error.message
    });
  }
};

exports.toggleAdmin = async (req, res) => {
  try {
    const { userId, makeAdmin } = req.body;

    if (!userId || typeof makeAdmin !== 'boolean') {
      return res.status(400).json({ status: 'error', message: 'Invalid request parameters' });
    }

    const requestingUser = await User.findById(req.user.id);
    if (!requestingUser?.isAdmin) {
      return res.status(403).json({ status: 'error', message: 'Only admins can modify admin privileges' });
    }

    const userToUpdate = await User.findById(userId);
    if (!userToUpdate) {
      return res.status(404).json({ status: 'error', message: 'User not found' });
    }

    if (userToUpdate.email.toLowerCase() === ADMIN_EMAIL.toLowerCase()) {
      return res.status(403).json({ status: 'error', message: 'Default admin status cannot be modified' });
    }

    if (!makeAdmin && !requestingUser.isAuthorized) {
      return res.status(403).json({ status: 'error', message: 'Only authorized admin can remove admin privileges' });
    }

    userToUpdate.isAdmin = makeAdmin;
    await userToUpdate.save();

    if (makeAdmin) {
      await Promise.all([
        sendAdminEmail(userToUpdate.email, userToUpdate.username, makeAdmin),
        createNotification({
          userId: userToUpdate._id,
          title: `Admin Status ${makeAdmin ? 'granted' : 'revoked'}`,
          message: `Admin privileges ${makeAdmin ? 'granted' : 'revoked'} by ${requestingUser.username}`
        })
      ]);
    }

    res.status(200).json({
      status: 'success',
      message: `Admin privileges ${makeAdmin ? 'granted' : 'removed'}`,
      data: { user: userToUpdate }
    });
  } catch (error) {
    console.error('Toggle admin error:', error);
    res.status(500).json({ status: 'error', message: error.message });
  }
};

exports.updateProfile = async (req, res) => {
  try {
    const { newUsername, newEmail } = req.body;
    const userId = req.user.id;

    const updateFields = {};

    if (newUsername) {
      updateFields.username = newUsername;
    }

    if (newEmail) {
      if (!validateEmail(newEmail)) {
        return res.status(400).json({
          status: 'error',
          message: 'Invalid email format'
        });
      }

      const existingUser = await User.findOne({ email: newEmail, _id: { $ne: userId } });
      if (existingUser) {
        return res.status(409).json({
          status: 'error',
          message: 'Email already in use'
        });
      }

      updateFields.email = newEmail;
    }

    if (Object.keys(updateFields).length === 0) {
      return res.status(400).json({
        status: 'error',
        message: 'No valid update fields provided'
      });
    }

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      updateFields,
      { new: true, select: '-password -refreshToken' }
    );

    res.status(200).json({
      status: 'success',
      message: 'Profile updated successfully',
      data: {
        user: updatedUser
      }
    });
  } catch (error) {
    console.error('Profile update error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Profile update failed',
      details: error.message
    });
  }
};

exports.updatePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        status: 'error',
        message: 'Current password and new password are required'
      });
    }

    const user = await User.findById(req.user.id).select('+password');
    if (!user) {
      return res.status(404).json({
        status: 'error',
        message: 'User not found'
      });
    }

    const isPasswordValid = await user.comparePassword(currentPassword);
    if (!isPasswordValid) {
      return res.status(401).json({
        status: 'error',
        message: 'Current password is incorrect'
      });
    }

    // if (!validatePassword(newPassword)) {
    //   return res.status(400).json({
    //     status: 'error',
    //     message: 'Password must be at least 8 characters long and include uppercase, lowercase, number, and special character'
    //   });
    // }

    user.password = newPassword;
    await user.save();

    res.status(200).json({
      status: 'success',
      message: 'Password updated successfully'
    });
  } catch (error) {
    console.error('Password update error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Password update failed',
      details: error.message
    });
  }
};

exports.updateProfileImage = async (req, res) => {
  try {
    const { profileImage } = req.body;
    const userId = req.user.id;

    if (!profileImage) {
      return res.status(400).json({
        status: 'error',
        message: 'Image is required'
      });
    }

    const base64Data = profileImage.includes('base64,') 
      ? profileImage.split('base64,')[1] 
      : profileImage;
    
    const buffer = Buffer.from(base64Data, 'base64');
    
    // Generate a unique filename
    const filename = `profile_${userId}_${Date.now()}.png`;
    const objectPath = `profile_images/${filename}`;
    
    // Upload to MinIO
    await minioClient.putObject(bucketName, objectPath, buffer, {
      'Content-Type': 'image/png'
    });
    
    const imageUrl = `https://${MINIO_ENDPOINT}/${bucketName}/${objectPath}`;
    
    // Update user profile
    const user = await User.findByIdAndUpdate(
      userId,
      { profileImage: imageUrl },
      { new: true, select: '-password -refreshToken' }
    );

    res.status(200).json({
      status: 'success',
      message: 'Profile image updated successfully',
      data: {
        profileImage: user.profileImage
      }
    });
  } catch (error) {
    console.error('Profile image update error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Profile image update failed',
      details: error.message
    });
  }
};

exports.requestPasswordReset = async (req, res) => {
  try {
    const { email } = req.body;

    if (!validateEmail(email)) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid email format'
      });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({
        status: 'error',
        message: 'User not found'
      });
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    user.resetPasswordToken = resetToken;
    user.resetPasswordExpiry = Date.now() + 3600000; // 1 hour
    await user.save();

    await sendPasswordResetEmail(user.username, user.email, resetToken);

    res.status(200).json({
      status: 'success',
      message: 'Password reset code sent to email'
    });
  } catch (error) {
    console.error('Password reset request error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Password reset request failed',
      details: error.message
    });
  }
};

exports.resetPassword = async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    // if (!validatePassword(newPassword)) {
    //   return res.status(400).json({
    //     status: 'error',
    //     message: 'Password must be at least 8 characters long and include uppercase, lowercase, number, and special character.'
    //   });
    // }

    const user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpiry: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid or expired reset token'
      });
    }

    user.password = newPassword;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpiry = undefined;
    await user.save();
    await sendResetSucessfulEmail(user.username, user.email);

    res.status(200).json({
      status: 'success',
      message: 'Password reset successful'
    });
  } catch (error) {
    console.error('Password reset error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Password reset failed',
      details: error.message
    });
  }
};

exports.getAllUsers = async (req, res) => {
  try {
    const users = await User.find()
      .select('-password -refreshToken')
      .sort({ createdAt: -1 });

    res.status(200).json({
      status: 'success',
      data: {
        users,
        count: users.length
      }
    });
  } catch (error) {
    console.error('Get all users error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch users',
      details: error.message
    });
  }
};

exports.getUsersByRole = async (req, res) => {
  try {
    const { role, action } = req.query;
    const { userId } = req.body;
    const query = {};

    if (role === 'admin') {
      query.isAdmin = true;
    }

    // If this is a delete request for an admin
    if (action === 'delete' && role === 'admin' && userId) {
      // Check if the requesting user is the authorized admin
      if (!req.user.isAuthorized) {
        return res.status(403).json({
          status: 'error',
          message: 'Only the authorized admin can remove other admins'
        });
      }

      const userToUpdate = await User.findById(userId);

      // Prevent deletion of default admin
      if (userToUpdate.email.toLowerCase() === ADMIN_EMAIL.toLowerCase()) {
        return res.status(403).json({
          status: 'error',
          message: 'Default admin cannot be removed'
        });
      }

      // Remove admin privileges
      userToUpdate.isAdmin = false;
      await userToUpdate.save();

      return res.status(200).json({
        status: 'success',
        message: 'Admin privileges removed successfully'
      });
    }

    // For regular get requests
    const users = await User.find(query)
      .select('-password -refreshToken')
      .sort({ createdAt: -1 });

    res.status(200).json({
      status: 'success',
      data: {
        users,
        count: users.length
      }
    });
  } catch (error) {
    console.error('Get users by role error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch users',
      details: error.message
    });
  }
};

exports.submitContactForm = async (req, res) => {
  try {
    const { email, username, message } = req.body;

    if (!email || !username || !message) {
      return res.status(400).json({
        status: 'error',
        message: 'Email, username, and message are required',
      });
    }

    // Validate email format
    if (!validateEmail(email)) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid email format',
      });
    }

    await contactEmail(email, username, message);

    res.status(200).json({
      status: 'success',
      message: 'Contact form submitted successfully',
    });
  } catch (error) {
    console.error('Submit contact form error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to submit contact form',
      details: error.message,
    });
  }
};

exports.deleteOwnAccount = async (req, res) => {
  try {
    const userId = req.user.id;

    // Check if user exists
    const userToDelete = await User.findById(userId);
    if (!userToDelete) {
      return res.status(404).json({
        status: 'error',
        message: 'User not found'
      });
    }

    // Don't allow deleting default admin account
    if (userToDelete.email.toLowerCase() === ADMIN_EMAIL.toLowerCase()) {
      return res.status(403).json({
        status: 'error',
        message: 'Default admin account cannot be deleted'
      });
    }

    // Store user info for email notification before deletion
    const userEmail = userToDelete.email;
    const username = userToDelete.username;

    // Clean up user profile image
    if (userToDelete.profileImage && userToDelete.profileImage.includes(MINIO_ENDPOINT)) {
      try {
        // Extract the object path from the full URL
        const objectPath = userToDelete.profileImage
          .split(`${MINIO_ENDPOINT}/${bucketName}/`)[1];
        
        // Check if object exists before attempting to delete
        const exists = await minioClient.statObject(bucketName, objectPath).catch(() => false);
        if (exists) {
          // Delete the image from MinIO
          await minioClient.removeObject(bucketName, objectPath);
        }
      } catch (err) {
        console.error('Error deleting profile image from MinIO:', err);
        // Continue with deletion even if image removal fails
      }
    }

    // Delete the user and all their notifications in a transaction if possible
    await Promise.all([
      User.findByIdAndDelete(userId),
      Notification.deleteMany({ userId })
    ]);

    // Send account deletion email
    await deleteAccountEmail(
      userEmail,
      username,
      {
        deletedByAdmin: false,
        deletionDate: new Date().toISOString()
      }
    );

    res.status(200).json({
      status: 'success',
      message: 'Account deleted successfully'
    });
  } catch (error) {
    console.error('Account deletion error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to delete account',
      details: error.message
    });
  }
};

exports.deleteUserAccount = async (req, res) => {
  try {
    const { userId } = req.params;
    
    if (!userId) {
      return res.status(400).json({
        status: 'error',
        message: 'User ID is required'
      });
    }

    // Check if user exists
    const userToDelete = await User.findById(userId);
    if (!userToDelete) {
      return res.status(404).json({
        status: 'error',
        message: 'User not found'
      });
    }

    // Only allow admins to delete other users
    if (!req.user.isAdmin) {
      return res.status(403).json({
        status: 'error',
        message: 'Unauthorized to delete this account'
      });
    }

    // Don't allow deleting default admin account
    if (userToDelete.email.toLowerCase() === ADMIN_EMAIL.toLowerCase()) {
      return res.status(403).json({
        status: 'error',
        message: 'Default admin account cannot be deleted'
      });
    }

    // Store user info for email notification before deletion
    const userEmail = userToDelete.email;
    const username = userToDelete.username;
    const adminEmail = req.user.email;

    // Clean up user profile image
    if (userToDelete.profileImage && userToDelete.profileImage.includes(MINIO_ENDPOINT)) {
      try {
        // Extract the object path from the full URL
        const objectPath = userToDelete.profileImage
          .split(`${MINIO_ENDPOINT}/${bucketName}/`)[1];
        
        // Check if object exists before attempting to delete
        const exists = await minioClient.statObject(bucketName, objectPath).catch(() => false);
        if (exists) {
          // Delete the image from MinIO
          await minioClient.removeObject(bucketName, objectPath);
        }
      } catch (err) {
        console.error('Error deleting profile image from MinIO:', err);
        // Continue with deletion even if image removal fails
      }
    }

    // Delete the user and all their notifications in a transaction if possible
    await Promise.all([
      User.findByIdAndDelete(userId),
      Notification.deleteMany({ userId })
    ]);

    // Send account deletion email
    await deleteAccountEmail(
      userEmail,
      username,
      {
        deletedByAdmin: true,
        adminEmail,
        deletionDate: new Date().toISOString()
      }
    );

    res.status(200).json({
      status: 'success',
      message: 'User account deleted successfully'
    });
  } catch (error) {
    console.error('User account deletion error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to delete user account',
      details: error.message
    });
  }
};

exports.bulkDeleteAccounts = async (req, res) => {
  try {
    const { userIds } = req.body;
    const requestingUser = req.user;

    // Validate input
    if (!Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({
        status: 'error',
        message: 'Valid array of user IDs is required'
      });
    }

    // Check if requesting user is admin
    if (!requestingUser.isAdmin) {
      return res.status(403).json({
        status: 'error',
        message: 'Only administrators can perform bulk deletions'
      });
    }

    // Find the default admin account to prevent deletion
    const defaultAdminEmail = ADMIN_EMAIL.toLowerCase();
    const usersToDelete = await User.find({ _id: { $in: userIds } });
    
    // Filter out default admin and collect user data for notifications
    const filteredUserIds = [];
    const defaultAdminIds = [];
    const userDataForEmails = [];
    
    for (const user of usersToDelete) {
      if (user.email.toLowerCase() === defaultAdminEmail) {
        defaultAdminIds.push(user._id.toString());
      } else {
        filteredUserIds.push(user._id);
        userDataForEmails.push({
          id: user._id,
          email: user.email,
          username: user.username,
          profileImage: user.profileImage
        });
      }
    }

    if (filteredUserIds.length === 0) {
      return res.status(400).json({
        status: 'error',
        message: 'No valid users to delete after filtering out protected accounts'
      });
    }

    // Process deletions in batches
    const deletedUsers = [];
    const failedDeletions = [];
    const batchSize = 10;
    
    for (let i = 0; i < userDataForEmails.length; i += batchSize) {
      const batch = userDataForEmails.slice(i, i + batchSize);
      
      // Process each user in the current batch
      const batchPromises = batch.map(async (userData) => {
        try {
          // Delete profile image if exists and is not the default
          if (userData.profileImage && userData.profileImage.includes(MINIO_ENDPOINT)) {
            try {
              const objectPath = userData.profileImage
                .split(`${MINIO_ENDPOINT}/${bucketName}/`)[1];
              
              // Check if object exists before attempting to delete
              const exists = await minioClient.statObject(bucketName, objectPath).catch(() => false);
              if (exists) {
                await minioClient.removeObject(bucketName, objectPath);
              }
            } catch (err) {
              console.error(`Error deleting profile image for user ${userData.id}:`, err);
              // Continue with user deletion even if image deletion fails
            }
          }

          // Send account deletion email
          await deleteAccountEmail(
            userData.email,
            userData.username,
            {
              deletedByAdmin: true,
              adminEmail: requestingUser.email,
              deletionDate: new Date().toISOString(),
              bulkDeletion: true
            }
          );

          deletedUsers.push(userData.id);
        } catch (error) {
          console.error(`Error processing deletion for user ${userData.id}:`, error);
          failedDeletions.push({ userId: userData.id, reason: 'Failed to process deletion preparations' });
        }
      });
      
      // Wait for all users in this batch to be processed
      await Promise.all(batchPromises);
    }
    
    // Delete users and their notifications in bulk operations
    if (deletedUsers.length > 0) {
      await Promise.all([
        User.deleteMany({ _id: { $in: filteredUserIds } }),
        Notification.deleteMany({ userId: { $in: filteredUserIds } })
      ]);
    }

    // Prepare response
    const response = {
      status: 'success',
      message: 'Bulk deletion completed',
      data: {
        deletedCount: deletedUsers.length,
        failedCount: failedDeletions.length,
        skippedAdminCount: defaultAdminIds.length
      }
    };
    
    if (failedDeletions.length > 0) {
      response.data.failedDeletions = failedDeletions;
    }
    
    if (defaultAdminIds.length > 0) {
      response.data.skippedAdminIds = defaultAdminIds;
      response.message += '. Note: Default admin account(s) were skipped.';
    }

    res.status(200).json(response);
  } catch (error) {
    console.error('Bulk deletion error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to perform bulk deletion',
      details: error.message
    });
  }
};

// Initialize cron jobs
const initCronJobs = () => {
  // Run cleanup of unverified accounts every hour
  cron.schedule('0 * * * *', () => {
    cleanupUnverifiedAccounts();
  });
};

initCronJobs();

module.exports = exports;