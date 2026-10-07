import { defineConfig, loadEnv } from 'vite';

import react from '@vitejs/plugin-react';

import { fileURLToPath, URL } from 'node:url';

import { readFileSync } from 'node:fs';

function redirectsFile(): string {
  return readFileSync(
    fileURLToPath(
      new URL('./public/_redirects', import.meta.url),
    ),
    'utf8',
  );
}

function otpTarget(): string {
  const redirects = redirectsFile();

  const match = redirects.match(
    /^\s*\/otp\/\*\s+(\S+?)\/otp\/:splat\s+200/m,
  );

  if (!match) {
    throw new Error(
      'No /otp/* proxy rule found in public/_redirects. ' +
      'The dev server and Netlify both rely on it to reach the routing engine.',
    );
  }

  return match[1];
}

function apiTarget(localTarget?: string): string {
  const target = process.env.DEV_API_TARGET || localTarget;
  if (target) return target;
  const match = redirectsFile().match(/^\s*\/api\/data\/\*\s+(\S+?)\/api\/data\/:splat\s+200/m);
  if (!match) throw new Error('No /api/data/* proxy rule found in public/_redirects.');
  return match[1];
}

export default defineConfig(({ mode }) => {
  // Vite does not populate process.env from .env.local while evaluating its config.
  // Read only the server-side DEV_ prefix, never expose DATABASE_URL to the browser.
  const developmentEnv = loadEnv(mode, process.cwd(), 'DEV_');
  const backendTarget = apiTarget(developmentEnv.DEV_API_TARGET);
  return {
    plugins: [react()],

    resolve: {
      alias: {
        '@': fileURLToPath(
          new URL('./src', import.meta.url),
        ),
      },
    },

    optimizeDeps: {
      exclude: ['lucide-react'],
    },

    server: {
      proxy: {
        '/weather': { target: 'https://api.data.gov.my', changeOrigin: true, timeout: 20000, proxyTimeout: 20000 },
        /**
         * OpenTripPlanner
         */
        '/otp': {
          target: otpTarget(),
          changeOrigin: true,
          agent: false,
          timeout: 30_000,
          proxyTimeout: 30_000,
        },

        /**
         * US 3.2 — Rapid KL GTFS-Realtime
         */
        '/gtfs-rt': {
          target: 'https://api.data.gov.my',

          changeOrigin: true,

          rewrite: path => {
            if (
              path ===
              '/gtfs-rt/rapid-bus-kl'
            ) {
              return (
                '/gtfs-realtime/vehicle-position/prasarana/' +
                '?category=rapid-bus-kl'
              );
            }

            return path;
          },

          timeout: 15_000,
          proxyTimeout: 15_000,
        },
        '/api/reliability': {
          target: backendTarget,
          changeOrigin: true,
          timeout: 15_000,
        },
        '/api/meetings': {
          target: backendTarget,
          changeOrigin: true,
          timeout: 90_000,
          proxyTimeout: 90_000,
        },
        '/api/data': {
          target: backendTarget,
          changeOrigin: true,
          timeout: 90_000,
          proxyTimeout: 90_000,
        },
      },
    },
  };
});
