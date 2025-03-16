const Cart = require('../models/cart');
const { sendOrderConfirmationEmail } = require('../helpers/email');
const Product = require('../models/product');
const debtController = require('../controllers/debt');
const Report = require('../models/report');

// Get user's active cart
exports.getCart = async (req, res) => {
  try {
    // Get user ID from auth middleware
    const userId = req.user.id;

    // Find or create cart
    let cart = await Cart.findOne({
      user: userId,
      status: 'active'
    }).populate('items.product', 'name productID quantity image');

    if (!cart) {
      cart = new Cart({ user: userId, items: [] });
      await cart.save();
    }

    let hasUpdates = false;
    for (let i = cart.items.length - 1; i >= 0; i--) {
      const item = cart.items[i];
      const product = item.product;

      if (!product || product.quantity === 0) {
        cart.items.splice(i, 1);
        hasUpdates = true;
        continue;
      }

      // Adjust quantity if greater than available
      if (item.quantity > product.quantity) {
        item.quantity = product.quantity;
        hasUpdates = true;
      }
    }

    // Save cart if there were updates
    if (hasUpdates) {
      await cart.save();
    }

    res.status(200).json({
      success: true,
      data: {
        _id: cart._id,
        items: cart.items,
        itemCount: cart.itemCount,
        subtotal: cart.subtotal,
        discount: cart.discount,
        total: cart.total,
        note: cart.note,
        couponCode: cart.couponCode
      }
    });
  } catch (error) {
    console.error('Error fetching cart:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch cart',
      error: error.message
    });
  }
};

// Add item to cart
exports.addToCart = async (req, res) => {
  try {
    const userId = req.user.id;
    const { productId, quantity = 1 } = req.body;

    if (!productId) {
      return res.status(400).json({
        success: false,
        message: 'Product ID is required'
      });
    }

    // Validate product exists and has sufficient quantity
    const product = await Product.findById(productId);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    if (product.quantity < quantity) {
      return res.status(400).json({
        success: false,
        message: `Only ${product.quantity} units available`,
        availableQuantity: product.quantity
      });
    }

    // Find or create cart
    let cart = await Cart.findOne({
      user: userId,
      status: 'active'
    });

    if (!cart) {
      cart = new Cart({ user: userId, items: [] });
    }

    // Add item to cart
    await cart.addItem(productId, parseInt(quantity));

    // Return updated cart
    res.status(200).json({
      success: true,
      message: 'Product added to cart',
      data: {
        _id: cart._id,
        items: cart.items,
        itemCount: cart.itemCount,
        subtotal: cart.subtotal,
        discount: cart.discount,
        total: cart.total
      }
    });
  } catch (error) {
    console.error('Error adding to cart:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add item to cart',
      error: error.message
    });
  }
};

