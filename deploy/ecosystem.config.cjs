// pm2 process list — keeps both apps running persistently and restarts them on crash or VM reboot
// (`pm2 startup` + `pm2 save`). Run from the repo root: `pm2 start deploy/ecosystem.config.cjs`.
module.exports = {
  apps: [
    {
      name: "vn-server",
      cwd: __dirname + "/..",
      script: "npm",
      args: "run start --workspace=apps/server",
      env: { NODE_ENV: "production" },
    },
    {
      name: "vn-web",
      cwd: __dirname + "/..",
      script: "npm",
      args: "run start --workspace=apps/web",
      env: { NODE_ENV: "production" },
    },
  ],
};
