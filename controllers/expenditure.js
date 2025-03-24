const Expenditure = require('../models/expenditure');
const mongoose = require('mongoose');


const roundCurrency = (value) => Math.round(value);

exports.createExpenditure = async (req, res) => {
  try {
    const { 
      amount, 
      description, 
      employeeName, 
      category, 
      notes,
      employeeId 
    } = req.body;

    // Validate input
    if (!amount || !description || !employeeName || !category) {
      return res.status(400).json({ 
        success: false, 
        message: 'Missing required fields: amount, description, employeeName, and category are required.' 
      });
    }

    // Create new expenditure object
    const expenditure = new Expenditure({
      amount,
      description,
      employeeName,
      employeeId: employeeId || req.user._id, 
      category,
      notes: notes || ''
    });

    // Automatically approve if amount is less than $100
    if (amount < 100) {
      expenditure.status = 'approved';
      expenditure.approvedBy = req.user._id;
      expenditure.approvalDate = new Date();
    } else {
      expenditure.status = 'pending';
    }

    // Save the expenditure
    await expenditure.save();

    return res.status(201).json({
      success: true,
      message: amount < 100 
        ? 'Expenditure created and automatically approved' 
        : 'Expenditure created successfully',
      data: expenditure
    });
  } catch (error) {
    console.error('Error creating expenditure:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

exports.getAllExpenditures = async (req, res) => {
  try {
    const { 
      startDate, 
      endDate, 
      status, 
      category, 
      employeeId,
      page = 1,
      limit = 10
    } = req.query;


    const query = {};

    if (startDate || endDate) {
      query.date = {};
      if (startDate) {
        const parsedStartDate = new Date(startDate);
        if (!isNaN(parsedStartDate.getTime())) {
          query.date.$gte = parsedStartDate;
        } else {
        }
      }
      if (endDate) {
        const parsedEndDate = new Date(endDate);
        if (!isNaN(parsedEndDate.getTime())) {
          // Add one day to include the end date fully
          parsedEndDate.setDate(parsedEndDate.getDate() + 1);
          parsedEndDate.setMilliseconds(parsedEndDate.getMilliseconds() - 1);
          query.date.$lte = parsedEndDate;
        } else {
        }
      }
      
      if (Object.keys(query.date).length === 0) {
        delete query.date;
      }
    }

    if (status) query.status = status;
    if (category) query.category = category;
    
    if (!req.user.isAdmin) {
      query.employeeId = req.user._id;
    } else if (employeeId && mongoose.Types.ObjectId.isValid(employeeId)) {
      query.employeeId = new mongoose.Types.ObjectId(employeeId);
    }
    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 10;
    const skip = (pageNum - 1) * limitNum;

    // Get total count for pagination
    const totalCount = await Expenditure.countDocuments(query);

    // Get expenditures
    const expenditures = await Expenditure.find(query)
      .sort({ date: -1 })
      .skip(skip)
      .limit(limitNum)
      .populate('employeeId', 'name email')
      .populate('approvedBy', 'name email');

    return res.status(200).json({
      success: true,
      count: expenditures.length,
      totalCount,
      totalPages: Math.ceil(totalCount / limitNum),
      currentPage: pageNum,
      data: expenditures
    });
  } catch (error) {
    console.error('Error fetching expenditures:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

exports.getExpenditureById = async (req, res) => {
  try {
    const { id } = req.params;

    const expenditure = await Expenditure.findById(id)
      .populate('employeeId', 'name email')
      .populate('approvedBy', 'name email');

    if (!expenditure) {
      return res.status(404).json({
        success: false,
        message: 'Expenditure not found'
      });
    }

    return res.status(200).json({
      success: true,
      data: expenditure
    });
  } catch (error) {
    console.error('Error fetching expenditure:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

exports.updateExpenditure = async (req, res) => {
  try {
    const { id } = req.params;
    const { amount, description, category, notes, status } = req.body;

    // Find the expenditure
    const expenditure = await Expenditure.findById(id);

    if (!expenditure) {
      return res.status(404).json({
        success: false,
        message: 'Expenditure not found'
      });
    }

    // Check if the user is authorized to update
    // Only the creator or an admin can update
    if (
      expenditure.employeeId.toString() !== req.user._id.toString() && 
      !req.user.isAdmin
    ) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to update this expenditure'
      });
    }

    // Track if amount changed from ≥100 to <100 or vice versa
    const wasOver100 = expenditure.amount >= 100;
    const isNowOver100 = amount ? amount >= 100 : wasOver100;
    const amountStatusChange = wasOver100 !== isNowOver100;

    // Update the expenditure with new values
    if (amount) expenditure.amount = amount;
    if (description) expenditure.description = description;
    if (category) expenditure.category = category;
    if (notes) expenditure.notes = notes;

    // Handle automatic approval if amount changed to <100
    if (amountStatusChange) {
      if (!isNowOver100 && expenditure.status === 'pending') {
        // Auto-approve if amount changed to <100
        expenditure.status = 'approved';
        expenditure.approvedBy = req.user._id;
        expenditure.approvalDate = new Date();
      } else if (isNowOver100 && expenditure.status === 'approved' && 
                !expenditure.manuallyApproved) {
        // Reset to pending if amount changed to ≥100 and was auto-approved
        expenditure.status = 'pending';
        expenditure.approvedBy = null;
        expenditure.approvalDate = null;
      }
    } else if (status && status !== expenditure.status) {
      // Status changes need to be handled specially
      if (status === 'approved') {
        // Only admin can approve
        if (!req.user.isAdmin) {
          return res.status(403).json({
            success: false,
            message: 'Only administrators can approve expenditures'
          });
        }

        expenditure.status = status;
        expenditure.approvedBy = req.user._id;
        expenditure.approvalDate = new Date();
        
        // Mark as manually approved
        expenditure.manuallyApproved = true;
      } else {
        // For other status changes
        expenditure.status = status;
      }
    }

    await expenditure.save();

    return res.status(200).json({
      success: true,
      message: 'Expenditure updated successfully',
      data: expenditure
    });
  } catch (error) {
    console.error('Error updating expenditure:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

exports.deleteExpenditure = async (req, res) => {
  try {
    const { id } = req.params;

    // Find the expenditure
    const expenditure = await Expenditure.findById(id);

    if (!expenditure) {
      return res.status(404).json({
        success: false,
        message: 'Expenditure not found'
      });
    }

  

    if (!req.user || (!req.user.id && !req.user._id)) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    const userId = (req.user.id || req.user._id).toString();
    
    const expEmployeeId = expenditure.employeeId ? expenditure.employeeId.toString() : null;

    if (expEmployeeId && expEmployeeId !== userId && !req.user.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to delete this expenditure'
      });
    }

    await Expenditure.findByIdAndDelete(id);

    return res.status(200).json({
      success: true,
      message: 'Expenditure deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting expenditure:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

exports.approveExpenditure = async (req, res) => {
  try {
    const { id } = req.params;

    // Only admin can approve
    if (!req.user.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Only administrators can approve expenditures'
      });
    }

    const expenditure = await Expenditure.findById(id);

    if (!expenditure) {
      return res.status(404).json({
        success: false,
        message: 'Expenditure not found'
      });
    }

    if (expenditure.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: `Expenditure is already ${expenditure.status}`
      });
    }

    expenditure.status = 'approved';
    expenditure.approvedBy = req.user._id;
    expenditure.approvalDate = new Date();
    expenditure.manuallyApproved = true;

    await expenditure.save();
    
    const Report = mongoose.model('Report');
    await Report.addExpenditureToReport(expenditure, req.user._id);

    return res.status(200).json({
      success: true,
      message: 'Expenditure approved successfully',
      data: expenditure
    });
  } catch (error) {
    console.error('Error approving expenditure:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

exports.getExpenditureStatistics = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    // Only get total for approved expenditures
    const totalAmount = roundCurrency(await Expenditure.getTotalExpenditures(startDate, endDate));
    
    const rawCategorySummary = await Expenditure.getExpendituresByCategory(startDate, endDate);
    
    const categorySummary = rawCategorySummary.map(category => ({
      ...category,
      totalAmount: roundCurrency(category.totalAmount)
    }));
    
    const categoriesTotal = categorySummary.reduce((sum, category) => sum + category.totalAmount, 0);
    
    if (Math.abs(totalAmount - categoriesTotal) > 1) {
      console.warn("WARNING: Total amount", totalAmount, "doesn't match sum of categories", categoriesTotal);
    }
    
    const rawEmployeeSummary = await Expenditure.getExpendituresByEmployee(startDate, endDate);
    const employeeSummary = rawEmployeeSummary.map(employee => ({
      ...employee,
      totalAmount: roundCurrency(employee.totalAmount)
    }));
    
    // Get pending approvals
    const pendingQuery = { status: 'pending' };
    if (startDate || endDate) {
      pendingQuery.date = {};
      if (startDate) pendingQuery.date.$gte = new Date(startDate);
      if (endDate) {
        const endDateObj = new Date(endDate);
        endDateObj.setDate(endDateObj.getDate() + 1);
        endDateObj.setMilliseconds(endDateObj.getMilliseconds() - 1);
        pendingQuery.date.$lte = endDateObj;
      }
    }
    
    const pendingCount = await Expenditure.countDocuments(pendingQuery);
    
    const pendingExpenditures = await Expenditure.find(pendingQuery)
      .sort({ date: -1 })
      .limit(10)
      .populate('employeeId', 'name email');
    
    const roundedPendingExpenditures = pendingExpenditures.map(exp => {
      const expObj = exp.toObject();
      expObj.amount = roundCurrency(expObj.amount);
      return expObj;
    });
    
    const pendingAmount = roundCurrency(
      await Expenditure.aggregate([
        { $match: pendingQuery },
        { $group: { _id: null, total: { $sum: "$amount" } } }
      ]).then(result => result.length > 0 ? result[0].total : 0)
    );
    
    const rawMonthlyData = await getMonthlyData(startDate, endDate);
    const monthlyData = rawMonthlyData.map(month => ({
      ...month,
      totalAmount: roundCurrency(month.totalAmount)
    }));

    const responseData = {
      totalAmount,
      pendingAmount,
      categorySummary,
      employeeSummary,
      pendingCount,
      pendingExpenditures: roundedPendingExpenditures,
      monthlyData
    };
    
    return res.status(200).json({
      success: true,
      data: responseData
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

async function getMonthlyData(startDate, endDate) {
  let start = startDate ? new Date(startDate) : new Date();
  start.setFullYear(start.getFullYear() - 1);
  start.setDate(1); 
  start.setHours(0, 0, 0, 0);
  
  let end = endDate ? new Date(endDate) : new Date();
  end.setDate(end.getDate() + 1); 
  end.setHours(0, 0, 0, 0);
  
  const months = [];
  let currentDate = new Date(start);
  
  while (currentDate < end) {
    const monthStart = new Date(currentDate);
    
    currentDate.setMonth(currentDate.getMonth() + 1);
    
    const monthEnd = new Date(currentDate);
    monthEnd.setMilliseconds(monthEnd.getMilliseconds() - 1);
    
    if (monthEnd <= end) {
      months.push({
        start: new Date(monthStart),
        end: new Date(monthEnd),
        label: monthStart.toLocaleString('default', { month: 'short', year: 'numeric' })
      });
    }
  }
  
  const monthlyData = [];
  
  for (const month of months) {
    const result = await Expenditure.aggregate([
      {
        $match: {
          date: { $gte: month.start, $lte: month.end },
          status: { $ne: 'rejected' }
        }
      },
      {
        $group: {
          _id: null,
          totalAmount: { $sum: "$amount" },
          count: { $sum: 1 }
        }
      },
      {
        $project: {
          _id: 0,
          totalAmount: { $round: ["$totalAmount", 0] },
          count: 1
        }
      }
    ]);
    
    monthlyData.push({
      month: month.label,
      totalAmount: result.length > 0 ? result[0].totalAmount : 0,
      count: result.length > 0 ? result[0].count : 0
    });
  }
  
  return monthlyData;
}