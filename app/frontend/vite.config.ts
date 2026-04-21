import { defineConfig } from 'vitest/config';

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      '/api/catalog': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/api/orders': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  test: {
    globals: true,
    environment: 'node',
  },
});
