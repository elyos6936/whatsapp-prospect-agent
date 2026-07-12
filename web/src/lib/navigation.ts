export type MainView = 'chat' | 'automation' | 'settings';

export const MAIN_NAV: { id: MainView; label: string }[] = [
  { id: 'chat', label: 'Chat' },
  { id: 'automation', label: 'Automatisation' },
  { id: 'settings', label: 'Réglages' },
];

export function getViewTitle(view: MainView): string {
  return MAIN_NAV.find((n) => n.id === view)?.label ?? 'Klanvio';
}
