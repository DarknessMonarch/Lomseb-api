const Expenditure = require('../models/expenditure');
const mongoose = require('mongoose');

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

    // Apply filters
    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = new Date(startDate);
      if (endDate) query.date.$lte = new Date(endDate);
    }

    if (status) query.status = status;
    if (category) query.category = category;
    if (employeeId) query.employeeId = employeeId;

    // Pagination
    const skip = (page - 1) * limit;

    // Get total count for pagination
    const totalCount = await Expenditure.countDocuments(query);

    // Get expenditures
    const expenditures = await Expenditure.find(query)
      .sort({ date: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate('employeeId', 'name email')
      .populate('approvedBy', 'name email');

    return res.status(200).json({
      success: true,
      count: expenditures.length,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
      currentPage: parseInt(page),
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

    // Update the expenditure
    expenditure.status = 'approved';
    expenditure.approvedBy = req.user._id;
    expenditure.approvalDate = new Date();
    expenditure.manuallyApproved = true;

    await expenditure.save();

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

    const totalAmount = await Expenditure.getTotalExpenditures(startDate, endDate);
    
    const categorySummary = await Expenditure.getExpendituresByCategory(startDate, endDate);
    
    const employeeSummary = await Expenditure.getExpendituresByEmployee(startDate, endDate);
    
    const pendingCount = await Expenditure.countDocuments({ 
      status: 'pending'
    });
    
    const pendingExpenditures = await Expenditure.find({ status: 'pending' })
      .sort({ date: -1 })
      .limit(10)
      .populate('employeeId', 'name email');
    
    const autoApprovedCount = await Expenditure.countDocuments({
      status: 'approved',
      amount: { $lt: 100 },
      manuallyApproved: { $ne: true }
    });

    return res.status(200).json({
      success: true,
      data: {
        totalAmount,
        categorySummary,
        employeeSummary,
        pendingCount,
        pendingExpenditures, 
        autoApprovedCount
      }
    });
  } catch (error) {
    console.error('Error fetching expenditure statistics:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};