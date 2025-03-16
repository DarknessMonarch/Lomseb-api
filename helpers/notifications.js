const Notification = require('../models/notification');

const createNotification = async ({ userId, title, message, data = {} }) => {
  try {
    const notification = await Notification.create({
      userId,
      title,
      message,
      data
    });

    return notification;
  } catch (error) {
    console.error('Create notification error:', error);
    throw error;
  }
};

module.exports = { createNotification };
