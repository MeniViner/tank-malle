import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { AuthProvider } from "./context/AuthContext";
import { DataProvider } from "./context/DataContext";
import { ThemeProvider } from "./context/ThemeContext";
import { ToastProvider } from "./context/ToastContext";
import "./index.css";
import { Outbox, unacknowledgedState } from "./lib/outbox";
import { APP_VERSION } from "./lib/version";

// End-to-end tests drive the outbox directly to force interleavings (two
// pages, late acknowledgements) that the UI cannot time deterministically.
// Only in the e2e build mode; production never exposes this.
if (import.meta.env.MODE === "e2e") {
  (window as unknown as { __tankMalleTest: unknown }).__tankMalleTest = {
    openOutbox: (uid: string) => Outbox.open(uid, APP_VERSION),
    unacknowledgedState,
  };
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <ToastProvider>
          <AuthProvider>
            <DataProvider>
              <App />
            </DataProvider>
          </AuthProvider>
        </ToastProvider>
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>,
);
