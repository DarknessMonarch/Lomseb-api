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
  const match = { status: 'approved' };
  
  if (startDate || endDate) {
    match.date = {};
    if (startDate) match.date.$gte = new Date(startDate);
    if (endDate) {
      const endDateObj = new Date(endDate);
      endDateObj.setDate(endDateObj.getDate() + 1);
      endDateObj.setMilliseconds(endDateObj.getMilliseconds() - 1);
      match.date.$lte = endDateObj;
    }
  }
    
  const result = await this.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        totalAmount: { $sum: "$amount" }
      }
    }
  ]);
  
  const total = result.length > 0 ? result[0].totalAmount : 0;
  return total;
};

expenditureSchema.statics.getExpendituresByCategory = async function(startDate, endDate) {
  const match = { status: 'approved' };
  
  if (startDate || endDate) {
    match.date = {};
    if (startDate) match.date.$gte = new Date(startDate);
    if (endDate) {
      const endDateObj = new Date(endDate);
      endDateObj.setDate(endDateObj.getDate() + 1);
      endDateObj.setMilliseconds(endDateObj.getMilliseconds() - 1);
      match.date.$lte = endDateObj;
    }
  }
    
  const result = await this.aggregate([
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
  
  return result;
};
 

expenditureSchema.statics.getExpendituresByEmployee = async function(startDate, endDate) {
  const match = { status: 'approved' };
  
  if (startDate || endDate) {
    match.date = {};
    if (startDate) match.date.$gte = new Date(startDate);
    if (endDate) {
      const endDateObj = new Date(endDate);
      endDateObj.setDate(endDateObj.getDate() + 1);
      endDateObj.setMilliseconds(endDateObj.getMilliseconds() - 1);
      match.date.$lte = endDateObj;
    }
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


expenditureSchema.index({ employeeId: 1, date: -1 });
expenditureSchema.index({ category: 1, date: -1 });
expenditureSchema.index({ status: 1 });

const Expenditure = mongoose.model('Expenditure', expenditureSchema);
module.exports = Expenditure;