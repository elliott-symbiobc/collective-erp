"use client";

import React, { createContext, useContext, useEffect, useState } from "react";

interface DevModeContextValue {
  devMode: boolean;
  toggleDevMode: () => void;
}

const DevModeContext = createContext<DevModeContextValue>({
  devMode: false,
  toggleDevMode: () => {},
});

export function DevModeProvider({ children }: { children: React.ReactNode }) {
  const [devMode, setDevMode] = useState(false);

  useEffect(() => {
    try {
      setDevMode(localStorage.getItem("dev-mode") === "1");
    } catch {}
  }, []);

  function toggleDevMode() {
    setDevMode((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("dev-mode", next ? "1" : "0");
      } catch {}
      return next;
    });
  }

  return (
    <DevModeContext.Provider value={{ devMode, toggleDevMode }}>
      {children}
    </DevModeContext.Provider>
  );
}

export function useDevMode() {
  return useContext(DevModeContext);
}
