const mongoose = require("mongoose")
async function connectDB() {
    try {
        const conn = await mongoose.connect(process.env.MONGO_CONNECTION_URL,
           
        );
        console.log(`MongoDB connected successfully ${conn.connection.host}`);
    } catch (err) {
        console.log(err.message);
        process.exit(1);
    }

    // empty database
    // await mongoose.connection.db.dropDatabase();
}

module.exports = {connectDB}