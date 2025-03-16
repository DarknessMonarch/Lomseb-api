const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notification');
const { protect } = require('../middleware/auth');

router.use(protect);  

router.get('/', notificationController.getNotifications);
router.patch('/:notificationId/read', notificationController.markAsRead);
router.patch('/mark-all-read', notificationController.markAllAsRead);
router.delete('/:notificationId', notificationController.deleteNotification);
router.delete('/', notificationController.deleteAllNotifications);

module.exports = router;