const Debt = require('../models/debt');
const Report = require('../models/report');
const { sendDebtReminderEmail } = require('../helpers/email');

exports.createDebtRecord = async (userId, reportId, total, amountPaid, remainingBalance) => {
  try {
    console.log('Inside createDebtRecord function with params:', {
      userId,
      reportId,
      total,
      amountPaid,
      remainingBalance
    });

    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 30);

    // Determine initial status based on payment
    let initialStatus = 'current';
    if (remainingBalance <= 0) {
      initialStatus = 'paid';
    }

    const debt = new Debt({
      user: userId,
      orderId: reportId,
      originalAmount: total,
      amountPaid: amountPaid,
      remainingAmount: remainingBalance,
      dueDate: dueDate,
      status: initialStatus,
      paymentHistory: [{
        amount: amountPaid,
        date: new Date(),
        paymentMethod: 'initial payment',
        notes: 'Payment at checkout'
      }]
    });

    console.log('Debt object created with status:', debt.status);
    const savedDebt = await debt.save();
    console.log('Debt saved successfully:', savedDebt);
    return savedDebt;
  } catch (error) {
    console.error('Error creating debt record:', error);
    throw error;
  }
};

exports.getDebtStatistics = async (req, res) => {
  try {


    const today = new Date();

    // IMPORTANT: Find all debts that are not fully paid
    const activeDebts = await Debt.find({
      status: { $ne: 'paid' },
      remainingAmount: { $gt: 0 } // Double check with this condition
    });

    // Calculate total debt amount from active debts
    const totalDebtAmount = activeDebts.reduce(
      (sum, debt) => sum + debt.remainingAmount, 0
    );

    // Find overdue debts - past due date and not paid
    const overdueDebts = await Debt.find({
      dueDate: { $lt: today },
      status: { $ne: 'paid' },
      remainingAmount: { $gt: 0 }
    });

    // Calculate overdue amount
    const totalOverdueAmount = overdueDebts.reduce(
      (sum, debt) => sum + debt.remainingAmount, 0
    );

    const overduePercentage = totalDebtAmount > 0
      ? parseFloat(((totalOverdueAmount / totalDebtAmount) * 100).toFixed(2))
      : 0;

    res.status(200).json({
      success: true,
      data: {
        totalDebt: totalDebtAmount,
        activeDebtCount: activeDebts.length,
        overdueAmount: totalOverdueAmount,
        overduePercentage: overduePercentage,
        overdueCount: overdueDebts.length,
        debtStatusDistribution: {
          current: activeDebts.length - overdueDebts.length,
          overdue: overdueDebts.length
        }
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch debt statistics',
      error: error.message
    });
  }
};
exports.updateDebtStatuses = async () => {
  try {
    const today = new Date();

    // Find debts that are past due but not marked as overdue
    const debtsToUpdate = await Debt.find({
      dueDate: { $lt: today },
      status: 'current',
      remainingAmount: { $gt: 0 }
    });

    console.log(`Found ${debtsToUpdate.length} debts to mark as overdue`);

    // Update each debt status
    for (const debt of debtsToUpdate) {
      debt.status = 'overdue';
      await debt.save();
    }

    return {
      success: true,
      updatedCount: debtsToUpdate.length
    };
  } catch (error) {
    console.error('Error updating debt statuses:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

exports.getUserDebts = async (req, res) => {
  try {
    const userId = req.user.id;

    const debts = await Debt.find({ user: userId })
      .populate('orderId', 'date totalRevenue')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: debts.length,
      data: debts
    });
  } catch (error) {
    console.error('Error fetching user debts:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch debt records',
      error: error.message
    });
  }
};

// Get a single debt record
exports.getDebtById = async (req, res) => {
  try {
    const { debtId } = req.params;
    const userId = req.user.id;

    const debt = await Debt.findOne({
      _id: debtId,
      user: userId
    }).populate('orderId', 'date totalRevenue items');

    if (!debt) {
      return res.status(404).json({
        success: false,
        message: 'Debt record not found'
      });
    }

    res.status(200).json({
      success: true,
      data: debt
    });
  } catch (error) {
    console.error('Error fetching debt record:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch debt record',
      error: error.message
    });
  }
};

// Make a payment on a debt
exports.makePayment = async (req, res) => {
  try {
    const { debtId } = req.params;
    const { amount, paymentMethod, notes } = req.body;
    const userId = req.user.id;

    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Valid payment amount is required'
      });
    }

    const debt = await Debt.findOne({
      _id: debtId,
      user: userId
    });

    if (!debt) {
      return res.status(404).json({
        success: false,
        message: 'Debt record not found'
      });
    }

    if (debt.status === 'paid') {
      return res.status(400).json({
        success: false,
        message: 'This debt has already been fully paid'
      });
    }

    // Process payment
    try {
      debt.recordPayment(parseFloat(amount), paymentMethod, notes);
      await debt.save();

      // Update corresponding report payment status
      const report = await Report.findById(debt.orderId);
      if (report) {
        report.amountPaid = debt.amountPaid;
        report.remainingBalance = debt.remainingAmount;
        report.paymentStatus = debt.status === 'paid' ? 'paid' : 'partial';
        await report.save();
      }

      res.status(200).json({
        success: true,
        message: 'Payment recorded successfully',
        data: debt
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message
      });
    }
  } catch (error) {
    console.error('Error processing payment:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process payment',
      error: error.message
    });
  }
};

