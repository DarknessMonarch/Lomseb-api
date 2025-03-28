const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const reportItemSchema = new Schema({
  productId: {
    type: Schema.Types.ObjectId,
    ref: 'Product',
    required: true
  },
  productName: {
    type: String,
    required: true
  },
  productID: {
    type: String,
    required: true
  },
  category: {
    type: String,
    required: true
  },
  quantity: {
    type: Number,
    required: true,
    min: 1
  },
  unit: {
    type: String,
    default: 'pcs'
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
  cost: {
    type: Number,
    required: true,
    min: 0
  },
  revenue: {
    type: Number,
    required: true,
    min: 0
  },
  profit: {
    type: Number,
    required: true
  }
});

// Define category details schema for aggregated data
const categoryDetailSchema = new Schema({
  count: {
    type: Number,
    default: 0
  },
  revenue: {
    type: Number,
    default: 0
  },
  profit: {
    type: Number,
    default: 0
  }
});

// Define expenditure item schema for reports
const expenditureItemSchema = new Schema({
  expenditureId: {
    type: Schema.Types.ObjectId,
    ref: 'Expenditure',
    required: true
  },
  amount: {
    type: Number,
    required: true,
    min: 0.01
  },
  description: {
    type: String,
    required: true
  },
  category: {
    type: String,
    required: true,
    enum: ['salary', 'supplies', 'utilities', 'maintenance', 'miscellaneous']
  },
  employeeName: {
    type: String,
    required: true
  }
});

// Define main report schema
const reportSchema = new Schema({
  saleId: {
    type: Schema.Types.ObjectId,
    ref: 'Sale',
    required: false,
  },
  date: {
    type: Date,
    default: Date.now,
    required: true
  },
  items: [reportItemSchema],
  expenditures: [expenditureItemSchema], // Added expenditure items array
  totalRevenue: {
    type: Number,
    required: true,
    min: 0
  },
  totalCost: {
    type: Number,
    required: true,
    min: 0
  },
  totalProfit: {
    type: Number,
    required: true
  },
  totalExpenditures: { // Added total expenditures field
    type: Number,
    default: 0,
    min: 0
  },
  netProfit: { // Added net profit (considering expenditures)
    type: Number,
    required: true
  },
  categories: {
    type: Map,
    of: categoryDetailSchema,
    default: () => new Map()
  },
  expenditureCategories: { // Added expenditure categories mapping
    type: Map,
    of: new Schema({
      count: {
        type: Number,
        default: 0
      },
      amount: {
        type: Number,
        default: 0
      }
    }, { _id: false }),
    default: () => new Map()
  },
  paymentMethod: {
    type: String,
    required: true
  },
  paymentStatus: {
    type: String,
    enum: ['paid', 'partial', 'unpaid'],
    default: 'paid'
  },
  amountPaid: {
    type: Number,
    default: 0
  },
  remainingBalance: {
    type: Number,
    default: 0
  },
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User'
  },
  type: { 
    type: String,
    enum: ['sale', 'expenditure', 'mixed'],
    default: 'sale'
  }
}, {
  timestamps: true
});

// Update pre-save hook to round values
reportSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  // Calculate total without decimal places
  const subtotal = this.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  this.total = Math.round(subtotal - this.discount);
  next();
});

// Virtual for subtotal with rounding
reportSchema.virtual('subtotal').get(function() {
  const subtotal = this.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  return Math.round(subtotal);
});

