import React from "react";
import ReactDOM from "react-dom/client";
import App from "./PlacePickApp.jsx";

console.log("PlacePick build check: " + new Date().toISOString() + " (식당 이름 다양화 v23)");

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
