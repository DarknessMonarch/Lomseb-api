// scripts/fixDebtRecords.js
/**
 * This script fixes all existing debt records by recalculating their statuses
 * Run it once after updating the debt controller
 */

const mongoose = require('mongoose');
const Debt = require('../models/debt');
const config = require('../config/db');

// Connect to database
mongoose.connect(config.mongoURI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('MongoDB connected'))
.catch(err => {
  console.error('Database connection error:', err);
  process.exit(1);
});

const fixDebtRecords = async () => {
  try {
    console.log('Starting debt records fix...');
    
    // Get all debt records
    const allDebts = await Debt.find({});
    console.log(`Found ${allDebts.length} total debt records`);
    
    const today = new Date();
    let updatedCount = 0;
    let alreadyCorrectCount = 0;
    
    for (const debt of allDebts) {
      let newStatus = debt.status; // Start with current status
      
      // Recalculate status based on payment and due date
      if (debt.remainingAmount <= 0) {
        newStatus = 'paid';
      } else if (debt.dueDate < today) {
        newStatus = 'overdue';
      } else {
        newStatus = 'current';
      }
      
      // Only update if status needs to change
      if (debt.status !== newStatus) {
        console.log(`Updating debt ${debt._id}: ${debt.status} -> ${newStatus}`);
        debt.status = newStatus;
        await debt.save();
        updatedCount++;
      } else {
        alreadyCorrectCount++;
      }
    }
    
    console.log('Debt records fix completed:');
    console.log(`- Updated: ${updatedCount} records`);
    console.log(`- Already correct: ${alreadyCorrectCount} records`);
    console.log(`- Total: ${allDebts.length} records`);
    
    // Disconnect from database
    await mongoose.disconnect();
    console.log('Database disconnected');
    
  } catch (error) {
    console.error('Error fixing debt records:', error);
  }
};

fixDebtRecords();