exports.checkout = async (req, res) => {
  try {
    const userId = req.user.id;
    const { paymentMethod, customerInfo, paymentStatus, amountPaid, remainingBalance } = req.body;

    // Find active cart
    const cart = await Cart.findOne({
      user: userId,
      status: 'active'
    }).populate('items.product');

    if (!cart) {
      return res.status(404).json({
        success: false,
        message: 'Cart not found'
      });
    }

    if (cart.items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot checkout an empty cart'
      });
    }

    // Verify all items are still available
    let unavailableItems = [];
    for (const item of cart.items) {
      const product = await Product.findById(item.product);
      if (!product || product.quantity < item.quantity) {
        unavailableItems.push({
          name: item.name,
          requested: item.quantity,
          available: product ? product.quantity : 0
        });
      }
    }

    if (unavailableItems.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Some items are no longer available',
        unavailableItems
      });
    }

    // Ensure payment values are proper numbers
    const paidAmount = parseFloat(amountPaid) || 0;

    // Calculate remaining balance if not provided, or use the provided value
    const remainingBal =
      remainingBalance !== undefined ?
        parseFloat(remainingBalance) :
        Math.max(0, cart.total - paidAmount);

    // Debug logging
    console.log('Payment values:', {
      paidAmount,
      remainingBal,
      total: cart.total,
      condition: remainingBal > 0
    });

    // Determine payment status if not provided
    let paymentStat = paymentStatus || 'paid';

    if (!paymentStatus) {
      if (paidAmount <= 0) {
        paymentStat = 'unpaid';
      } else if (paidAmount < cart.total) {
        paymentStat = 'partial';
      }
    }

    // Update cart with payment information
    cart.amountPaid = paidAmount;
    cart.remainingBalance = remainingBal;
    cart.paymentStatus = paymentStat;

    // Generate report data
    const reportItems = [];
    let totalCost = 0;
    let totalRevenue = cart.total;
    let totalProfit = 0;
    const categories = {};

    // Prepare data for email - format items for the email template
    const emailItems = [];

    // Update product quantities and collect report data
    for (const item of cart.items) {
      const product = await Product.findById(item.product);
      if (product) {
        // Update product quantity
        product.quantity -= item.quantity;
        await product.save();

        // Calculate item profit
        const itemCost = product.buyingPrice * item.quantity;
        const itemRevenue = item.price * item.quantity;
        const itemProfit = itemRevenue - itemCost;

        // Add to report data
        reportItems.push({
          productId: product._id,
          productName: product.name,
          productID: product.productID,
          category: product.category,
          quantity: item.quantity,
          unit: product.unit,
          buyingPrice: product.buyingPrice,
          sellingPrice: product.sellingPrice,
          cost: itemCost,
          revenue: itemRevenue,
          profit: itemProfit
        });

        // Format for email
        emailItems.push({
          name: product.name,
          quantity: item.quantity,
          price: item.price,
          itemTotal: item.price * item.quantity
        });

        // Update category stats
        if (!categories[product.category]) {
          categories[product.category] = {
            count: 0,
            revenue: 0,
            profit: 0
          };
        }
        categories[product.category].count += item.quantity;
        categories[product.category].revenue += itemRevenue;
        categories[product.category].profit += itemProfit;

        // Update total cost and profit
        totalCost += itemCost;
        totalProfit += itemProfit;
      }
    }

    // Create report with payment information included
    const report = new Report({
      date: new Date(),
      items: reportItems,
      totalRevenue,
      totalCost,
      totalProfit,
      categories,
      paymentMethod,
      amountPaid: paidAmount,
      remainingBalance: remainingBal,
      paymentStatus: paymentStat,
      user: userId,
      customerInfo: customerInfo // Store customer info in the report
    });

    await report.save();

    let debtRecord = null;

    // IMPORTANT: Create debt record if there's any remaining balance
    // Whether partial payment or full payment with remainder
    if (remainingBal > 0) {
      console.log('Creating debt record with:', {
        userId,
        reportId: report._id,
        total: cart.total,
        paidAmount,
        remainingBal
      });

      try {
        // Ensure the createDebtRecord function properly handles the debt
        debtRecord = await debtController.createDebtRecord(
          userId,
          report._id,
          cart.total,
          paidAmount,
          remainingBal
        );

        if (!debtRecord) {
          throw new Error('Debt record creation failed without error');
        }

        console.log('Debt record created:', debtRecord);
      } catch (error) {
        console.error('Failed to create debt record:', error);
      }
    }

    // Update cart status
    cart.status = 'converted';
    await cart.save();

    const user = await req.user;

    if (user.email && customerInfo && customerInfo.name) {
      try {
        const orderDetails = {
          reportId: report._id,
          saleId: report._id,
          date: new Date(),
          items: emailItems,
          subtotal: cart.subtotal,
          discount: cart.discount,
          total: cart.total,
          customerInfo: customerInfo,
          paymentMethod: paymentMethod,
          transactionId: report._id,
          debtId: debtRecord ? debtRecord._id : null,
          dueDate: debtRecord ? debtRecord.dueDate : null,
          amountPaid: paidAmount,
          remainingBalance: remainingBal,
          paymentStatus: paymentStat
        };
        
        await sendOrderConfirmationEmail(
          user.email,
          customerInfo?.name || user.username,
          orderDetails  
        );
      } catch (emailError) {
        console.error('Error sending confirmation email:', emailError);
      }
    } else {
      console.warn('Skipping email confirmation - missing required customer information');
    }

    res.status(200).json({
      success: true,
      message: 'Checkout completed successfully',
      orderId: report._id,
      data: {
        reportId: report._id,
        items: cart.items,
        itemCount: cart.itemCount,
        subtotal: cart.subtotal,
        discount: cart.discount,
        total: cart.total,
        amountPaid: paidAmount,
        remainingBalance: remainingBal,
        paymentStatus: paymentStat,
        totalProfit: totalProfit,
        categories: categories,
        debtRecord: debtRecord ? {
          debtId: debtRecord._id,
          dueDate: debtRecord.dueDate,
          status: debtRecord.status
        } : null
      }
    });
  } catch (error) {
    console.error('Error during checkout:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to complete checkout',
      error: error.message
    });
  }
};


