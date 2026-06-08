/**
 * main.jsx — React entry point
 * StrictMode is enabled for development warnings (double-invokes effects).
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);