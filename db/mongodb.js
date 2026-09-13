const mongoose = require('mongoose')

const connectDB = async (url) => {
  try {
    await mongoose.connect(url);

    console.log("MongoDB connected");
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
};

module.exports = connectDB