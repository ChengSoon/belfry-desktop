import { createRoot } from "react-dom/client";
import App from "./App";
import { BackgroundProvider } from "./background/BackgroundProvider";
import "./styles.css";
import { ThemeProvider } from "./theme/ThemeProvider";

createRoot(document.getElementById("root")!).render(
  <ThemeProvider>
    <BackgroundProvider>
      <App />
    </BackgroundProvider>
  </ThemeProvider>,
);
