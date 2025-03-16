const express = require('express');
const router = express.Router();
const cartController = require('../controllers/cart');
const { protect } = require('../middleware/auth');

// User cart routes
router.get('/', protect, cartController.getCart);
router.post('/add', protect, cartController.addToCart);
router.post('/checkout', protect, cartController.checkout);
router.put('/item/:itemId', protect, cartController.updateCartItem);
router.delete('/item/:itemId', protect, cartController.removeCartItem);
router.delete('/clear', protect, cartController.clearCart);

// Admin cart routes
router.get('/all', protect, cartController.getAllCarts);

module.exports = router;