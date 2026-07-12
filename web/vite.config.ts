import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (id.includes('react-syntax-highlighter') || id.includes('refractor')) {
            return 'syntax-highlighter';
          }
          if (id.includes('react-markdown') || id.includes('remark-') || id.includes('micromark')) {
            return 'markdown';
          }
          if (id.includes('date-fns')) return 'date-fns';
          if (id.includes('lucide-react')) return 'icons';
          if (id.includes('react-dom') || id.includes('/react/')) return 'react-vendor';
        },
      },
    },
  },
});
