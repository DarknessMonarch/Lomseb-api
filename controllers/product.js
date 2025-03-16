const { uploadFile, deleteFile } = require('../helpers/fileStorage');
const Product = require('../models/product');
const Cart = require('../models/cart');
const sharp = require('sharp');
const mongoose = require('mongoose');

// Utility function to process image
const processImage = async (file) => {
  // Optimize image with Sharp
  const processedImageBuffer = await sharp(file.buffer)
    .resize({ width: 800, height: 800, fit: 'inside' })
    .toFormat('jpeg')
    .jpeg({ quality: 80 })
    .toBuffer();
  
  // Upload to MinIO
  const imageUrl = await uploadFile(
    processedImageBuffer,
    'products',
    'jpg',
    { 'Content-Type': 'image/jpeg' }
  );
  
  return imageUrl;
};

// Create a new product
exports.createProduct = async (req, res) => {
  try {
    // Process data from request
    const productData = { ...req.body };
    
    // Handle numeric fields
    ['buyingPrice', 'sellingPrice', 'quantity', 'reorderLevel', 'maxStock'].forEach(field => {
      if (productData[field]) {
        productData[field] = Number(productData[field]);
      }
    });
    
    // Parse custom fields if they exist as a string
    if (typeof productData.customFields === 'string') {
      productData.customFields = JSON.parse(productData.customFields);
    }
    
    // Process image if it exists
    if (req.file) {
      productData.image = await processImage(req.file);
    }
    
    // Create product (QR code will be auto-generated via pre-save hook)
    const product = new Product(productData);
    await product.save();
    
    res.status(201).json({
      success: true,
      message: 'Product created successfully',
      data: product
    });
  } catch (error) {
    console.error('Error creating product:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create product',
      error: error.message
    });
  }
};

// Get all products with optional filtering
exports.getProducts = async (req, res) => {
  try {
    const { 
      category, 
      search, 
      sortBy = 'name', 
      sortOrder = 'asc',
      page = 1, 
      limit = 10,
      lowStock 
    } = req.query;
    
    // Build query
    let query = {};
    
    // Add category filter if provided
    if (category) {
      query.category = category;
    }
    
    // Add search filter if provided
    if (search) {
      query.$text = { $search: search };
    }
    
    // Add low stock filter if requested
    if (lowStock === 'true') {
      query.$expr = {
        $and: [
          { $gt: ["$reorderLevel", 0] },
          { $lte: ["$quantity", "$reorderLevel"] }
        ]
      };
    }
    
    // Calculate pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    // Determine sort direction
    const sortDirection = sortOrder === 'desc' ? -1 : 1;
    
    // Execute query with pagination
    const products = await Product.find(query)
      .sort({ [sortBy]: sortDirection })
      .skip(skip)
      .limit(parseInt(limit));
    
    // Get total count for pagination
    const total = await Product.countDocuments(query);
    
    res.status(200).json({
      success: true,
      count: products.length,
      total,
      totalPages: Math.ceil(total / parseInt(limit)),
      currentPage: parseInt(page),
      data: products
    });
  } catch (error) {
    console.error('Error fetching products:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch products',
      error: error.message
    });
  }
};

// Get a single product by ID
exports.getProductById = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }
    
    res.status(200).json({
      success: true,
      data: product
    });
  } catch (error) {
    console.error('Error fetching product:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch product',
      error: error.message
    });
  }
};

// Get a product by QR code (for scanning functionality)
exports.getProductByQrCode = async (req, res) => {
  try {
    const { productId } = req.params;
    
    // Parse the productId if it's a JSON string
    let query;
    try {
      // Try to parse as JSON
      const productData = JSON.parse(productId);
      // Use id from JSON if available, otherwise use the whole string
      query = productData.id || productData._id || productId;
    } catch (e) {
      // If parsing fails, use the productId as is (might be a plain ID)
      query = productId;
    }
    
    // Find the product by ID
    const product = await Product.findById(query);
    
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }
    
    // Format product data for cart
    const productData = {
      _id: product._id,
      name: product.name,
      productID: product.productID,
      price: product.sellingPrice,
      image: product.image,
      quantity: 1, // Default quantity for cart
      available: product.quantity // Available quantity in stock
    };
    
    res.status(200).json({
      success: true,
      data: productData
    });
  } catch (error) {
    console.error('Error processing QR code:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process QR code',
      error: error.message
    });
  }
};


