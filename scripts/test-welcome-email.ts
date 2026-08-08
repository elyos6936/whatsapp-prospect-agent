/**
 * Tests purs email de bienvenue (sans Resend).
 * Run: npx tsx scripts/test-welcome-email.ts
 */
import {
  buildWelcomeEmailHtml,
  buildWelcomeEmailText,
  welcomeFirstName,
  WELCOME_TRIAL_DAYS,
} from "../src/mail/welcome.js";

let passed = 0;
let failed = 0;

function assert(cond: boolean, label: string) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.error(`  ✗ ${label}`);
  }
}

console.log("\n=== Welcome email ===\n");
assert(welcomeFirstName("Florent Avagbo") === "Florent", "first name");
assert(welcomeFirstName("") === "", "empty name");
assert(WELCOME_TRIAL_DAYS === 3, "trial days");

const text = buildWelcomeEmailText({
  firstName: "Florent",
  appUrl: "https://www.klanvio.com/app",
  trialDays: 3,
});
assert(text.includes("Bonjour Florent,"), "text hello");
assert(text.includes("3 jours"), "text trial");
assert(text.includes("https://www.klanvio.com/app"), "text app url");

const html = buildWelcomeEmailHtml({
  firstName: "Florent",
  appUrl: "https://www.klanvio.com/app",
  trialDays: 3,
});
assert(html.includes("Bienvenue, Florent"), "html title");
assert(html.includes("Ouvrir Klanvio"), "html CTA");
assert(html.includes("#2057CE"), "html brand color");

const textNoName = buildWelcomeEmailText({
  firstName: "",
  appUrl: "https://www.klanvio.com/app",
  trialDays: 3,
});
assert(textNoName.startsWith("Bonjour,"), "text without name");

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
