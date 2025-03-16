const mongoose = require('mongoose');
const Report = require('../models/report');
const Product = require('../models/product');
const { createObjectCsvStringifier } = require('csv-writer');

// Get sales reports
exports.getSalesReports = async (req, res) => {
  try {
    const { 
      period = 'weekly', 
      startDate, 
      endDate, 
      category 
    } = req.query;
    
    const reports = await Report.getSalesReports({
      period,
      startDate,
      endDate,
      category
    });
    
    res.status(200).json({
      success: true,
      data: reports
    });
  } catch (error) {
    console.error('Error fetching sales reports:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch sales reports',
      error: error.message
    });
  }
};

// Get product reports
exports.getProductReports = async (req, res) => {
  try {
    const { 
      limit = 10, 
      sortBy = 'totalSales', 
      order = 'desc',
      startDate,
      endDate 
    } = req.query;
    
    const reports = await Report.getProductReports({
      limit: parseInt(limit),
      sortBy,
      order,
      startDate,
      endDate
    });
    
    res.status(200).json({
      success: true,
      data: reports
    });
  } catch (error) {
    console.error('Error fetching product reports:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch product reports',
      error: error.message
    });
  }
};

// Get category reports
exports.getCategoryReports = async (req, res) => {
  try {
    const { 
      limit = 10,
      startDate,
      endDate 
    } = req.query;
    
    const reports = await Report.getCategoryReports({
      limit: parseInt(limit),
      startDate,
      endDate
    });
    
    res.status(200).json({
      success: true,
      data: reports
    });
  } catch (error) {
    console.error('Error fetching category reports:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch category reports',
      error: error.message
    });
  }
};

// Get payment method reports
exports.getPaymentMethodReports = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    const reports = await Report.getPaymentMethodReports({
      startDate,
      endDate
    });
    
    res.status(200).json({
      success: true,
      data: reports
    });
  } catch (error) {
    console.error('Error fetching payment method reports:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch payment method reports',
      error: error.message
    });
  }
};

// Get inventory valuation
exports.getInventoryValuation = async (req, res) => {
  try {
    const report = await Report.getInventoryValuationReport();
    
    res.status(200).json({
      success: true,
      data: report
    });
  } catch (error) {
    console.error('Error fetching inventory valuation:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch inventory valuation',
      error: error.message
    });
  }
};

