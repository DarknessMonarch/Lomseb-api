const Handlebars = require('handlebars');
const nodemailer = require("nodemailer");
const dotenv = require("dotenv");
const path = require('path');
const fs = require('fs');

dotenv.config();

const emailTransporter = () => {
  return nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: {
      user: process.env.EMAIL,
      pass: process.env.EMAIL_PASSWORD,
    },
    secure: true,
  });
};

Handlebars.registerHelper('eq', function(a, b) {
  return a === b;
});

Handlebars.registerHelper('gt', function(a, b) {
  return a > b;
});

Handlebars.registerHelper('lt', function(a, b) {
  return a < b;
});

Handlebars.registerHelper('formatCurrency', function(value) {
  return parseFloat(value).toFixed(2);
});




exports.sendWelcomeEmail = async (email, username) => {
  if (!email || !username) {
    throw new Error('Email and username are required to send a welcome email.');
  }

  try {
    const emailPath = path.join(__dirname, '../client/welcome.html');
    const template = fs.readFileSync(emailPath, 'utf-8');
    const personalizedTemplate = template.replace('{{username}}', username);

    let mailOptions = {
      from: process.env.EMAIL,
      to: email,
      subject: 'Welcome to bilkro',
      html: personalizedTemplate,
    };


    const transporter = emailTransporter();
    const info = await transporter.sendMail(mailOptions);
    return { success: true, message: 'Welcome email sent successfully.' };
  } catch (error) {
    throw new Error('Failed to send the welcome email.');
  }
};


exports.sendOrderConfirmationEmail = async (email, customerName, orderDetails) => {
  if (!email || !customerName || !orderDetails) {
    throw new Error('Email, customer name, and order details are required to send an order confirmation email.');
  }

  try {
    const emailPath = path.join(__dirname, '../client/orderConfirmation.html');
    const templateSource = fs.readFileSync(emailPath, 'utf-8');
    const template = Handlebars.compile(templateSource);
    const orderDate = new Date(orderDetails.date || Date.now()).toLocaleString();

    const emailData = {
      customerName,
      orderId: orderDetails.reportId || orderDetails.saleId || 'N/A',
      orderDate,
      items: orderDetails.items.map(item => ({
        name: item.name,
        quantity: item.quantity,
        price: item.price.toFixed(2),
        itemTotal: (item.price * item.quantity).toFixed(2)
      })),
      subtotal: orderDetails.subtotal.toFixed(2),
      discount: orderDetails.discount.toFixed(2),
      total: orderDetails.total.toFixed(2),
      customerEmail: email,
      customerPhone: orderDetails.customerInfo?.phone || 'N/A',
      customerAddress: orderDetails.customerInfo?.address || 'N/A',
      paymentMethod: orderDetails.paymentMethod || 'N/A',
      transactionId: orderDetails.transactionId || orderDetails.saleId || 'N/A',
      orderTrackingUrl: `${process.env.WEBSITE_LINK}/orders/${orderDetails.saleId}`,
      
      paymentStatus: orderDetails.paymentStatus || 'paid',
      amountPaid: orderDetails.amountPaid ? orderDetails.amountPaid.toFixed(2) : orderDetails.total.toFixed(2),
      remainingBalance: orderDetails.remainingBalance ? orderDetails.remainingBalance.toFixed(2) : '0.00',
      
      debtId: orderDetails.debtId || null,
      dueDate: orderDetails.dueDate ? new Date(orderDetails.dueDate).toLocaleDateString() : null
    };
    const personalizedTemplate = template(emailData);

    let mailOptions = {
      from: process.env.EMAIL,
      to: email,
      subject: 'Your Order Confirmation - Bilkro',
      html: personalizedTemplate,
    };

    const transporter = emailTransporter();
    const info = await transporter.sendMail(mailOptions);
    return { success: true, message: 'Order confirmation email sent successfully.' };
  } catch (error) {
    console.error('Error sending order confirmation email:', error);
    throw new Error('Failed to send the order confirmation email.');
  }
};




exports.sendVerificationCodeEmail = async (email, username, verificationCode) => {
  if (!email || !username) {
    throw new Error('Email and username are required to send a welcome email.');
  }

  try {
    const emailPath = path.join(__dirname, '../client/verification.html');
    const template = fs.readFileSync(emailPath, 'utf-8');
    const personalizedTemplate = template.replace('{{username}}', username).replace('{{verificationCode}}', verificationCode);

    let mailOptions = {
      from: process.env.EMAIL,
      to: email,
      subject: 'Your Verification Code',
      html: personalizedTemplate,
    };

    const transporter = emailTransporter();
    const info = await transporter.sendMail(mailOptions);
    return { success: true, message: 'Verification email sent successfully.' };
  } catch (error) {
    throw new Error('Failed to send the verification email.');
  }
};


