import mongoose from "mongoose";
import colors from "colors";

// Retries until Mongo is reachable (every 5 s). The original version gave up after the first failure,
// so an app instance that booted before the database was up stayed "mongo: down" forever (P-27).
const connectDB = async () => {
  for (let attempt = 1; ; attempt++) {
    try {
      const conn = await mongoose.connect(process.env.MONGO_URL, { dbName: 'ecommerce', serverSelectionTimeoutMS: 5000 });
      console.log(
        `Conneted To Mongodb Databse ${conn.connection.host}`.bgMagenta.white
      );
      return;
    } catch (error) {
      console.log(`Errro in Mongodb ${error} (attempt ${attempt}, retrying in 5 s)`.bgRed.white);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
};

export default connectDB;
