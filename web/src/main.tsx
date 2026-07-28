import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './index.css';
import App from '@/App';
import { AuthProvider } from '@/lib/auth';
import { ScrollToTop } from '@/components/ScrollToTop';
import { AppErrorBoundary } from '@/components/ui/AppErrorBoundary';
import { OptionalVercelMetrics } from '@/components/OptionalVercelMetrics';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <BrowserRouter>
        <ScrollToTop />
        <AuthProvider>
          <App />
        </AuthProvider>
        <OptionalVercelMetrics />
      </BrowserRouter>
    </AppErrorBoundary>
  </StrictMode>,
);
