export const SETTINGS_KEY = "latex-studio:settings";

/** Inline script for <head>: sets data-theme before first paint so there's no light flash in dark mode. */
export const THEME_BOOTSTRAP = `(function(){try{var s=JSON.parse(localStorage.getItem(${JSON.stringify(SETTINGS_KEY)})||"{}");var t=s.theme||"system";if(t==="system"){t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}document.documentElement.dataset.theme=t}catch(e){document.documentElement.dataset.theme="light"}})()`;
