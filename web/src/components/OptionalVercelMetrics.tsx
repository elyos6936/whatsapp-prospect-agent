import { lazy, Suspense } from 'react';

/** Analytics Vercel — chargement optionnel pour ne jamais bloquer l'UI si le paquet manque. */
const VercelMetrics = lazy(async () => {
  try {
    const [analytics, speed] = await Promise.all([
      import('@vercel/analytics/react'),
      import('@vercel/speed-insights/react'),
    ]);
    return {
      default: function Metrics() {
        return (
          <>
            <analytics.Analytics />
            <speed.SpeedInsights />
          </>
        );
      },
    };
  } catch {
    return { default: () => null };
  }
});

export function OptionalVercelMetrics() {
  if (!import.meta.env.PROD) return null;
  return (
    <Suspense fallback={null}>
      <VercelMetrics />
    </Suspense>
  );
}
