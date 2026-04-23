"use client";
import { useState, useEffect } from "react";

export const THEMES = [
  { id: "light",           label: "light",           dark: false, bg: "#ffffff", fg: "#0a0a0a", accent: "#888888" },
  { id: "dark",            label: "dark",            dark: true,  bg: "#0d0d0d", fg: "#ebebeb", accent: "#555555" },
  { id: "catppuccin-mocha",label: "catppuccin mocha",dark: true,  bg: "#1e1e2e", fg: "#cdd6f4", accent: "#cba6f7" },
  { id: "catppuccin-latte",label: "catppuccin latte",dark: false, bg: "#eff1f5", fg: "#4c4f69", accent: "#8839ef" },
  { id: "nord",            label: "nord",            dark: true,  bg: "#2e3440", fg: "#eceff4", accent: "#81a1c1" },
  { id: "gruvbox-dark",    label: "gruvbox dark",    dark: true,  bg: "#282828", fg: "#ebdbb2", accent: "#d79921" },
  { id: "gruvbox-light",   label: "gruvbox light",   dark: false, bg: "#fbf1c7", fg: "#282828", accent: "#b57614" },
  { id: "dracula",         label: "dracula",         dark: true,  bg: "#282a36", fg: "#f8f8f2", accent: "#bd93f9" },
  { id: "tokyo-night",     label: "tokyo night",     dark: true,  bg: "#1a1b26", fg: "#a9b1d6", accent: "#7aa2f7" },
  { id: "rose-pine",       label: "rosé pine",       dark: true,  bg: "#191724", fg: "#e0def4", accent: "#ebbcba" },
  { id: "rose-pine-dawn",  label: "rosé pine dawn",  dark: false, bg: "#faf4ed", fg: "#575279", accent: "#b4637a" },
];

function applyTheme(theme) {
  const root = document.documentElement;
  root.setAttribute("data-theme", theme);
  const t = THEMES.find((t) => t.id === theme);
  root.classList.toggle("dark", t?.dark ?? false);
  localStorage.setItem("lyricus-theme", theme);
}

function getInitialTheme() {
  const saved = localStorage.getItem("lyricus-theme");
  if (saved && THEMES.find((t) => t.id === saved)) return saved;
  // legacy: "dark"/"light" booleans handled by theme ids matching
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function useTheme() {
  const [theme, setThemeState] = useState("light");

  useEffect(() => {
    const initial = getInitialTheme();
    setThemeState(initial);
    applyTheme(initial);
  }, []);

  function setTheme(name) {
    setThemeState(name);
    applyTheme(name);
  }

  const currentTheme = THEMES.find((t) => t.id === theme) ?? THEMES[0];

  return { theme, setTheme, isDark: currentTheme.dark, currentTheme };
}
