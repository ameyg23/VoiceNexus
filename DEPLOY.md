# Deploying Voice Nexus for free (Oracle Cloud Always Free, or AWS Free Tier)

Zero application code changes needed — the app only reads addresses from `.env`/`.env.local`, nothing
is hardcoded. Same SQLite file, same `storage/recordings/` folder, same Twilio/Gemini/Resend accounts,
just pointed at a real server instead of your laptop + ngrok. `deploy/setup.sh` below is identical for
either provider — it's plain Ubuntu, nothing provider-specific.

## Part you have to do (account creation — I can't do this part)

**Option A — Oracle Cloud Always Free** (no time limit, needs a card for verification):
1. Create an account at oracle.com/cloud/free — the "Always Free" resources never bill, not a trial.
2. Create an **Always Free** compute instance: Ubuntu 22.04/24.04, the free "VM.Standard.E2.1.Micro"
   or "Ampere A1" shape. Note the public IP it gives you.
3. In that instance's security list / network security group, open inbound TCP ports **22, 80, 443**.
4. SSH in: `ssh ubuntu@<the public IP>`.

**Option B — AWS Free Tier** (free for 12 months, accepts UPI/net banking in India — no card needed):
1. Create an account at aws.amazon.com, pay via **UPI** at the payment-method step.
2. Launch an **EC2 instance**: Ubuntu 22.04/24.04, instance type **t2.micro** or **t3.micro** (free
   tier eligible). Create/download a key pair (`.pem` file) when prompted.
3. In the instance's **Security Group**, add inbound rules for ports **22, 80, 443**.
4. Note the instance's public IP, then SSH in: `ssh -i your-key.pem ubuntu@<public IP>`.

## Part I prepared (copy-paste from here)

Everything below is in this repo under `deploy/`:
- `deploy/setup.sh` — installs Node 24, nginx, certbot, pm2; clones the repo; installs deps; runs
  migrations + seed; builds the web app; starts both processes under pm2.
- `deploy/ecosystem.config.cjs` — pm2 process list (keeps both apps running, restarts on crash/reboot).
- `deploy/nginx.conf.example` — reverse proxy: `/api/*` → the Express server, everything else → Next.js.

Run on the VM:

```bash
curl -fsSL https://raw.githubusercontent.com/ameyg23/VoiceNexus/master/deploy/setup.sh -o setup.sh
bash setup.sh
```

First run stops after copying `.env.example` → `.env` so you can fill in real secrets. Edit
`~/voice-nexus/.env`:

```
GEMINI_API_KEY=...          # same key you already have
RESEND_API_KEY=...          # same key
RESEND_FROM_EMAIL=...
JWT_SECRET=<generate a new long random string>
PORT=4000
DEMO_MODE=true
WEB_ORIGIN=https://YOUR_HOST          # the nip.io or real domain you'll use below
TWILIO_ACCOUNT_SID=...       # same account
TWILIO_AUTH_TOKEN=...
TWILIO_CARE_LINE_NUMBER=...
PUBLIC_BASE_URL=             # leave blank — twilio:setup fills this in at the end
TWILIO_API_KEY_SID=
TWILIO_API_KEY_SECRET=
TWILIO_TWIML_APP_SID=
```

Also create `~/voice-nexus/apps/web/.env.local`:
```
NEXT_PUBLIC_API_URL=https://YOUR_HOST
NEXT_PUBLIC_DEMO_MODE=true
```

Re-run `bash setup.sh` — it now installs deps, migrates + seeds the DB, builds the web app, and starts
both under pm2.

### Get a free HTTPS cert (Twilio requires https for webhooks)

No domain needed — `nip.io` gives a free hostname for any IP with zero signup:
if your VM's IP is `123.45.67.89`, your host is `123.45.67.89.nip.io`.

```bash
sudo cp deploy/nginx.conf.example /etc/nginx/sites-available/voice-nexus
sudo sed -i 's/YOUR_HOST/123.45.67.89.nip.io/' /etc/nginx/sites-available/voice-nexus   # your real IP
sudo ln -s /etc/nginx/sites-available/voice-nexus /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d 123.45.67.89.nip.io    # free Let's Encrypt cert, auto-renews
```

### Point Twilio at the live server (same script you already use with ngrok)

```bash
cd ~/voice-nexus
npm run twilio:setup --workspace=apps/server -- https://123.45.67.89.nip.io
pm2 restart vn-server   # picks up the PUBLIC_BASE_URL the script just wrote to .env
```

### Verify before placing a real call (free, no Twilio minutes used)

```bash
npm run twilio:smoke --workspace=apps/server
```

All 16 checks should pass, same as it does locally against ngrok.

## What stays identical to your local setup

- SQLite DB and `storage/recordings/` live on the VM's real disk — persist across restarts/reboots,
  unlike most free-tier hosts.
- Same Gemini, Resend, Twilio accounts — just update which webhook URL Twilio calls (via `twilio:setup`
  above), nothing else changes account-side.
- Admin login, customer portal, browser-mic calling, phone calls, recordings, escalations — all the
  same code, so all the same behavior. The only difference from your laptop is the address.
- ngrok is no longer needed at all once this is live — that was only ever a stand-in for a real public
  address.

## Day-to-day on the VM

```bash
pm2 status            # see both processes
pm2 logs vn-server     # tail server logs
pm2 logs vn-web        # tail web logs
cd ~/voice-nexus && git pull && npm install && npm run build --workspace=apps/web && pm2 restart all
```
