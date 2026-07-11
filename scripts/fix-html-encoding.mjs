import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const htmlPath = path.join(__dirname, "..", "public", "index.html");
let html = fs.readFileSync(htmlPath, "utf8");

const replacements = [
  ["Retour Ã  l'Ã©quipe", "Retour à l'équipe"],
  ["â†\u008d Ã‰quipe", "← Équipe"],
  ["Votre Ã©quipe dâ€™agents IA", "Votre équipe d'agents IA"],
  ["Â« ", "« "],
  [" Â»", " »"],
  ["â€¦", "…"],
  ["intÃ©ressÃ©", "intéressé"],
  ["ArrÃªte", "Arrête"],
  ["rÃ©ponse", "réponse"],
  ["numÃ©ro", "numéro"],
  ["rÃ©pondu", "répondu"],
  ["prospection Ã  +229", "prospection à +229"],
  ["+229â€¦", "+229…"],
  ["Donnez une instruction Ã  l'agent WhatsAppâ€¦", "Donnez une instruction à l'agent WhatsApp…"],
];

for (const [from, to] of replacements) {
  html = html.split(from).join(to);
}

const hintsBlock = `              <ul class="hints">
                <li>« Poste le statut WhatsApp : Dieu est grand »</li>
                <li>« Liste mes contacts »</li>
                <li>« Enregistre +229… , boutique mode, statut intéressé »</li>
                <li>« Arrête toute réponse auto avec +229… »</li>
                <li>« Bloque +229… » / « Passe ce numéro en STOP »</li>
                <li>« Qu'est-ce que +229… a répondu ? »</li>
                <li>« Envoie un message de prospection à +229… »</li>
                <li>« Liste mes groupes WhatsApp » / « Liste les chaines WhatsApp »</li>
              </ul>`;

html = html.replace(/<ul class="hints">[\s\S]*?<\/ul>/, hintsBlock);

fs.writeFileSync(htmlPath, html, "utf8");
console.log("index.html encoding fixed");
