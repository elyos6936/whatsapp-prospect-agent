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
      },
    },
  ],
};
