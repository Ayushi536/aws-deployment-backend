// ecosystem.config.js
// PM2 process manager config
// Run once on EC2:
//   pm2 start ecosystem.config.js --env production
//   pm2 startup   → run the output command (makes PM2 start on reboot)
//   pm2 save      → saves current process list to survive reboots

module.exports = {
  apps: [
    {
      name: "aws-deployment-backend",  // name shown in pm2 list
      script: "./app.js",

      instances: 1,          // use "max" for cluster mode (one per CPU core)
      exec_mode: "fork",     // change to "cluster" if instances > 1

      autorestart: true,     // auto-restart if the process crashes
      watch: false,          // don't watch files (use deploys for updates)

      max_memory_restart: "512M",  // restart if memory exceeds 512MB (memory leak guard)
      max_restarts: 10,            // stop restarting after 10 consecutive crashes

      env: {
        NODE_ENV: "development",
        PORT: 3000,
      },

      env_production: {
        NODE_ENV: "production",
        PORT: 3000,
      },
    },
  ],
};
