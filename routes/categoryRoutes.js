import express from "express";
import { isAdmin, requireSignIn } from "./../middlewares/authMiddleware.js";
import {
  categoryControlller,
  createCategoryController,
  deleteCategoryCOntroller,
  singleCategoryController,
  updateCategoryController,
} from "./../controllers/categoryController.js";
// lab: cache-aside (experiment 01) — see routes/productRoutes.js. Category writes also invalidate
// "products" because product responses embed the populated category.
import { cached, invalidate } from "../lib/cache.js";

const router = express.Router();

// create category
router.post(
  "/create-category",
  requireSignIn,
  isAdmin,
  invalidate("categories", "products"),
  createCategoryController
);

//update category
router.put(
  "/update-category/:id",
  requireSignIn,
  isAdmin,
  invalidate("categories", "products"),
  updateCategoryController
);

//getALl category
router.get("/get-category", cached("categories", 300), categoryControlller);

//single category
router.get("/single-category/:slug", cached("categories", 300), singleCategoryController);

//delete category
router.delete(
  "/delete-category/:id",
  requireSignIn,
  isAdmin,
  invalidate("categories", "products"),
  deleteCategoryCOntroller
);

export default router;