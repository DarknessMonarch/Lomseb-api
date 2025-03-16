const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const cartItemSchema = new Schema({
  product: {
    type: Schema.Types.ObjectId,
    ref: 'Product',
    required: true
  },
  quantity: {
    type: Number,
    required: true,
    min: 1
  },
  price: {
    type: Number,
    required: true,
    min: 0
  },
  name: {
    type: String,
    required: true
  },
  productID: {
    type: String,
    required: true
  },
  image: {
    type: String,
    default: null
  },
  unit: {
    type: String,
    default: 'pcs'
  }
});

const cartSchema = new Schema({
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  items: [cartItemSchema],
  total: {
    type: Number,
    default: 0
  },
  couponCode: {
    type: String,
    default: null
  },
  discount: {
    type: Number,
    default: 0
  },
  note: {
    type: String,
    default: ''
  },
  paymentStatus: {
    type: String,
    enum: ['paid', 'partial', 'unpaid'],
    default: 'unpaid'
  },
  amountPaid: {
    type: Number,
    default: 0
  },
  remainingBalance: {
    type: Number,
    default: 0
  },
  status: {
    type: String,
    enum: ['active', 'checkout', 'abandoned', 'converted'],
    default: 'active'
  },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: 604800 // Cart expires after 7 days (in seconds)
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true,
  toJSON: {
    virtuals: true
  }
});

// Virtual for cart subtotal (before discount)
cartSchema.virtual('subtotal').get(function() {
  return this.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
});

// Virtual for item count
cartSchema.virtual('itemCount').get(function() {
  return this.items.reduce((sum, item) => sum + item.quantity, 0);
});

// Update total when saving cart
cartSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  // Calculate total with discount applied
  this.total = this.items.reduce((sum, item) => sum + (item.price * item.quantity), 0) - this.discount;
  next();
});

// Methods
cartSchema.methods.addItem = async function(productId, quantity) {
  const Product = mongoose.model('Product');
  const product = await Product.findById(productId);
  
  if (!product) {
    throw new Error('Product not found');
  }
  
  if (product.quantity < quantity) {
    throw new Error(`Only ${product.quantity} units available`);
  }
  
  // Check if item already exists in cart
  const existingItemIndex = this.items.findIndex(item => 
    item.product.toString() === productId.toString()
  );
  
  if (existingItemIndex > -1) {
    // Update existing item
    const newQuantity = this.items[existingItemIndex].quantity + quantity;
    
    if (product.quantity < newQuantity) {
      throw new Error(`Only ${product.quantity} units available`);
    }
    
    this.items[existingItemIndex].quantity = newQuantity;
  } else {
    // Add new item
    this.items.push({
      product: productId,
      quantity: quantity,
      price: product.sellingPrice,
      name: product.name,
      productID: product.productID,
      image: product.image,
      unit: product.unit
    });
  }
  
  return this.save();
};

cartSchema.methods.updateItemQuantity = async function(itemId, quantity) {
  const Product = mongoose.model('Product');
  const itemIndex = this.items.findIndex(item => item._id.toString() === itemId);
  
  if (itemIndex === -1) {
    throw new Error('Item not found in cart');
  }
  
  const product = await Product.findById(this.items[itemIndex].product);
  
  if (!product) {
    throw new Error('Product not found');
  }
  
  if (product.quantity < quantity) {
    throw new Error(`Only ${product.quantity} units available`);
  }
  
  this.items[itemIndex].quantity = quantity;
  return this.save();
};

cartSchema.methods.removeItem = function(itemId) {
  const itemIndex = this.items.findIndex(item => item._id.toString() === itemId);
  
  if (itemIndex === -1) {
    throw new Error('Item not found in cart');
  }
  
  this.items.splice(itemIndex, 1);
  return this.save();
};

cartSchema.methods.clearCart = function() {
  this.items = [];
  this.discount = 0;
  this.couponCode = null;
  return this.save();
};



cartSchema.methods.setStatus = function(status) {
  this.status = status;
  return this.save();
};

// Static methods
cartSchema.statics.getCartByUser = function(userId) {
  return this.findOne({ 
    user: userId,
    status: 'active'
  }).populate('items.product');
};



module.exports = mongoose.model('Cart', cartSchema);