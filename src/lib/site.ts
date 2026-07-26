/**
 * Canonical origin for the deployed site, without a trailing slash.
 *
 * Single source of truth: `vite.config.ts` reads it to fill the `%SITE_URL%`
 * placeholders in `index.html` and to emit `robots.txt` and `sitemap.xml` at
 * build time. Change it here and everything follows — pointing the site at a
 * custom domain is a one-line edit.
 *
 * Deliberately free of imports so the Vite config can load it directly.
 */
export const SITE_URL = 'https://mohammadsharafi.vercel.app';