// Admin: Get all debt records
exports.getAllDebts = async (req, res) => {
  try {


    const {
      status,
      page = 1,
      limit = 10,
      sortBy = 'dueDate',
      sortOrder = 'asc'
    } = req.query;

    // Build query
    const query = {};
    if (status) query.status = status;

    // Calculate pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Determine sort direction
    const sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

    const debts = await Debt.find(query)
      .populate('user', 'username email')
      .populate('orderId', 'date')
      .skip(skip)
      .limit(parseInt(limit))
      .sort(sort);

    const total = await Debt.countDocuments(query);

    res.status(200).json({
      success: true,
      count: debts.length,
      total,
      totalPages: Math.ceil(total / parseInt(limit)),
      currentPage: parseInt(page),
      data: debts
    });
  } catch (error) {
    console.error('Error fetching debts:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch debt records',
      error: error.message
    });
  }
};

// Admin: Update debt details
exports.updateDebt = async (req, res) => {
  try {
    // Ensure user is admin
    if (!req.user.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized access'
      });
    }

    const { debtId } = req.params;
    const { dueDate, notes } = req.body;

    const debt = await Debt.findById(debtId);

    if (!debt) {
      return res.status(404).json({
        success: false,
        message: 'Debt record not found'
      });
    }

    // Update fields
    if (dueDate) debt.dueDate = new Date(dueDate);
    if (notes !== undefined) debt.notes = notes;

    await debt.save();

    res.status(200).json({
      success: true,
      message: 'Debt record updated successfully',
      data: debt
    });
  } catch (error) {
    console.error('Error updating debt:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update debt record',
      error: error.message
    });
  }
};

// Send payment reminder
exports.sendReminder = async (req, res) => {
  try {
    // Ensure user is admin
    if (!req.user.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized access'
      });
    }

    const { debtId } = req.params;

    const debt = await Debt.findById(debtId)
      .populate('user', 'email username')
      .populate('orderId');

    if (!debt) {
      return res.status(404).json({
        success: false,
        message: 'Debt record not found'
      });
    }

    // Send reminder email
    try {
      await sendDebtReminderEmail(debt.user.email, {
        username: debt.user.username,
        debtId: debt._id,
        amount: debt.remainingAmount,
        dueDate: debt.dueDate,
        orderId: debt.orderId._id
      });

      res.status(200).json({
        success: true,
        message: 'Payment reminder sent successfully'
      });
    } catch (emailError) {
      console.error('Error sending reminder email:', emailError);
      res.status(500).json({
        success: false,
        message: 'Failed to send reminder email',
        error: emailError.message
      });
    }
  } catch (error) {
    console.error('Error sending reminder:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send reminder',
      error: error.message
    });
  }
};

exports.getOverdueDebtsReport = async (req, res) => {
  try {
    // Ensure user is admin
    if (!req.user.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized access'
      });
    }

    const today = new Date();

    // Find overdue debts with explicit status and balance checks
    const overdueDebts = await Debt.find({
      $or: [
        { status: 'overdue' },
        {
          dueDate: { $lt: today },
          status: { $ne: 'paid' },
          remainingAmount: { $gt: 0 }
        }
      ]
    })
      .populate('user', 'username email')
      .populate('orderId', 'date totalRevenue')
      .sort({ dueDate: 1 });

    // Calculate summary statistics
    const totalOverdueAmount = overdueDebts.reduce(
      (sum, debt) => sum + debt.remainingAmount, 0
    );

    // Group by days overdue for reporting
    const overdueGroups = {
      '1-30': { count: 0, amount: 0 },
      '31-60': { count: 0, amount: 0 },
      '61-90': { count: 0, amount: 0 },
      '90+': { count: 0, amount: 0 }
    };

    overdueDebts.forEach(debt => {
      const daysOverdue = Math.floor((today - debt.dueDate) / (1000 * 60 * 60 * 24));

      if (daysOverdue <= 30) {
        overdueGroups['1-30'].count++;
        overdueGroups['1-30'].amount += debt.remainingAmount;
      } else if (daysOverdue <= 60) {
        overdueGroups['31-60'].count++;
        overdueGroups['31-60'].amount += debt.remainingAmount;
      } else if (daysOverdue <= 90) {
        overdueGroups['61-90'].count++;
        overdueGroups['61-90'].amount += debt.remainingAmount;
      } else {
        overdueGroups['90+'].count++;
        overdueGroups['90+'].amount += debt.remainingAmount;
      }
    });

    res.status(200).json({
      success: true,
      count: overdueDebts.length,
      totalOverdueAmount,
      overdueGroups,
      data: overdueDebts
    });
  } catch (error) {
    console.error('Error fetching overdue debts:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch overdue debts',
      error: error.message
    });
  }
};

exports.deleteAllDebts = async (req, res) => {
  try {
    if (!req.user.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized access'
      });
    }

    const result = await Debt.deleteMany({});

    res.status(200).json({
      success: true,
      message: `Successfully deleted ${result.deletedCount} debt records`,
      deletedCount: result.deletedCount
    });
  } catch (error) {
    console.error('Error deleting debt records:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete debt records',
      error: error.message
    });
  }
};