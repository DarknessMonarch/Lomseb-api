const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const QRCode = require('qrcode');
const { uploadFile, deleteFile } = require('../helpers/fileStorage');

const customFieldSchema = new Schema({
  key: { 
    type: String, 
    required: true 
  },
  value: { 
    type: String, 
    default: '' 
  }
});

const productSchema = new Schema({
  productID: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  image: {
    type: String,
    default: null
  },
  category: {
    type: String,
    required: true,
    enum: ['tires', 'electronics', 'accessories', 'parts', 'tools', 'other']
  },
  buyingPrice: {
    type: Number,
    required: true,
    min: 0
  },
  sellingPrice: {
    type: Number,
    required: true,
    min: 0
  },
  quantity: {
    type: Number,
    required: true,
    min: 0
  },
  unit: {
    type: String,
    default: 'pcs',
    enum: ['pcs', 'kg', 'boxes', 'liters', 'sets']
  },
  supplierName: {
    type: String,
    trim: true
  },
  supplierContact: {
    type: String,
    trim: true
  },
  reorderLevel: {
    type: Number,
    min: 0
  },
  maxStock: {
    type: Number,
    min: 0
  },
  storageLocation: {
    type: String,
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  qrCode: {
    type: String,
    default: null
  },
  expiryDate: {
    type: Date,
    default: null
  },
  customFields: [customFieldSchema],
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Create index for search
productSchema.index({ name: 'text', productID: 'text', description: 'text' });

// Generate QR code and update before saving
productSchema.pre('save', async function(next) {
  this.updatedAt = Date.now();
  
  // Don't regenerate QR if one already exists
  if (!this.isNew && this.qrCode) {
    return next();
  }
  
  try {
    // Create product info for QR code
    const productInfo = {
      id: this._id,
      productID: this.productID,
      name: this.name,
      price: this.sellingPrice,
      category: this.category
    };
    
    // Generate QR code as buffer
    const qrBuffer = await QRCode.toBuffer(JSON.stringify(productInfo), {
      errorCorrectionLevel: 'H',
      type: 'png',
      margin: 1,
      scale: 8
    });
    
    // Upload QR code to MinIO
    const qrUrl = await uploadFile(qrBuffer, 'qrcodes', 'png', {
      'product-id': this.productID,
      'Content-Disposition': `inline; filename="qr_${this.productID}.png"`
    });
    
    this.qrCode = qrUrl;
    next();
  } catch (error) {
    next(error);
  }
});

// Delete associated files when product is deleted
productSchema.pre('deleteOne', { document: true }, async function(next) {
  try {
    // Delete image from MinIO if it exists
    if (this.image) {
      await deleteFile(this.image);
    }
    
    // Delete QR code from MinIO if it exists
    if (this.qrCode) {
      await deleteFile(this.qrCode);
    }
    
    next();
  } catch (error) {
    next(error);
  }
});

// Helper method to check if product needs reordering
productSchema.methods.needsReordering = function() {
  return this.reorderLevel && this.quantity <= this.reorderLevel;
};

// Method to get low stock products
productSchema.statics.getLowStockProducts = function() {
  return this.find({
    $expr: {
      $and: [
        { $gt: ["$reorderLevel", 0] },
        { $lte: ["$quantity", "$reorderLevel"] }
      ]
    }
  });
};

// Method to get products by category
productSchema.statics.getByCategory = function(category) {
  return this.find({ category });
};

module.exports = mongoose.model('Product', productSchema);