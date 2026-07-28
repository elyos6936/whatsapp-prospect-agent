import "dotenv/config";
import { sql } from "../src/pg.js";

const email = "fotsingpaulette0@gmail.com";
const rows = await sql<{ id: number; email: string; name: string; onboarding_completed: boolean }[]>`
  SELECT id, email, name, onboarding_completed FROM users WHERE lower(email) = lower(${email})
`;
if (rows.length) {
  console.log("Compte trouvé:", JSON.stringify(rows[0]));
} else {
  console.log("Aucun compte pour", email, "— créez-en un via « Créer un compte ».");
}
await sql.end({ timeout: 5 });
