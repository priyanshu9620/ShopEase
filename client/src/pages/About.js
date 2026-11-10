import React from "react";
import Layout from "./../components/Layout/Layout";

const About = () => {
  return (
    <Layout title={"About us - Ecommer app"}>
      <div className="row contactus ">
        <div className="col-md-6 ">
          <img
            src="/images/about.jpeg"
            alt="contactus"
            style={{ width: "100%" }}
          />
        </div>
        <div className="col-md-4">
          <p className="text-justify mt-2">
          Welcome to Ecommerce Website!
          At Ecommerce Website, we are passionate about providing you with a seamless and delightful online shopping experience. We understand that in today's fast-paced world, convenience and quality are paramount when it comes to purchasing products online. That's why we have curated a diverse range of products that cater to your every need, all in one place.
          </p>
        </div>
      </div>
    </Layout>
  );
};

export default About;