reportSchema.statics.getSalesReports = async function({ 
  startDate, 
  endDate, 
  period = 'weekly', 
  category = null,
  includeExpenditures = true
}) {
  const match = {};
  
  if (startDate || endDate) {
    match.date = {};
    if (startDate) match.date.$gte = new Date(startDate);
    if (endDate) match.date.$lte = new Date(endDate);
  }
  
  if (category) {
    match['categories.' + category] = { $exists: true };
  }
  
  let dateFormat;
  switch (period.toLowerCase()) {
    case 'daily':
      dateFormat = { 
        $dateToString: { format: "%Y-%m-%d", date: "$date" }
      };
      break;
    case 'weekly':
      dateFormat = { 
        $dateToString: { 
          format: "%Y-W%V", 
          date: "$date"
        }
      };
      break;
    case 'monthly':
      dateFormat = { 
        $dateToString: { format: "%Y-%m", date: "$date" }
      };
      break;
    case 'yearly':
      dateFormat = { 
        $dateToString: { format: "%Y", date: "$date" }
      };
      break;
    default:
      dateFormat = { 
        $dateToString: { format: "%Y-%m-%d", date: "$date" }
      };
  }
  
  const pipeline = [
    { $match: match },
    { 
      $group: {
        _id: dateFormat,
        totalRevenue: { $sum: "$totalRevenue" },
        totalCost: { $sum: "$totalCost" },
        totalProfit: { $sum: "$totalProfit" },
        orderCount: { $sum: 1 },
        earliestDate: { $min: "$date" },
        latestDate: { $max: "$date" }
      }
    }
  ];
  
  if (includeExpenditures) {
    pipeline[1].$group.totalExpenditures = { $sum: "$totalExpenditures" };
    pipeline[1].$group.netProfit = { $sum: "$netProfit" };
  }
  
  pipeline.push(
    { $sort: { _id: 1 } },
    {
      $project: {
        period: "$_id",
        totalRevenue: { $round: ["$totalRevenue", 0] },
        totalCost: { $round: ["$totalCost", 0] },
        totalProfit: { $round: ["$totalProfit", 0] },
        netRevenue: { $round: [{ $subtract: ["$totalRevenue", "$totalExpenditures"] }, 0] },
        orderCount: 1,
        earliestDate: 1,
        latestDate: 1,
        _id: 0
      }
    }
  );
  
  if (includeExpenditures) {
    pipeline[pipeline.length - 1].$project.totalExpenditures = { $round: ["$totalExpenditures", 0] };
    pipeline[pipeline.length - 1].$project.netProfit = { $round: ["$netProfit", 0] };
  }
  
  // Perform aggregation
  const result = await this.aggregate(pipeline);
  
  return result;
};

