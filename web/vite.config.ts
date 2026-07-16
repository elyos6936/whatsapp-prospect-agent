import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // Excalidraw embarque mermaid → katex ; on ne s’en sert pas pour les plans
      katex: path.resolve(__dirname, './src/stubs/empty.ts'),
    },
  },
  build: {
    // rolldown-vite hisse tout le graphe asynchrone dans les <link modulepreload>
    // de l'index.html. On retire les gros chunks réservés à l'espace connecté
    // (chat) pour qu'ils ne soient pas téléchargés dès la landing page.
    modulePreload: {
      resolveDependencies: (_filename, deps) =>
        deps.filter(
          (dep) =>
            !/syntax-highlighter|markdown|motion|AuthenticatedApp|shaders|recharts|paper-design|excalidraw/.test(
              dep,
            ),
        ),
    },

    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (id.includes('@paper-design/shaders')) return 'shaders';
          if (id.includes('recharts') || id.includes('d3-')) return 'recharts';
          if (id.includes('react-syntax-highlighter') || id.includes('refractor') || id.includes('prismjs')) {
            return 'syntax-highlighter';
          }
          if (id.includes('react-markdown') || id.includes('remark-') || id.includes('micromark')) {
            return 'markdown';
          }
          if (id.includes('framer-motion') || id.includes('motion-dom') || id.includes('motion-utils')) {
            return 'motion';
          }
          if (id.includes('date-fns')) return 'date-fns';
          if (id.includes('lucide-react')) return 'icons';
          if (id.includes('@excalidraw')) return 'excalidraw';
          if (id.includes('react-dom') || id.includes('/react/')) return 'react-vendor';
        },
      },
    },
  },
  optimizeDeps: {
    include: ['@excalidraw/excalidraw'],
  },
});
