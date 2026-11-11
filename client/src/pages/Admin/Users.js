import React, { useState, useEffect } from "react";
import AdminMenu from "../../components/Layout/AdminMenu";
import Layout from "./../../components/Layout/Layout";
import { serverval } from "../../index";
import axios from "axios";
import toast from "react-hot-toast";

const Users = () => {
  const [users, setusers] = useState([]);

  //getall users
  const getAllusers = async () => {
    try {
      const { data } = await axios.get(`${serverval}api/v1/auth/get-user`);
      setusers(data.users);
      console.log(data.users);

    } catch (error) {
      console.log(error);
      toast.error("Something Went Wrong");
    }
  };

  //lifecycle method: whenever reloads just update the new state of all users from api
  useEffect(() => {
    getAllusers();
  }, []);
  return (
    <Layout title={"Dashboard - All Users"}>
      <div className="container-fluid m-3 p-3">
        <div className="row dashboard">
          <div className="col-md-3">
            <AdminMenu />
          </div>
          <div className="col-md-9">
            <h1>All Users</h1>
            <div className="d-flex flex-wrap">
              {users?.map((u) => (
                  <div className="card m-2" style={{ width: "18rem" }}>
                    <div className="card-body">
                      <h5 className="card-title">{u.name}</h5>
                      <h5 className="card-title">{u.email}</h5>
                      <p className="card-text">{u.address}</p>
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

export default Users;