import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import TriadModel from "./TriadModel";

createRoot(document.getElementById("root")!).render(<StrictMode><TriadModel width={640} height={480} /></StrictMode>);
