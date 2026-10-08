# How to start Voice Nexus

Open a terminal in the project folder, then:

## First time only

```
npm install
npm run db:migrate
npm run db:seed
```

## Every time

```
npm run dev
```

This starts both the frontend and the backend.

- Website: http://localhost:3000
- Backend: http://localhost:4000

## For real phone calls (optional)

```
ngrok http 4000
npm run twilio:setup --workspace=apps/server -- https://YOUR-NGROK-URL
```

Then restart `npm run dev`.

## If a port is stuck

```
Get-Process node | Stop-Process -Force
```
