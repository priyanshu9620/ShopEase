import React from "react";
import Layout from "./../components/Layout/Layout";
import { useSearch } from "../context/search";
import { serverval } from "../index";
import { Link, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { useCart } from "../context/cart";
const Search = () => {
  const [values, setValues] = useSearch();

  //these are just copied from homempage.js to make it similar to it
  const navigate = useNavigate();
  const [cart, setCart] = useCart();
  return (
    <Layout title={"Search results"}>
      <div style={{ margin:'4rem' }} className="container">
      <div className="container-fluid row mt-5">
        <div className="text-center">
          <h1>Search Resuts</h1>
          <h6>
            {values?.results.length < 1
              ? "No Products Found"
              : `Found ${values?.results.length}`}
          </h6>
          {/* <div className="col-md-9 "> */}
          <h1 className="text-center">Products</h1>
            <div className="d-flex flex-wrap mt-4">
              {values?.results.map((p) => (
                <div className="card m-2" style={{ width: "18rem" }}>
                <img
                src={`${serverval}api/v1/product/product-photo/${p._id}`}
                className="card-img-top"
                alt={p.name}
                />
                    <h5 className="card-title">{p.name}</h5>
                    <p className="card-text">
                      {p.description.substring(0, 30)}...
                    </p>
                    <p className="card-text"> ₹{p.price}</p>
                    <div className="card-name-price">
                    <button
                      className="btn btn-info ms-1"
                      onClick={() => navigate(`/product/${p.slug}`)}
                      >
                      More Details
                    </button>
                    <button
                      className="btn btn-dark ms-1"
                      onClick={() => {
                        setCart([...cart, p]);
                        localStorage.setItem(
                          "cart",
                          JSON.stringify([...cart, p])
                          );
                          toast.success("Item Added to cart");
                      }}
                      >
                      ADD TO CART
                    </button>
                  </div>
                  </div>
                  ))}
                </div>
            </div>
        </div>
      </div>
    </Layout>
  );
};

export default Search;