exports.sendAdminEmail = async (email, username, isAdmin) => {

  try {
    const status = isAdmin ? 'granted' : 'revoked';
    const emailPath = path.join(__dirname, '../client/adminEmail.html');
    const template = fs.readFileSync(emailPath, 'utf-8');
    const personalizedTemplate = template.replace('{{username}}', username).replace('{{status}}', status);

    let mailOptions = {
      from: process.env.EMAIL,
      to: email,
      subject: 'You are  now an admin',
      html: personalizedTemplate,
    };

    const transporter = emailTransporter();
    const info = await transporter.sendMail(mailOptions);
    return { success: true, message: 'Admin email sent successfully.' };
  } catch (error) {
    throw new Error('Failed to send the verification email.');
  }
};

exports.sendDebtReminderEmail = async (email, debtDetails) => {
  if (!email || !debtDetails) {
    throw new Error('Email and debt details are required to send a debt reminder email.');
  }

  try {
    const emailPath = path.join(__dirname, '../client/debtReminder.html');
    const templateSource = fs.readFileSync(emailPath, 'utf-8');

    const template = Handlebars.compile(templateSource);

    const dueDate = new Date(debtDetails.dueDate).toLocaleDateString();

    const emailData = {
      username: debtDetails.username,
      debtId: debtDetails.debtId,
      orderId: debtDetails.orderId,
      amount: debtDetails.amount.toFixed(2),
      dueDate: dueDate,

    };

    const personalizedTemplate = template(emailData);

    let mailOptions = {
      from: process.env.EMAIL,
      to: email,
      subject: 'Payment Reminder - Bilkro',
      html: personalizedTemplate,
    };

    const transporter = emailTransporter();
    const info = await transporter.sendMail(mailOptions);
    return { success: true, message: 'Debt reminder email sent successfully.' };
  } catch (error) {
    console.error('Error sending debt reminder email:', error);
    throw new Error('Failed to send the debt reminder email.');
  }
};


exports.contactEmail = async (email, username, message) => {
  if (!email || !username || !message) {
    throw new Error('Email, username and message are required to send a contact email.');
  }

  try {
    const emailPath = path.join(__dirname, '../client/contact.html');
    const template = fs.readFileSync(emailPath, 'utf-8');
    const personalizedTemplate = template.replace('{{username}}', username).replace('{{email}}', email).replace('{{message}}', message);

    let mailOptions = {
      from: process.env.EMAIL,
      to: process.env.EMAIL,
      subject: 'Contact Us',
      html: personalizedTemplate,
    };


    const transporter = emailTransporter();
    const info = await transporter.sendMail(mailOptions);
    return { success: true, message: 'Contact email sent successfully.' };
  } catch (error) {
    throw new Error('Failed to send the verification email.');
  }
};


exports.sendPasswordResetEmail = async (username, email, resetToken) => {

  try {
    const emailPath = path.join(__dirname, '../client/passwordEmailReset.html');
    const template = fs.readFileSync(emailPath, 'utf-8');
    const resetUrl = `${process.env.WEBSITE_LINK}/authentication/reset/${resetToken}`;
    const personalizedTemplate = template.replace('{{username}}', username).replace('{{resetUrl}}', resetUrl);


    let mailOptions = {
      from: process.env.EMAIL,
      to: email,
      subject: 'Password Reset Request',
      html: personalizedTemplate,
    };

    const transporter = emailTransporter();
    await transporter.sendMail(mailOptions);
  } catch (error) {
    console.error('Error sending reset email:', error);
  }
};

exports.sendResetSucessfulEmail = async (username, email) => {

  try {
    const emailPath = path.join(__dirname, '../client/passwordResetSuccesful.html');
    const template = fs.readFileSync(emailPath, 'utf-8');
    const personalizedTemplate = template.replace('{{username}}', username);


    let mailOptions = {
      from: process.env.EMAIL,
      to: email,
      subject: 'Password Reset Successful',
      html: personalizedTemplate,
    };

    const transporter = emailTransporter();
    await transporter.sendMail(mailOptions);
  } catch (error) {
    console.error('Error sending successful reset email:', error);
  }
};

exports.deleteAccountEmail = async (email, username, details) => {
  const subject = details.deletedByAdmin
    ? 'Your Account Has Been Deleted by Administrator'
    : 'Account Deletion Successful';

  const deletionDate = new Date(details.deletionDate).toLocaleString();

  let message = ``;

  if (details.deletedByAdmin) {
    message += `Your account has been deleted by an administrator on ${deletionDate}.`;
    if (details.bulkDeletion) {
      message += '\nThis action was part of a bulk account cleanup process.';
    }
  } else {
    message += `As requested, your account has been successfully deleted on ${deletionDate}.`;
  }


  try {
    const emailPath = path.join(__dirname, '../client/accountDeleted.html');
    const template = fs.readFileSync(emailPath, 'utf-8');
    const personalizedTemplate = template
      .replace('{{username}}', username)
      .replace('{{message}}', message);

    let mailOptions = {
      from: process.env.EMAIL,
      to: email,
      subject: subject,
      html: personalizedTemplate,
    };

    const transporter = emailTransporter();
    await transporter.sendMail(mailOptions);

  } catch (error) {
    console.error('Error sending account deletion email:', error);
  }
};



module.exports = exports;