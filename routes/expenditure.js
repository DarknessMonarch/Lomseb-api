const express = require('express');
const router = express.Router();
const { protect, authenticateAdmin } = require('../middleware/auth');
const expenditureController = require('../controllers/expenditure');

router.use(protect);

router.post('/', expenditureController.createExpenditure);
router.get('/', expenditureController.getAllExpenditures);
router.get('/statistics', expenditureController.getExpenditureStatistics);
router.get('/:id', expenditureController.getExpenditureById);
router.put('/:id', expenditureController.updateExpenditure);
router.delete('/:id', expenditureController.deleteExpenditure);

router.patch('/:id/approve', authenticateAdmin, expenditureController.approveExpenditure);

module.exports = router;