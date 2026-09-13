import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so a built dist/ works from any path: a GitHub Pages
  // project site, a Netlify drop, a Cloudflare Pages deploy, or file://.
  base: './',
});
