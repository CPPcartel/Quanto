import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./site/site.css";
import "./styles.css";

// Privy is deliberately NOT mounted here — it is loaded with the game only,
// so the marketing pages don't carry a megabyte of auth they never use.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
