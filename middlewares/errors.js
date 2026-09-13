// middlewares/errors.js
const errorHandlers = (err, req, res, next) => {
    console.error('Error caught in middleware:', err); // Log the full error for debugging
  
    // Default status code if none is provided
    const statusCode = err.status || err.statusCode || 500; // Check common error properties
    const message = err.message || 'Internal Server Error';
  
    // Ensure status is set before sending response
    res.status(statusCode).json({
      success: false,
      message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  };
  
  module.exports = errorHandlers;