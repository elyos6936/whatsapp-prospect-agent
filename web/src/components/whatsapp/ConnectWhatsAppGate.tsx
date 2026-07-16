import { WhatsAppConnectModal } from '@/components/whatsapp/WhatsAppConnectModal';
import { KlanvioLogo } from '@/components/brand/KlanvioLogo';

/** Écran bloquant : fond soft + popup centrée pour connecter WhatsApp. */
export function ConnectWhatsAppGate() {
  return (
    <div className="relative flex min-h-full flex-col items-center justify-center bg-bg-0 px-4 py-10">
      <div className="pointer-events-none select-none text-center opacity-40">
        <div className="mb-4 flex justify-center">
          <KlanvioLogo variant="full" size="lg" />
        </div>
        <p className="text-sm text-text-400">Connexion WhatsApp requise pour utiliser Klanvio</p>
      </div>
      <WhatsAppConnectModal
        open
        dismissible={false}
        title="Connecter votre WhatsApp"
        subtitle="Sans connexion, l’agent ne peut effectuer aucune action. Scannez le QR avec WhatsApp → Appareils connectés → Lier un appareil."
      />
    </div>
  );
}
