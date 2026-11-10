import React from "react";
import AdminMenu from "../../components/Layout/AdminMenu";
import Layout from "./../../components/Layout/Layout";
import { useAuth } from "../../context/auth";
const AdminDashboard = () => {
  const [auth] = useAuth();
  return (
    // <Layout>
    //   <div className="container-fluid m-3 p-3 dashboard">
    //     <div className="row">
    //       <div className="col-md-3">
    //         <AdminMenu />
    //       </div>
    //       <div className="col-md-9">
    //         <div className="card w-75 p-3">
    //           <h3> Admin Name : {auth?.user?.name}</h3>
    //           <h3> Admin Email : {auth?.user?.email}</h3>
    //           <h3> Admin Contact : {auth?.user?.phone}</h3>
    //         </div>
    //       </div>
    //     </div>
    //   </div>
    // </Layout>
    <Layout title={"Dashboard - Ecommerce App"}>
    <div className="container-flui m-3 p-3 dashboard">
      <div className="row">
        <div className="col-md-3">
          <AdminMenu />
        </div>
        <div className="col-md-9 profileContainer">
          <h1 className="top">Admin Dashboard</h1>
          <div >
            <div className="left">
              <div>
                <h4>Full Name</h4>
                <p>{auth?.user?.name}</p>
              </div>
              <div>
                <h4>Email</h4>
                <p>{auth?.user?.email}</p>
              </div>
              <div>
                <h4>Phone no.</h4>
                <p>{auth?.user?.phone}</p>
              </div>
            </div>
            <img className="right" src={"https://t3.ftcdn.net/jpg/03/46/83/96/360_F_346839683_6nAPzbhpSkIpb8pmAwufkC7c5eD7wYws.jpg"} />
        </div>
            
        </div>
      </div>
    </div>
  </Layout>
  );
};

export default AdminDashboard;