// Get product reports
reportSchema.statics.getProductReports = async function({ 
  startDate, 
  endDate, 
  limit = 10,
  sortBy = 'totalSales',
  order = 'desc'
}) {
  const match = {};
  
  // Date filtering
  if (startDate || endDate) {
    match.date = {};
    if (startDate) match.date.$gte = new Date(startDate);
    if (endDate) match.date.$lte = new Date(endDate);
  }
  
  // Create comparison date range for growth calculation
  const currentEndDate = endDate ? new Date(endDate) : new Date();
  const currentStartDate = startDate ? new Date(startDate) : new Date(currentEndDate);
  currentStartDate.setMonth(currentStartDate.getMonth() - 1);
  
  // Calculate the previous period with the same duration
  const duration = endDate && startDate ? 
    (new Date(endDate) - new Date(startDate)) : 
    (30 * 24 * 60 * 60 * 1000); // default to 30 days
    
  const previousEndDate = new Date(currentStartDate);
  const previousStartDate = new Date(previousEndDate);
  previousStartDate.setTime(previousStartDate.getTime() - duration);
  
  // Get current period data
  const currentPeriodData = await this.aggregate([
    { 
      $match: {
        ...match,
        date: { $gte: currentStartDate, $lte: currentEndDate }
      }
    },
    { $unwind: "$items" },
    { 
      $group: {
        _id: {
          productId: "$items.productId",
          productName: "$items.productName",
          productID: "$items.productID",
          category: "$items.category"
        },
        totalQuantity: { $sum: "$items.quantity" },
        totalSales: { $sum: "$items.revenue" },
        totalProfit: { $sum: "$items.profit" }
      }
    }
  ]);
  
  // Get previous period data for growth calculation
  const previousPeriodData = await this.aggregate([
    { 
      $match: {
        date: { $gte: previousStartDate, $lte: previousEndDate }
      }
    },
    { $unwind: "$items" },
    { 
      $group: {
        _id: { productId: "$items.productId" },
        totalSales: { $sum: "$items.revenue" }
      }
    }
  ]);
  
  // Create a lookup map for previous sales
  const previousSalesMap = new Map();
  previousPeriodData.forEach(item => {
    previousSalesMap.set(item._id.productId.toString(), item.totalSales);
  });
  
  // Get current inventory levels
  const Product = mongoose.model('Product');
  const products = await Product.find({
    _id: { $in: currentPeriodData.map(item => item._id.productId) }
  }, { _id: 1, quantity: 1, unit: 1 });
  
  // Create inventory lookup map
  const inventoryMap = new Map();
  products.forEach(product => {
    inventoryMap.set(product._id.toString(), {
      stock: product.quantity,
      unit: product.unit
    });
  });
  
  // Combine data and calculate growth
  const productReports = currentPeriodData.map(item => {
    const productId = item._id.productId.toString();
    const previousSales = previousSalesMap.get(productId) || 0;
    const inventory = inventoryMap.get(productId) || { stock: 0, unit: 'pcs' };
    
    const currentSales = item.totalSales;
    let growthRate = previousSales > 0 ? 
      ((currentSales - previousSales) / previousSales) * 100 : 0;
    
    // Round the values
    growthRate = Math.round(growthRate * 10) / 10; // Round to 1 decimal place
    
    return {
      id: item._id.productId,
      name: item._id.productName,
      productID: item._id.productID,
      category: item._id.category,
      quantitySold: item.totalQuantity,
      totalSales: Math.round(item.totalSales),
      totalProfit: Math.round(item.totalProfit),
      growthRate: growthRate,
      stock: inventory.stock,
      unit: inventory.unit
    };
  });
  
  // Sort results
  const sortOrder = order.toLowerCase() === 'asc' ? 1 : -1;
  
  productReports.sort((a, b) => {
    if (sortBy === 'totalSales') {
      return (a.totalSales - b.totalSales) * sortOrder;
    } else if (sortBy === 'totalProfit') {
      return (a.totalProfit - b.totalProfit) * sortOrder;
    } else if (sortBy === 'growthRate') {
      return (a.growthRate - b.growthRate) * sortOrder;
    } else if (sortBy === 'quantitySold') {
      return (a.quantitySold - b.quantitySold) * sortOrder;
    } else {
      return (a.totalSales - b.totalSales) * sortOrder;
    }
  });
  
  // Apply limit
  return productReports.slice(0, limit);
};

// Get category reports
reportSchema.statics.getCategoryReports = async function({
  startDate,
  endDate,
  limit = 10
}) {
  const match = {};
  
  // Date filtering
  if (startDate || endDate) {
    match.date = {};
    if (startDate) match.date.$gte = new Date(startDate);
    if (endDate) match.date.$lte = new Date(endDate);
  }
  
  // Create comparison date range for growth calculation
  const currentEndDate = endDate ? new Date(endDate) : new Date();
  const currentStartDate = startDate ? new Date(startDate) : new Date(currentEndDate);
  currentStartDate.setMonth(currentStartDate.getMonth() - 1);
  
  // Calculate the previous period with the same duration
  const duration = endDate && startDate ? 
    (new Date(endDate) - new Date(startDate)) : 
    (30 * 24 * 60 * 60 * 1000); // default to 30 days
    
  const previousEndDate = new Date(currentStartDate);
  const previousStartDate = new Date(previousEndDate);
  previousStartDate.setTime(previousStartDate.getTime() - duration);
  
  // Current period data
  const result = await this.aggregate([
    { 
      $match: {
        ...match,
        date: { $gte: currentStartDate, $lte: currentEndDate }
      }
    },
    { $unwind: "$items" },
    {
      $group: {
        _id: "$items.category",
        totalSales: { $sum: "$items.revenue" },
        totalProfit: { $sum: "$items.profit" },
        count: { $sum: "$items.quantity" }
      }
    },
    { $sort: { totalSales: -1 } },
    { $limit: limit }
  ]);
  
  // Previous period data
  const previousPeriodData = await this.aggregate([
    { 
      $match: {
        date: { $gte: previousStartDate, $lte: previousEndDate }
      }
    },
    { $unwind: "$items" },
    {
      $group: {
        _id: "$items.category",
        totalSales: { $sum: "$items.revenue" }
      }
    }
  ]);
  
  // Create a lookup map for previous data
  const previousSalesMap = new Map();
  previousPeriodData.forEach(item => {
    previousSalesMap.set(item._id, item.totalSales);
  });
  
  // Calculate growth rates
  const categoryReports = result.map(category => {
    const previousSales = previousSalesMap.get(category._id) || 0;
    const growthRate = previousSales > 0 ? 
      ((category.totalSales - previousSales) / previousSales) * 100 : 0;
      
    return {
      name: category._id,
      totalSales: Math.round(category.totalSales),
      totalProfit: Math.round(category.totalProfit),
      count: category.count,
      growthRate: Math.round(growthRate * 10) / 10 // Round to 1 decimal place
    };
  });
  
  return categoryReports;
};

