import express from "express";
import {
  brainTreePaymentController,
  braintreeTokenController,
  createProductController,
  deleteProductController,
  getProductController,
  getSingleProductController,
  productCategoryController,
  productCountController,
  productFiltersController,
  productListController,
  productPhotoController,
  realtedProductController,
  searchProductController,
  updateProductController,
} from "../controllers/productController.js";
import { isAdmin, requireSignIn } from "../middlewares/authMiddleware.js";
import formidable from "express-formidable";
// lab: cache-aside (experiment 01). `cached` is a no-op unless CACHE_ENABLED=true; `invalidate`
// bumps the namespace version after a successful write. Controllers are untouched.
import { cached, invalidate } from "../lib/cache.js";

const router = express.Router();

//routes
// formidable handles file uploads in express
router.post(
  "/create-product",
  requireSignIn,
  isAdmin,
  formidable(),
  invalidate("products"),
  createProductController
);
//routes
router.put(
  "/update-product/:pid",
  requireSignIn,
  isAdmin,
  formidable(),
  invalidate("products"),
  updateProductController
);

//get products
router.get("/get-product", cached("products", 60), getProductController);

//single product
router.get("/get-product/:slug", cached("products", 60), getSingleProductController);

//get photo  (heaviest read: ~54 KB body straight from Mongo; long TTL, photos rarely change)
router.get("/product-photo/:pid", cached("products", 600), productPhotoController);

//delete product
router.delete("/delete-product/:pid", invalidate("products"), deleteProductController);

//filter product  (POST with a body → cache key includes the body, see lib/cache.js)
router.post("/product-filters", cached("products", 60), productFiltersController);

//product count
router.get("/product-count", cached("products", 60), productCountController);

//product per page
router.get("/product-list/:page", cached("products", 60), productListController);

//search product
router.get("/search/:keyword", cached("products", 60), searchProductController);

//similar product
router.get("/related-product/:pid/:cid", cached("products", 60), realtedProductController);

//category wise product
router.get("/product-category/:slug", cached("products", 60), productCategoryController);

//payments routes
//token
router.get("/braintree/token", braintreeTokenController);

//payments
router.post("/braintree/payment", requireSignIn, brainTreePaymentController);

export default router;