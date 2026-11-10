import React from "react";
import Layout from "./../components/Layout/Layout";

const Policy = () => {
  return (
    <Layout title={"Privacy Policy"}>
      <div className="row contactus">
        <div className="col-md-6 img">
          <img
            src="/images/contactus.jpeg"
            alt="contactus"
            style={{ width: "100%" }}
          />
        </div>
        <div className="col-md-4 tx" >
          <h1>Thank you for visiting our e-commerce website.</h1>
          <p>Your privacy is important to us, and we are committed to protecting your personal information. This Privacy Policy explains how we collect, use, and protect your information. By using our Website, you agree to the terms of this Privacy Policy.</p>      
        </div>
      </div>
    </Layout>
  );
};

export default Policy;