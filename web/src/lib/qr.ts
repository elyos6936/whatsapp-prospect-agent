/**
 * Construit une source d'image valide pour un QR code renvoyé par l'API.
 * Evolution renvoie parfois le base64 nu, parfois déjà préfixé par
 * `data:image/...;base64,`. On évite ainsi le double préfixe (image cassée).
 */
export function qrImageSrc(base64: string): string {
  const value = base64.trim();
  if (value.startsWith('data:')) return value;
  return `data:image/png;base64,${value}`;
}
