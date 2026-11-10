import express from "express";
import colors from "colors";
import dotenv from "dotenv";
import morgan from "morgan";
import connectDB from "./config/db.js";
import authRoutes from "./routes/authRoute.js";
import categoryRoutes from "./routes/categoryRoutes.js";
import productRoutes from "./routes/productRoutes.js";
import cors from "cors";
import mongoose from "mongoose";
// this path is used for deployment
import path from 'path';
import {fileURLToPath} from 'url';

//configure env
dotenv.config();

//databse config
connectDB();

//es module fix
const __filename=fileURLToPath(import.meta.url);
const __dirname=path.dirname(__filename);

//rest object
const app = express();

//middelwares
app.use(cors());
app.use(express.json());
app.use(morgan("dev"));
//for deployment middleware 
app.use(express.static(path.join(__dirname,'./client/build')))

// liveness/readiness probe used by docker compose, the nginx/ALB health check and the lab runner.
// 200 only when Mongo answers a ping; reports the version + replica so rolling deploys are visible.
app.get("/healthz", async (req, res) => {
  let mongo = "down";
  if (mongoose.connection.readyState === 1) {
    try {
      await mongoose.connection.db.admin().ping();
      mongo = "up";
    } catch (e) {
      mongo = "error";
    }
  }
  res.status(mongo === "up" ? 200 : 503).json({
    status: mongo === "up" ? "ok" : "degraded",
    version: process.env.APP_VERSION || "dev",
    replica: process.env.HOSTNAME || "local",
    mongo,
    uptime_s: Math.round(process.uptime()),
  });
});

//routes
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/category", categoryRoutes);
app.use("/api/v1/product", productRoutes);

//rest api
//note this is a general route jo rehta hi hai welcome ke liye pheli baar khulega
//iske bina bhi kaam hoskta but ye acha lagne ke liye
app.get("/", (req, res) => {
  res.send("<h1>Welcome to ecommerce app</h1>");
});
//for deplyment api 
app.use("*",function(req,res){
  res.sendFile(path.join(__dirname,'./client/build/index.html'));
});

//PORT
const PORT = process.env.PORT || 8080;

//run listen
app.listen(PORT, () => {
  console.log(
    `Server Running on ${process.env.DEV_MODE} mode on port ${PORT}`
  );
});
