import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
    plugins: [react()],
    test: {
        globals: true,
        environment: 'jsdom',
        setupFiles: ['./src/vitest.setup.ts'],
    },
    server: {
        port: 5173,
        proxy: {
            '/api': {
                target: 'http://127.0.0.1:8787',
                changeOrigin: true,
                ws: true,
            }
        }
    },
    build: {
        outDir: 'dist',
        emptyOutDir: true,
    },
    resolve: {
        conditions: ['module'],
    },
});
