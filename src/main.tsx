import React from "react";
import { createRoot } from "react-dom/client";

import App from "./index";
import CliPackBridge from "./components/cli-pack-bridge";
import "./styles/index.css";

createRoot(document.querySelector("#root")!).render(
  <React.StrictMode>
    <CliPackBridge />
    <App />
  </React.StrictMode>,
);
