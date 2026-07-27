// `defineConfig` comes from vitest/config so the `test` block is typed; it is a
// superset of the Vite export.
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react-swc';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { SITE_URL } from './src/lib/site';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * A fingerprint of the room model this build ships with.
 *
 * The runtime prefers `room-baked.glb` over `room.glb`, so a bake that has
 * fallen behind does not degrade the room quietly — it *replaces* it with an
 * older one, and every change made since becomes invisible. That happened
 * twice, and both times the room looked broken in ways the code said were
 * already fixed, which is an expensive way to find out.
 *
 * Baking it in here lets the browser compare what it was given against what the
 * bake claims it came from, and fall back on its own. Nobody has to remember.
 */
function roomHash(): string {
  const model = path.join(rootDir, 'public', 'models', 'room.glb');
  if (!existsSync(model)) return '';
  return createHash('sha256').update(readFileSync(model)).digest('hex');
}

/**
 * Keeps the deployed origin in exactly one place: substitutes `%SITE_URL%` in
 * index.html and generates robots.txt and sitemap.xml from the same constant,
 * so a domain change cannot leave stale canonical or Open Graph URLs behind.
 */
function siteUrl(): Plugin {
  return {
    name: 'site-url',
    transformIndexHtml: (html) => html.replaceAll('%SITE_URL%', SITE_URL),
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'robots.txt',
        source: `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`,
      });
      this.emitFile({
        type: 'asset',
        fileName: 'sitemap.xml',
        source: `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${SITE_URL}/</loc>
    <changefreq>monthly</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>
`,
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), siteUrl()],
  define: {
    __ROOM_HASH__: JSON.stringify(roomHash()),
  },
  resolve: {
    alias: {
      '@': path.resolve(rootDir, './src'),
    },
  },
  build: {
    target: 'es2020',
    outDir: 'build',
    minify: 'terser',
    cssMinify: true,
    sourcemap: false,
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true,
      },
    },
    // The Three.js chunk is intentionally large and lazy-loaded; it never
    // reaches the initial bundle, so the default 500KB warning is noise here.
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        // Keep React and the animation runtime in stable, separately cached
        // chunks so a content-only edit does not invalidate the vendor bundle.
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          'motion-vendor': ['motion/react'],
        },
      },
    },
  },
  server: {
    port: 3000,
    open: true,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    restoreMocks: true,
    unstubGlobals: true,
  },
});
