export type OverlayView = 'settings' | 'automation' | null;

export function getOverlayTitle(view: OverlayView): string {
  if (view === 'settings') return 'Réglages';
  if (view === 'automation') return 'Automatisation';
  return 'Klanvio';
}