// Export reports
exports.exportSalesReports = async (req, res) => {
  try {
    const { 
      period = 'weekly', 
      format = 'csv',
      startDate, 
      endDate, 
      category 
    } = req.query;
    
    // Get report data
    const reports = await Report.getSalesReports({
      period,
      startDate,
      endDate,
      category
    });
    
    // Handle different export formats
    if (format.toLowerCase() === 'csv') {
      // Convert to CSV
      const csvStringifier = createObjectCsvStringifier({
        header: [
          { id: 'period', title: 'Period' },
          { id: 'totalRevenue', title: 'Total Revenue' },
          { id: 'totalCost', title: 'Total Cost' },
          { id: 'totalProfit', title: 'Total Profit' },
          { id: 'orderCount', title: 'Order Count' },
          { id: 'marginPercentage', title: 'Margin %' }
        ]
      });
      
      // Prepare data with calculated fields
      const records = reports.map(report => ({
        ...report,
        marginPercentage: report.totalRevenue > 0 
          ? ((report.totalProfit / report.totalRevenue) * 100).toFixed(2) 
          : 0
      }));
      
      const csvData = csvStringifier.getHeaderString() + csvStringifier.stringifyRecords(records);
      
      // Set headers for CSV download
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=sales_report_${period}_${new Date().toISOString().split('T')[0]}.csv`);
      
      // Send CSV data
      return res.send(csvData);
    } else if (format.toLowerCase() === 'json') {
      // Simply send JSON
      return res.status(200).json({
        success: true,
        data: reports,
        exportTime: new Date()
      });
    } else {
      // Unsupported format
      return res.status(400).json({
        success: false,
        message: `Unsupported export format: ${format}`
      });
    }
  } catch (error) {
    console.error('Error exporting reports:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to export reports',
      error: error.message
    });
  }
};

// Get dashboard data
exports.getDashboardData = async (req, res) => {
  try {
    // Get current date for calculations
    const today = new Date();
    const lastMonth = new Date(today);
    lastMonth.setMonth(lastMonth.getMonth() - 1);
    
    const lastMonthStart = new Date(lastMonth.getFullYear(), lastMonth.getMonth(), 1);
    const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0);
    
    const currentMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    
    // Get sales for current month
    const currentMonthSales = await Report.aggregate([
      { 
        $match: { 
          date: { $gte: currentMonthStart, $lte: today } 
        } 
      },
      {
        $group: {
          _id: null,
          revenue: { $sum: "$totalRevenue" },
          profit: { $sum: "$totalProfit" },
          orders: { $sum: 1 }
        }
      }
    ]);
    
    // Get sales for last month
    const lastMonthSales = await Report.aggregate([
      { 
        $match: { 
          date: { $gte: lastMonthStart, $lte: lastMonthEnd } 
        } 
      },
      {
        $group: {
          _id: null,
          revenue: { $sum: "$totalRevenue" },
          profit: { $sum: "$totalProfit" },
          orders: { $sum: 1 }
        }
      }
    ]);
    
    // Get unique customers (using unique user IDs from reports)
    const currentMonthCustomers = await Report.distinct('user', { 
      date: { $gte: currentMonthStart, $lte: today } 
    });
    
    const lastMonthCustomers = await Report.distinct('user', { 
      date: { $gte: lastMonthStart, $lte: lastMonthEnd } 
    });
    
    // Get monthly revenue data for chart (past 9 months)
    const nineMonthsAgo = new Date(today);
    nineMonthsAgo.setMonth(today.getMonth() - 8); // 9 months including current
    
    const monthlyRevenueData = await Report.aggregate([
      {
        $match: {
          date: { $gte: nineMonthsAgo }
        }
      },
      {
        $group: {
          _id: { 
            year: { $year: "$date" },
            month: { $month: "$date" }
          },
          revenue: { $sum: "$totalRevenue" },
          profit: { $sum: "$totalProfit" }
        }
      },
      {
        $sort: { "_id.year": 1, "_id.month": 1 }
      }
    ]);
    
    // Get top selling products
    const topSellingProducts = await Report.aggregate([
      {
        $match: {
          date: { $gte: lastMonthStart }
        }
      },
      { $unwind: "$items" },
      {
        $group: {
          _id: {
            productId: "$items.productId",
            productName: "$items.productName"
          },
          quantity: { $sum: "$items.quantity" },
          amount: { $sum: "$items.revenue" },
          lastSaleDate: { $max: "$date" }
        }
      },
      { $sort: { amount: -1 } },
      { $limit: 5 },
      {
        $project: {
          _id: 0,
          name: "$_id.productName",
          productId: "$_id.productId",
          quantity: 1,
          amount: 1,
          date: { $dateToString: { format: "%d %B %Y", date: "$lastSaleDate" } }
        }
      }
    ]);
    
    // Get out of stock products
    const outOfStockProducts = await Product.find(
      { quantity: 0 },
      { 
        name: 1, 
        productID: 1,
        sellingPrice: 1,
        supplierName: 1,
        updatedAt: 1 
      }
    ).sort({ updatedAt: -1 }).limit(4);
    
    // Format the out of stock products
    const formattedOutOfStock = outOfStockProducts.map(product => ({
      id: product._id,
      name: product.name,
      sku: product.productID,
      lastStocked: product.updatedAt ? new Date(product.updatedAt).toLocaleDateString('en-US', {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      }) : 'Unknown',
      price: product.sellingPrice,
      supplier: product.supplierName || 'Unknown'
    }));
    
    // Calculate month-over-month growth rates
    const currentRevenue = currentMonthSales.length > 0 ? currentMonthSales[0].revenue : 0;
    const lastRevenue = lastMonthSales.length > 0 ? lastMonthSales[0].revenue : 0;
    const revenueGrowth = lastRevenue > 0 ? ((currentRevenue - lastRevenue) / lastRevenue) * 100 : 0;
    
    const currentProfit = currentMonthSales.length > 0 ? currentMonthSales[0].profit : 0;
    const lastProfit = lastMonthSales.length > 0 ? lastMonthSales[0].profit : 0;
    const profitGrowth = lastProfit > 0 ? ((currentProfit - lastProfit) / lastProfit) * 100 : 0;
    
    const currentOrders = currentMonthSales.length > 0 ? currentMonthSales[0].orders : 0;
    const lastOrders = lastMonthSales.length > 0 ? lastMonthSales[0].orders : 0;
    const ordersGrowth = lastOrders > 0 ? ((currentOrders - lastOrders) / lastOrders) * 100 : 0;
    
    const currentCustomers = currentMonthCustomers.length;
    const lastCustomers = lastMonthCustomers.length;
    const customersGrowth = lastCustomers > 0 ? ((currentCustomers - lastCustomers) / lastCustomers) * 100 : 0;
    
    // Format monthly data for chart
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const formattedMonthlyData = monthlyRevenueData.map(item => ({
      name: monthNames[item._id.month - 1],
      Revenue: item.revenue,
      Profit: item.profit
    }));
    
    // Calculate overall growth percentage (using profit as benchmark)
    const totalGrowth = {
      percentage: profitGrowth,
      growthChange: profitGrowth - (lastProfit > 0 ? 0 : profitGrowth), // Simplified for example
      period: "Since last month"
    };
    
    // Build final dashboard data object
    const dashboardData = {
      date: new Date().toLocaleDateString('en-US', {
        month: '2-digit',
        day: '2-digit',
        year: 'numeric'
      }),
      customers: {
        count: currentCustomers,
        growthPercentage: parseFloat(customersGrowth.toFixed(2)),
        period: "Since last month"
      },
      orders: {
        count: currentOrders,
        growthPercentage: parseFloat(ordersGrowth.toFixed(2)),
        period: "Since last month"
      },
      revenue: {
        current: Math.round(currentRevenue),
        target: Math.round(currentRevenue * 1.25), // Example target: 25% above current
        monthlyData: formattedMonthlyData
      },
      earnings: {
        amount: Math.round(currentProfit),
        growthPercentage: parseFloat(profitGrowth.toFixed(2)),
        period: "Since last month"
      },
      growth: totalGrowth,
      topSellingProducts: topSellingProducts.map(product => ({
        name: product.name,
        date: product.date,
        price: parseFloat(product.amount / product.quantity).toFixed(2),
        quantity: product.quantity,
        amount: parseFloat(product.amount.toFixed(2))
      })),
      outOfStockProducts: formattedOutOfStock,
      totalSales: parseFloat((currentRevenue + lastRevenue) / 2).toFixed(2)
    };
    
    res.status(200).json({
      success: true,
      data: dashboardData
    });
  } catch (error) {
    console.error('Error fetching dashboard data:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch dashboard data',
      error: error.message
    });
  }
};

exports.deleteAllReports = async (req, res) => {
  try {

    
    // Delete all reports from the database
    const result = await Report.deleteMany({});
    
    res.status(200).json({
      success: true,
      message: `All reports deleted successfully. ${result.deletedCount} reports removed.`,
      deletedCount: result.deletedCount
    });
  } catch (error) {
    console.error('Error deleting all reports:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete all reports',
      error: error.message
    });
  }
};

exports.deleteReport = async (req, res) => {
  try {
    const { id } = req.params;
    
    
    if (id === 'all') {
      const result = await Report.deleteMany({});
      
      return res.status(200).json({
        success: true,
        message: `All reports deleted successfully. ${result.deletedCount} reports removed.`,
        deletedCount: result.deletedCount
      });
    } 
    
    // Regular ID validation for normal case
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid report ID format'
      });
    }
    
    // Continue with normal delete logic
    const report = await Report.findById(id);
    
    if (!report) {
      return res.status(404).json({
        success: false,
        message: 'Report not found'
      });
    }
    
    await Report.findByIdAndDelete(id);
  
    
    res.status(200).json({
      success: true,
      message: 'Report deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting report:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete report',
      error: error.message
    });
  }
};
// Delete multiple reports by date range
exports.deleteReports = async (req, res) => {
  try {
    const { startDate, endDate, category } = req.body;
    
    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: 'Start date and end date are required'
      });
    }
    
    // Create query filter
    const filter = {
      date: { 
        $gte: new Date(startDate), 
        $lte: new Date(endDate) 
      }
    };
    
    // Add category filter if provided
    if (category) {
      filter.category = category;
    }
    
    // Delete the matching reports
    const result = await Report.deleteMany(filter);
    
    res.status(200).json({
      success: true,
      message: `${result.deletedCount} reports deleted successfully`
    });
  } catch (error) {
    console.error('Error deleting reports:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete reports',
      error: error.message
    });
  }
};

// Reset dashboard data
exports.resetDashboardData = async (req, res) => {
  try {
    
    const today = new Date();
    const currentMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    
    const result = await Report.deleteMany({
      date: { $gte: currentMonthStart }
    });
    
    res.status(200).json({
      success: true,
      message: 'Dashboard data has been reset successfully',
      deletedReports: result.deletedCount
    });
  } catch (error) {
    console.error('Error resetting dashboard data:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reset dashboard data',
      error: error.message
    });
  }
};