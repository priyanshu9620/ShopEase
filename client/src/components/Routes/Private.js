import { useState, useEffect } from "react";
import { useAuth } from "../../context/auth";
import { Outlet } from "react-router-dom";
import axios from "axios";
import Spinner from "../Spinner";
import { serverval } from "../../index";
export default function PrivateRoute() {
  const [ok, setOk] = useState(false);
  const [auth, setAuth] = useAuth();

  useEffect(() => {
    const authCheck = async () => {
      const res = await axios.get(`${serverval}api/v1/auth/user-auth`);
      if (res.data.ok) {
        setOk(true);
      } else {
        setOk(false);
      }
    };
    if (auth?.token) authCheck();
  }, [auth?.token]);

  // you can also write like thsi 
  // return ok ? <Outlet /> : <Navigate to="/login" />;
  // outlet means now you can proceed to child route and in route structure you can 
  // see this route is used as wrapper inside which we have child routes  
  return ok ? <Outlet /> : <Spinner />;
}