// Get payment method reports
reportSchema.statics.getPaymentMethodReports = async function({
  startDate,
  endDate
}) {
  const match = {};
  
  // Date filtering
  if (startDate || endDate) {
    match.date = {};
    if (startDate) match.date.$gte = new Date(startDate);
    if (endDate) match.date.$lte = new Date(endDate);
  }
  
  const result = await this.aggregate([
    { $match: match },
    {
      $group: {
        _id: "$paymentMethod",
        totalRevenue: { $sum: "$totalRevenue" },
        totalProfit: { $sum: "$totalProfit" },
        count: { $sum: 1 },
        averageOrderValue: { $avg: "$totalRevenue" }
      }
    },
    {
      $project: {
        paymentMethod: "$_id",
        totalRevenue: { $round: ["$totalRevenue", 0] },
        totalProfit: { $round: ["$totalProfit", 0] },
        count: 1,
        averageOrderValue: { $round: ["$averageOrderValue", 0] },
        _id: 0
      }
    }
  ]);
  
  return result;
};

// Get expenditure reports - With rounding
reportSchema.statics.getExpenditureReports = async function({
  startDate,
  endDate,
  period = 'weekly',
  category = null
}) {
  const match = {};
  
  // Date filtering
  if (startDate || endDate) {
    match.date = {};
    if (startDate) match.date.$gte = new Date(startDate);
    if (endDate) match.date.$lte = new Date(endDate);
  }
  
  // Only include reports with expenditures
  match.totalExpenditures = { $gt: 0 };
  
  // Category filtering
  if (category) {
    match[`expenditureCategories.${category}`] = { $exists: true };
  }
  
  // Set the grouping based on the period
  let dateFormat;
  switch (period.toLowerCase()) {
    case 'daily':
      dateFormat = { 
        $dateToString: { format: "%Y-%m-%d", date: "$date" }
      };
      break;
    case 'weekly':
      dateFormat = { 
        $dateToString: { 
          format: "%Y-W%V", 
          date: "$date"
        }
      };
      break;
    case 'monthly':
      dateFormat = { 
        $dateToString: { format: "%Y-%m", date: "$date" }
      };
      break;
    case 'yearly':
      dateFormat = { 
        $dateToString: { format: "%Y", date: "$date" }
      };
      break;
    default:
      dateFormat = { 
        $dateToString: { format: "%Y-%m-%d", date: "$date" }
      };
  }
  
  // Perform aggregation
  const result = await this.aggregate([
    { $match: match },
    { 
      $group: {
        _id: dateFormat,
        totalExpenditures: { $sum: "$totalExpenditures" },
        expenditureCount: { $sum: { $size: "$expenditures" } },
        earliestDate: { $min: "$date" },
        latestDate: { $max: "$date" }
      }
    },
    { 
      $sort: { _id: 1 }
    },
    {
      $project: {
        period: "$_id",
        totalExpenditures: { $round: ["$totalExpenditures", 0] },
        expenditureCount: 1,
        earliestDate: 1,
        latestDate: 1,
        _id: 0
      }
    }
  ]);
  
  return result;
};

