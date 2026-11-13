import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./style.css";

const root = document.getElementById("root");
if (!root) throw new Error("Could not find the application root");
createRoot(root).render(<App />);
