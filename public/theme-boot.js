/* Runs synchronously in <head>, before the first paint and long before the app
   bundle loads, so the window never flashes light on its way to the dark UI.
   Storage key, class name and colours must stay in sync with
   src/store/useThemeStore.ts and the --body-bg-end tokens in
   src/styles/tokens.css. */
(function () {
  var BACKGROUNDS = { light: "#f2f4f7", dark: "#090a0c" };

  var stored = null;
  try {
    stored = window.localStorage.getItem("scribedog-theme");
  } catch (error) {
    // localStorage may be unavailable in some environments.
  }

  var resolved =
    stored === "light" || stored === "dark"
      ? stored
      : window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";

  var root = document.documentElement;
  root.classList.toggle("dark", resolved === "dark");
  root.style.colorScheme = resolved;
  root.style.backgroundColor = BACKGROUNDS[resolved];
})();
