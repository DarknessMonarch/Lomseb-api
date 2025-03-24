const Cart = require('../models/cart');
const { sendOrderConfirmationEmail } = require('../helpers/email');
const Product = require('../models/product');
const debtController = require('../controllers/debt');
const Report = require('../models/report');

exports.getCart = async (req, res) => {
  try {
    const userId = req.user.id;

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

      if (item.quantity > product.quantity) {
        item.quantity = product.quantity;
        hasUpdates = true;
      }
    }

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
    res.status(500).json({
      success: false,
      message: 'Failed to fetch cart',
      error: error.message
    });
  }
};

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

    let cart = await Cart.findOne({
      user: userId,
      status: 'active'
    });

    if (!cart) {
      cart = new Cart({ user: userId, items: [] });
    }

    await cart.addItem(productId, parseInt(quantity));

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

    const paidAmount = parseFloat(amountPaid) || 0;

    const remainingBal =
      remainingBalance !== undefined ?
        parseFloat(remainingBalance) :
        Math.max(0, cart.total - paidAmount);



    let paymentStat = paymentStatus || 'paid';

    if (!paymentStatus) {
      if (paidAmount <= 0) {
        paymentStat = 'unpaid';
      } else if (paidAmount < cart.total) {
        paymentStat = 'partial';
      }
    }

    cart.amountPaid = paidAmount;
    cart.remainingBalance = remainingBal;
    cart.paymentStatus = paymentStat;

    const reportItems = [];
    let totalCost = 0;
    let totalRevenue = cart.total;
    let totalProfit = 0;
    const categories = {};

    const emailItems = [];

    for (const item of cart.items) {
      const product = await Product.findById(item.product);
      if (product) {
        product.quantity -= item.quantity;
        await product.save();

        const itemCost = product.buyingPrice * item.quantity;
        const itemRevenue = item.price * item.quantity;
        const itemProfit = itemRevenue - itemCost;

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

        emailItems.push({
          name: product.name,
          quantity: item.quantity,
          price: item.price,
          itemTotal: item.price * item.quantity
        });

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

        totalCost += itemCost;
        totalProfit += itemProfit;
      }
    }

    const report = new Report({
      date: new Date(),
      items: reportItems,
      totalRevenue,
      totalCost,
      totalProfit,
      netProfit: totalProfit, 
      categories,
      paymentMethod,
      amountPaid: paidAmount,
      remainingBalance: remainingBal,
      paymentStatus: paymentStat,
      user: userId,
      customerInfo: customerInfo
    });

    await report.save();

    let debtRecord = null;

    if (remainingBal > 0) {

      try {
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

      } catch (error) {
        return res.status(500).json({
          success: false,
          message: 'Failed to create debt record',
          error: error.message
        });
      }
    }

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
        return res.status(500).json({
          success: false,
          message: 'Failed to send confirmation email',
          error: emailError.message
        });
      }
    } else {
      console.warn('No email provided for user:', user.username);      

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

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const carts = await Cart.find({ status })
      .populate('user', 'username email')
      .skip(skip)
      .limit(parseInt(limit))
      .sort({ updatedAt: -1 });

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
    res.status(500).json({
      success: false,
      message: 'Failed to fetch carts',
      error: error.message
    });
  }
};

