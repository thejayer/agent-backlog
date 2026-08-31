import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./styles/shell.css";
import "./styles/backlog.css";
import "./styles/packet-workspace.css";
import "./styles.css";
import "./styles/glass.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
