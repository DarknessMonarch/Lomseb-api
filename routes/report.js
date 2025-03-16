const express = require('express');
const router = express.Router();
const { protect, authenticateAdmin } = require('../middleware/auth');
const reportController = require('../controllers/report');

router.use(protect);
router.use(authenticateAdmin);

router.get('/sales', reportController.getSalesReports);
router.get('/products', reportController.getProductReports);
router.get('/categories', reportController.getCategoryReports);
router.get('/payment-methods', reportController.getPaymentMethodReports);
router.get('/inventory-valuation', reportController.getInventoryValuation);
router.get('/export', reportController.exportSalesReports);
router.get('/dashboard', reportController.getDashboardData);
router.delete('/', reportController.deleteReports);
router.delete('/:id', reportController.deleteReport);
router.delete('/dashboard/reset', reportController.resetDashboardData);
router.delete('/all', reportController.deleteAllReports);

module.exports = router;