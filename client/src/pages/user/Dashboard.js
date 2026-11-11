import React from "react";
import Layout from "../../components/Layout/Layout";
import UserMenu from "../../components/Layout/UserMenu";
import { useAuth } from "../../context/auth";
const Dashboard = () => {
  const [auth] = useAuth();
  return (
    <Layout title={"Dashboard - Ecommerce App"}>
      <div className="container-flui m-3 p-3 dashboard">
        <div className="row">
          <div className="col-md-3">
            <UserMenu />
          </div>
          <div className="col-md-9 profileContainer">
            <h1 className="top">My Profile</h1>
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
                  <h4>Address</h4>
                  <p>{auth?.user?.address}</p>
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

export default Dashboard;