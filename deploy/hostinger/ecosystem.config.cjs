// Charge /opt/klanvio/.env pour injecter ADMIN_* (et le reste) dans PM2.
try {
  require("dotenv").config({ path: "/opt/klanvio/.env" });
} catch {
  /* dotenv optionnel au boot PM2 */
}

module.exports = {
  apps: [
    {
      name: "klanvio-api",
      script: "npm",
      args: "run start",
      cwd: "/opt/klanvio",
      instances: 1,
      autorestart: true,
      max_memory_restart: "512M",
      env: {
        NODE_ENV: "production",
        PORT: "3001",
        ...(process.env.ADMIN_EMAIL
          ? { ADMIN_EMAIL: process.env.ADMIN_EMAIL }
          : {}),
        ...(process.env.ADMIN_PASSWORD
          ? { ADMIN_PASSWORD: process.env.ADMIN_PASSWORD }
          : {}),
        ...(process.env.ADMIN_PASSWORD_HASH
          ? { ADMIN_PASSWORD_HASH: process.env.ADMIN_PASSWORD_HASH }
          : {}),
      },
    },
  ],
};
