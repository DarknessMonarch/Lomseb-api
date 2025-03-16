const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const paymentHistorySchema = new Schema({
  amount: {
    type: Number,
    required: true
  },
  date: {
    type: Date,
    default: Date.now
  },
  paymentMethod: {
    type: String,
    required: true
  },
  notes: String
});

const debtSchema = new Schema({
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  orderId: {
    type: Schema.Types.ObjectId,
    ref: 'Report',
    required: true
  },
  originalAmount: {
    type: Number,
    required: true
  },
  amountPaid: {
    type: Number,
    default: 0
  },
  remainingAmount: {
    type: Number,
    required: true
  },
  dueDate: {
    type: Date,
    required: true
  },
  status: {
    type: String,
    enum: ['current', 'overdue', 'paid'],
    default: 'current'
  },
  notes: String,
  paymentHistory: [paymentHistorySchema],
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, { timestamps: true });

// Pre-save hook to calculate status
debtSchema.pre('save', function(next) {
  // If remaining amount is 0 or less, mark as paid
  if (this.remainingAmount <= 0) {
    this.status = 'paid';
  } else {
    // Check if debt is overdue
    const now = new Date();
    if (this.dueDate < now && this.status !== 'paid') {
      this.status = 'overdue';
    } else if (this.status !== 'paid') {
      this.status = 'current';
    }
  }
  next();
});

// Method to record a payment
debtSchema.methods.recordPayment = function(amount, paymentMethod, notes = '') {
  if (amount <= 0) {
    throw new Error('Payment amount must be greater than 0');
  }

  if (amount > this.remainingAmount) {
    throw new Error('Payment amount cannot exceed the remaining debt');
  }

  // Record the payment in history
  this.paymentHistory.push({
    amount,
    date: new Date(),
    paymentMethod,
    notes
  });

  // Update debt amounts
  this.amountPaid += amount;
  this.remainingAmount = Math.max(0, this.remainingAmount - amount);

  // Update status
  if (this.remainingAmount === 0) {
    this.status = 'paid';
  }

  // Mark as updated
  this.updatedAt = new Date();
};

// Virtual for calculating payment status (for API compatibility)
debtSchema.virtual('paymentStatus').get(function() {
  if (this.remainingAmount <= 0) return 'paid';
  if (this.amountPaid > 0) return 'partial';
  return 'unpaid';
});

const Debt = mongoose.model('Debt', debtSchema);

module.exports = Debt;