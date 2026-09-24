import { defineConfig } from 'vite';

/**
 * Builds media/macbook-3d.src.jsx into one self-contained ES module, media/macbook-3d.js,
 * the way media/moex-chat.js is built from the Lottie: the page is plain static HTML on
 * Vercel, so the React island ships as a finished file rather than a build step. Run it
 * with `npm run build:macbook` after touching the source, and copy the result to
 * deploy/nodesign/media/ along with the rest of the page.
 */
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  define: { 'process.env.NODE_ENV': '"production"' },
  build: {
    target: 'es2020',
    outDir: 'media',
    emptyOutDir: false,
    lib: { entry: 'media/macbook-3d.src.jsx', formats: ['es'], fileName: () => 'macbook-3d.js' },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
