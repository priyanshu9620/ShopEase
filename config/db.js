import mongoose from "mongoose";
import colors from "colors";

// Retries until Mongo is reachable (every 5 s). The original version gave up after the first failure,
// so an app instance that booted before the database was up stayed "mongo: down" forever (P-27).
const connectDB = async () => {
  for (let attempt = 1; ; attempt++) {
    try {
      // maxPoolSize: mongoose defaults to 100 connections per process; 3 replicas × 100 idle connections
      // cost the 2 GB data instance ~300 MB and helped OOM-kill mongod under load (P-31). 20 is plenty.
      const conn = await mongoose.connect(process.env.MONGO_URL, {
        dbName: 'ecommerce',
        serverSelectionTimeoutMS: 5000,
        maxPoolSize: Number(process.env.MONGO_POOL_SIZE || 20),
      });
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