// Get expenditure category reports - With rounding
reportSchema.statics.getExpenditureCategoryReports = async function({
  startDate,
  endDate,
  limit = 10
}) {
  const match = {};
  
  // Date filtering
  if (startDate || endDate) {
    match.date = {};
    if (startDate) match.date.$gte = new Date(startDate);
    if (endDate) match.date.$lte = new Date(endDate);
  }
  
  // Only include reports with expenditures
  match.totalExpenditures = { $gt: 0 };
  
  // Get expenditures by category
  const result = await this.aggregate([
    { $match: match },
    { $unwind: "$expenditures" },
    {
      $group: {
        _id: "$expenditures.category",
        totalAmount: { $sum: "$expenditures.amount" },
        count: { $sum: 1 }
      }
    },
    { $sort: { totalAmount: -1 } },
    { $limit: limit },
    {
      $project: {
        category: "$_id",
        totalAmount: { $round: ["$totalAmount", 0] },
        count: 1,
        _id: 0
      }
    }
  ]);
  
  return result;
};

// Get inventory valuation with rounding
reportSchema.statics.getInventoryValuationReport = async function() {
  const Product = mongoose.model('Product');
  
  // Get all products with their inventory data
  const products = await Product.find(
    {}, 
    { 
      name: 1, 
      productID: 1, 
      quantity: 1, 
      buyingPrice: 1, 
      category: 1 
    }
  );
  
  // Calculate total value and group by category with rounding
  let totalValue = 0;
  const categoryValues = {};
  
  products.forEach(product => {
    const itemValue = Math.round(product.quantity * product.buyingPrice);
    totalValue += itemValue;
    
    if (!categoryValues[product.category]) {
      categoryValues[product.category] = {
        count: 0,
        value: 0
      };
    }
    
    categoryValues[product.category].count += 1;
    categoryValues[product.category].value += itemValue;
  });
  
  // Prepare category breakdown with rounded percentages
  const categoryBreakdown = Object.keys(categoryValues).map(category => ({
    category,
    productCount: categoryValues[category].count,
    value: categoryValues[category].value,
    percentage: Math.round((categoryValues[category].value / totalValue) * 1000) / 10 // Round to 1 decimal place
  }));
  
  return {
    totalValue: Math.round(totalValue),
    categoryBreakdown,
    productCount: products.length,
    lowStockCount: products.filter(p => p.quantity <= 5).length,
    outOfStockCount: products.filter(p => p.quantity === 0).length,
    lastUpdated: new Date()
  };
};

reportSchema.statics.exportSalesReports = async function(options) {
  const data = await this.getSalesReports(options);
  return {
    success: true,
    data,
    exportTime: new Date(),
    format: options.format || 'csv'
  };
};

