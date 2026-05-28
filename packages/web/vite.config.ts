import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
    plugins: [react()],
    test: {
        globals: true,
        environment: 'jsdom',
    },
    server: {
        port: 5173,
        proxy: {
            '/api': {
                target: 'http://127.0.0.1:8080',
                changeOrigin: true,
            }
        }
    },
    build: {
        outDir: '../container/web/dist',
        emptyOutDir: true,
    },
    resolve: {
        conditions: ['module'],
    },
});