// Update product
exports.updateProduct = async (req, res) => {
  try {
    // Get the existing product
    const product = await Product.findById(req.params.id);
    
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }
    
    // Process data from request
    const productData = { ...req.body };
    
    // Handle numeric fields
    ['buyingPrice', 'sellingPrice', 'quantity', 'reorderLevel', 'maxStock'].forEach(field => {
      if (productData[field]) {
        productData[field] = Number(productData[field]);
      }
    });
    
    // Parse custom fields if they exist as a string
    if (typeof productData.customFields === 'string') {
      productData.customFields = JSON.parse(productData.customFields);
    }
    
    // Process image if a new one is uploaded
    if (req.file) {
      // Delete old image if it exists
      if (product.image) {
        await deleteFile(product.image);
      }
      
      // Upload new image
      productData.image = await processImage(req.file);
    }
    
    // Update the product
    const updatedProduct = await Product.findByIdAndUpdate(
      req.params.id,
      { ...productData, updatedAt: Date.now() },
      { new: true, runValidators: true }
    );
    
    res.status(200).json({
      success: true,
      message: 'Product updated successfully',
      data: updatedProduct
    });
  } catch (error) {
    console.error('Error updating product:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update product',
      error: error.message
    });
  }
};

exports.deleteProduct = async (req, res) => {
  try {
    const { id } = req.params;
    
    // Validate ObjectId format
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid product ID format'
      });
    }
    
    // Find product first to trigger pre middleware
    const product = await Product.findById(id);
    
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }
    
    // Use deleteOne to ensure middleware runs
    await product.deleteOne();
    
    
    res.status(200).json({
      success: true,
      message: 'Product deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting product:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete product',
      error: error.message
    });
  }
};

exports.addToCartFromQrCode = async (req, res) => {
  try {
    const userId = req.user.id;
    const { productId } = req.params;
    const { quantity = 1 } = req.body;
    
    let query;
    try {
      const productData = JSON.parse(productId);
      query = productData.id || productData._id || productId;
    } catch (e) {
      query = productId;
    }
    
    // Find the product
    const product = await Product.findById(query);
    
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }
    
    // Rest of the function remains the same...
    let cart = await Cart.findOne({ 
      user: userId,
      status: 'active'
    });
    
    if (!cart) {
      cart = new Cart({ user: userId, items: [] });
    }
    
    await cart.addItem(product._id, parseInt(quantity));
    
    res.status(200).json({
      success: true,
      message: 'Product added to cart successfully',
      data: {
        _id: cart._id,
        items: cart.items,
        itemCount: cart.itemCount,
        subtotal: cart.subtotal,
        discount: cart.discount,
        total: cart.total
      }
    });
  } catch (error) {
    console.error('Error adding product to cart:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add product to cart',
      error: error.message
    });
  }
};

// Get inventory stats
exports.getInventoryStats = async (req, res) => {
  try {
    // Get total products count
    const totalProducts = await Product.countDocuments();
    
    // Get low stock products count
    const lowStockProducts = await Product.getLowStockProducts();
    
    // Get total value of inventory
    const inventoryValue = await Product.aggregate([
      {
        $group: {
          _id: null,
          totalValue: { $sum: { $multiply: ["$buyingPrice", "$quantity"] } },
          totalRetailValue: { $sum: { $multiply: ["$sellingPrice", "$quantity"] } }
        }
      }
    ]);
    
    // Get product count by category
    const productsByCategory = await Product.aggregate([
      {
        $group: {
          _id: "$category",
          count: { $sum: 1 }
        }
      },
      {
        $project: {
          category: "$_id",
          count: 1,
          _id: 0
        }
      }
    ]);
    
    res.status(200).json({
      success: true,
      data: {
        totalProducts,
        lowStockCount: lowStockProducts.length,
        inventoryValue: inventoryValue.length > 0 ? inventoryValue[0].totalValue : 0,
        retailValue: inventoryValue.length > 0 ? inventoryValue[0].totalRetailValue : 0,
        productsByCategory
      }
    });
  } catch (error) {
    console.error('Error fetching inventory stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch inventory statistics',
      error: error.message
    });
  }
};