exports.updateCartItem = async (req, res) => {
  try {
    const userId = req.user.id;
    const { itemId } = req.params;
    const { quantity } = req.body;

    if (!quantity || quantity < 1) {
      return res.status(400).json({
        success: false,
        message: 'Valid quantity is required'
      });
    }

    // Find cart
    const cart = await Cart.findOne({
      user: userId,
      status: 'active'
    });

    if (!cart) {
      return res.status(404).json({
        success: false,
        message: 'Cart not found'
      });
    }

    // Update item quantity
    await cart.updateItemQuantity(itemId, parseInt(quantity));

    res.status(200).json({
      success: true,
      message: 'Cart updated successfully',
      data: {
        _id: cart._id,
        items: cart.items,
        itemCount: cart.itemCount,
        subtotal: cart.subtotal,
        discount: cart.discount,
        total: cart.total
      }
    });
  } catch (error) {
    console.error('Error updating cart item:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update cart item',
      error: error.message
    });
  }
};

// Remove item from cart
exports.removeCartItem = async (req, res) => {
  try {
    const userId = req.user.id;
    const { itemId } = req.params;

    // Find cart
    const cart = await Cart.findOne({
      user: userId,
      status: 'active'
    });

    if (!cart) {
      return res.status(404).json({
        success: false,
        message: 'Cart not found'
      });
    }

    // Remove item from cart
    await cart.removeItem(itemId);

    res.status(200).json({
      success: true,
      message: 'Item removed from cart',
      data: {
        _id: cart._id,
        items: cart.items,
        itemCount: cart.itemCount,
        subtotal: cart.subtotal,
        discount: cart.discount,
        total: cart.total
      }
    });
  } catch (error) {
    console.error('Error removing cart item:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to remove item from cart',
      error: error.message
    });
  }
};

// Clear cart
exports.clearCart = async (req, res) => {
  try {
    const userId = req.user.id;

    // Find cart
    const cart = await Cart.findOne({
      user: userId,
      status: 'active'
    });

    if (!cart) {
      return res.status(404).json({
        success: false,
        message: 'Cart not found'
      });
    }

    // Clear cart
    await cart.clearCart();

    res.status(200).json({
      success: true,
      message: 'Cart cleared successfully',
      data: {
        _id: cart._id,
        items: [],
        itemCount: 0,
        subtotal: 0,
        discount: 0,
        total: 0
      }
    });
  } catch (error) {
    console.error('Error clearing cart:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to clear cart',
      error: error.message
    });
  }
};


exports.getAllCarts = async (req, res) => {
  try {
    // Only admins should be able to access this endpoint
    if (!req.user.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized access'
      });
    }

    const {
      status = 'active',
      page = 1,
      limit = 10
    } = req.query;

    // Calculate pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Query carts
    const carts = await Cart.find({ status })
      .populate('user', 'username email')
      .skip(skip)
      .limit(parseInt(limit))
      .sort({ updatedAt: -1 });

    // Get total count
    const total = await Cart.countDocuments({ status });

    res.status(200).json({
      success: true,
      count: carts.length,
      total,
      totalPages: Math.ceil(total / parseInt(limit)),
      currentPage: parseInt(page),
      data: carts
    });
  } catch (error) {
    console.error('Error fetching carts:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch carts',
      error: error.message
    });
  }
};

