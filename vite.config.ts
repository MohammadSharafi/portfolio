// `defineConfig` comes from vitest/config so the `test` block is typed; it is a
// superset of the Vite export.
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react-swc';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
 * The fingerprint of the room's *shape*, written by `build_room.py`.
 *
 * This is what decides whether a bake still applies, and `roomHash` above is
 * not, because a hash of the whole GLB also covers every texture in it. Under
 * that rule, softening the wood grain discarded an hour-long bake that was
 * still perfectly valid — which made material work and lighting work mutually
 * exclusive, since doing either meant redoing the other.
 *
 * Irradiance depends on where the surfaces are, not what colour they will be
 * painted. See `export_room.geometry_fingerprint` for what this covers and the
 * one thing (colour bleed) it deliberately does not.
 */
function roomGeometry(): string {
  const stamp = path.join(rootDir, 'public', 'models', 'room-geometry.json');
  if (!existsSync(stamp)) return '';
  try {
    return (JSON.parse(readFileSync(stamp, 'utf8')) as { geometry?: string }).geometry ?? '';
  } catch {
    return '';
  }
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

/**
 * Lets the offline renderer use the screens the site actually draws.
 *
 * Every readable surface in the room — the dashboards, the code editor, the
 * whiteboard, the CV — is a canvas painted at runtime by `screenContent.ts`.
 * Blender has no equivalent, so in a Cycles render those surfaces come out
 * black, and a hero shot of a developer's room with six dead monitors in it is
 * not a hero shot.
 *
 * The alternative was reimplementing 700 lines of canvas drawing in Python,
 * which would then be a second copy to keep in step with the first, and would
 * be wrong in some small way nobody noticed until a render shipped. Instead the
 * browser draws them exactly as it does for visitors and posts the pixels here,
 * and `render_hero.py` loads what it wrote. One implementation, both outputs.
 *
 * Dev only, and deliberately narrow: it accepts a bare filename matching
 * `[a-z][a-z0-9_]*`, joins it to one fixed directory, and rejects everything
 * else. It writes files on request, so it must never be reachable from a
 * built site — `apply: 'serve'` is what guarantees that.
 */
function screenDump(): Plugin {
  const target = path.join(rootDir, 'scripts', 'blender', 'screens');
  return {
    name: 'screen-dump',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__screens', (request, response) => {
        const name = (request.url ?? '').replace(/^\//, '');
        if (request.method !== 'POST' || !/^[a-z][a-z0-9_]*$/.test(name)) {
          response.statusCode = 400;
          return response.end('expected POST /__screens/<name>');
        }
        const chunks: Buffer[] = [];
        request.on('data', (chunk: Buffer) => chunks.push(chunk));
        request.on('end', () => {
          try {
            mkdirSync(target, { recursive: true });
            const body = Buffer.concat(chunks).toString('utf8');
            const png = Buffer.from(body.replace(/^data:image\/png;base64,/, ''), 'base64');
            writeFileSync(path.join(target, `${name}.png`), png);
            response.end(`wrote ${name}.png (${png.length} bytes)`);
          } catch (error) {
            response.statusCode = 500;
            response.end(String(error));
          }
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), siteUrl(), screenDump()],
  define: {
    __ROOM_HASH__: JSON.stringify(roomHash()),
    __ROOM_GEOMETRY__: JSON.stringify(roomGeometry()),
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
