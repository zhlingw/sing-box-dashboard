import "@fontsource-variable/schibsted-grotesk";
import "@fontsource-variable/source-serif-4";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";

import { createRoot } from "react-dom/client";

import { App } from "./App";
import "./styles/global.css";

createRoot(document.getElementById("root")!).render(<App />);
