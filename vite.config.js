import { defineConfig } from "vite";

// GitHub Pages project site is served from /<repo-name>/, so assets need a
// matching base path in production; local dev keeps the root base.
export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? "/ghost-cube-3d/" : "/",
});