reportSchema.statics.addExpenditureToReport = async function(expenditure, userId) {
  const latestReport = await this.findOne({}).sort({ date: -1 });
  
  if (latestReport) {
    const expenditureItem = {
      expenditureId: expenditure._id,
      amount: expenditure.amount,
      description: expenditure.description,
      category: expenditure.category,
      employeeName: expenditure.employeeName
    };
    
    const categoryKey = expenditure.category;
    let categoryData = latestReport.expenditureCategories.get(categoryKey) || { count: 0, amount: 0 };
    categoryData.count += 1;
    categoryData.amount += expenditure.amount;
    latestReport.expenditureCategories.set(categoryKey, categoryData);
    
    latestReport.expenditures.push(expenditureItem);
    latestReport.totalExpenditures += expenditure.amount;
    
    // CHANGE: Subtract expenditure from totalRevenue 
    latestReport.totalRevenue -= expenditure.amount;
    latestReport.netProfit = latestReport.totalProfit - latestReport.totalExpenditures;
    
    if (latestReport.type === 'sale') {
      latestReport.type = 'mixed';
    }
    
    await latestReport.save();
    return latestReport;
  } else {
    // Create new report with just the expenditure
    const newReport = new this({
      date: new Date(),
      items: [],
      expenditures: [{
        expenditureId: expenditure._id,
        amount: expenditure.amount,
        description: expenditure.description,
        category: expenditure.category,
        employeeName: expenditure.employeeName
      }],
      totalRevenue: -expenditure.amount, // CHANGE: Start with negative revenue
      totalCost: 0,
      totalProfit: 0,
      totalExpenditures: expenditure.amount,
      netProfit: -expenditure.amount,
      expenditureCategories: new Map([
        [expenditure.category, { count: 1, amount: expenditure.amount }]
      ]),
      paymentMethod: 'expenditure',
      paymentStatus: 'paid',
      amountPaid: 0,
      remainingBalance: 0,
      user: userId,
      type: 'expenditure'
    });
    
    await newReport.save();
    return newReport;
  }
};

reportSchema.statics.getProfitAndLossReport = async function({
  startDate,
  endDate,
  period = 'monthly'
}) {
  const match = {};
  
  if (startDate || endDate) {
    match.date = {};
    if (startDate) match.date.$gte = new Date(startDate);
    if (endDate) match.date.$lte = new Date(endDate);
  }
  
  let dateFormat;
  switch (period.toLowerCase()) {
    case 'daily':
      dateFormat = { 
        $dateToString: { format: "%Y-%m-%d", date: "$date" }
      };
      break;
    case 'weekly':
      dateFormat = { 
        $dateToString: { 
          format: "%Y-W%V", 
          date: "$date"
        }
      };
      break;
    case 'monthly':
      dateFormat = { 
        $dateToString: { format: "%Y-%m", date: "$date" }
      };
      break;
    case 'yearly':
      dateFormat = { 
        $dateToString: { format: "%Y", date: "$date" }
      };
      break;
    default:
      dateFormat = { 
        $dateToString: { format: "%Y-%m-%d", date: "$date" }
      };
  }
  
  const result = await this.aggregate([
    { $match: match },
    { 
      $group: {
        _id: dateFormat,
        totalRevenue: { $sum: "$totalRevenue" },
        totalCost: { $sum: "$totalCost" },
        grossProfit: { $sum: "$totalProfit" },
        totalExpenditures: { $sum: "$totalExpenditures" },
        netProfit: { $sum: "$netProfit" },
        netRevenue: { $sum: { $subtract: ["$totalRevenue", "$totalExpenditures"] } },
        reportCount: { $sum: 1 }
      }
    },
    { 
      $sort: { _id: 1 }
    },
    {
      $project: {
        period: "$_id",
        totalRevenue: { $round: ["$totalRevenue", 0] },
        totalCost: { $round: ["$totalCost", 0] },
        grossProfit: { $round: ["$grossProfit", 0] },
        netRevenue: { $round: ["$netRevenue", 0] },
        totalExpenditures: { $round: ["$totalExpenditures", 0] },
        netProfit: { $round: ["$netProfit", 0] },
        grossMargin: { 
          $round: [
            { $cond: [
              { $eq: ["$totalRevenue", 0] },
              0,
              { $multiply: [{ $divide: ["$grossProfit", "$totalRevenue"] }, 100] }
            ]},
            1
          ]
        },
        netMargin: { 
          $round: [
            { $cond: [
              { $eq: ["$totalRevenue", 0] },
              0,
              { $multiply: [{ $divide: ["$netProfit", "$totalRevenue"] }, 100] }
            ]},
            1
          ]
        },
        _id: 0
      }
    }
  ]);
  
  return result;
};

module.exports = mongoose.model('Report', reportSchema);