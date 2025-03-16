const express = require('express');
const router = express.Router();
const multer = require('multer');
const productController = require('../controllers/product');
const auth = require('../middleware/auth');

const storage = multer.memoryStorage();
const upload = multer({ 
  storage,
  limits: {
    fileSize:  1024 * 1024 * 100 // 100MB max file size
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'), false);
    }
  }
});

router.post(
  '/', 
  auth.protect, 
  upload.single('image'), 
  productController.createProduct
);

// Get all products (public route, no auth required)
router.get('/', productController.getProducts);

// Get inventory statistics (only authenticated users can access)
router.get('/stats', auth.protect, productController.getInventoryStats);

// Get a single product (public)
router.get('/:id', productController.getProductById);

// Get product from QR code (public)
router.get('/qr/:productId', productController.getProductByQrCode);

// Add product to cart from QR code (only authenticated users)
router.post('/qr/:productId/add-to-cart', auth.protect, productController.addToCartFromQrCode);

// Update a product (only authenticated users)
router.put(
  '/:id', 
  auth.protect, 
  upload.single('image'), 
  productController.updateProduct
);

// Delete a product (only authenticated users)
router.delete('/:id', auth.protect, productController.deleteProduct);

module.exports = router;
