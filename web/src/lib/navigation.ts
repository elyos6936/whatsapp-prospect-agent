export type OverlayView = 'settings' | 'automation' | 'stats' | null;

export function getOverlayTitle(view: OverlayView): string {
  if (view === 'settings') return 'Réglages';
  if (view === 'automation') return 'Automatisation';
  if (view === 'stats') return 'Statistiques';
  return 'Klanvio';
}
