const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const expenditureSchema = new Schema({
  amount: {
    type: Number,
    required: true,
    min: 0.01
  },
  description: {
    type: String,
    required: true,
    trim: true
  },
  employeeName: {
    type: String,
    required: true,
    trim: true
  },
  employeeId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  date: {
    type: Date,
    default: Date.now,
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending'
  },
  approvedBy: {
    type: Schema.Types.ObjectId,
    ref: 'User'
  },
  approvalDate: {
    type: Date
  },
  category: {
    type: String,
    required: true,
    enum: ['salary', 'supplies', 'utilities', 'maintenance', 'miscellaneous']
  },
  notes: {
    type: String,
    trim: true
  },
  receiptImage: {
    type: String
  },
  manuallyApproved: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

expenditureSchema.statics.getTotalExpenditures = async function(startDate, endDate) {
  const match = {};
  
  if (startDate || endDate) {
    match.date = {};
    if (startDate) match.date.$gte = new Date(startDate);
    if (endDate) match.date.$lte = new Date(endDate);
  }
  
  // Only include approved expenditures
  match.status = 'approved';
  
  const result = await this.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        totalAmount: { $sum: "$amount" }
      }
    }
  ]);
  
  return result.length > 0 ? result[0].totalAmount : 0;
};

expenditureSchema.statics.getExpendituresByCategory = async function(startDate, endDate) {
  const match = {};
  
  if (startDate || endDate) {
    match.date = {};
    if (startDate) match.date.$gte = new Date(startDate);
    if (endDate) match.date.$lte = new Date(endDate);
  }
  
  match.status = { $ne: 'rejected' };
  
  return this.aggregate([
    { $match: match },
    {
      $group: {
        _id: "$category",
        totalAmount: { $sum: "$amount" },
        count: { $sum: 1 }
      }
    },
    {
      $project: {
        category: "$_id",
        totalAmount: 1,
        count: 1,
        _id: 0
      }
    },
    { $sort: { totalAmount: -1 } }
  ]);
};

expenditureSchema.statics.getExpendituresByEmployee = async function(startDate, endDate) {
  const match = {};
  
  if (startDate || endDate) {
    match.date = {};
    if (startDate) match.date.$gte = new Date(startDate);
    if (endDate) match.date.$lte = new Date(endDate);
  }
  
  return this.aggregate([
    { $match: match },
    {
      $group: {
        _id: "$employeeId",
        employeeName: { $first: "$employeeName" },
        totalAmount: { $sum: "$amount" },
        count: { $sum: 1 }
      }
    },
    {
      $project: {
        employeeId: "$_id",
        employeeName: 1,
        totalAmount: 1,
        count: 1,
        _id: 0
      }
    },
    { $sort: { totalAmount: -1 } }
  ]);
};

module.exports = mongoose.model('Expenditure', expenditureSchema);