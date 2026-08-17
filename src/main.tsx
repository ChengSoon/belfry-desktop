import { createRoot } from "react-dom/client";
import App from "./App";
import { BackgroundProvider } from "./background/BackgroundProvider";
import "./styles.css";
import { ThemeProvider } from "./theme/ThemeProvider";
import { TypographyProvider } from "./typography/TypographyProvider";

createRoot(document.getElementById("root")!).render(
  <ThemeProvider>
    <TypographyProvider>
      <BackgroundProvider>
        <App />
      </BackgroundProvider>
    </TypographyProvider>
  </ThemeProvider>,
);
