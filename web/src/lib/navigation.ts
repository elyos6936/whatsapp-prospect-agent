export type OverlayView = 'settings' | 'stats' | null;

export function getOverlayTitle(view: OverlayView): string {
  if (view === 'settings') return 'Réglages';
  if (view === 'stats') return 'Statistiques';
  return 'Klanvio';
}
