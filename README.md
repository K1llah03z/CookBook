# Easy Keto Carnivore Cookbook

2,500 easy keto carnivore recipes as an installable, offline web app, plus an optional free timer-alert server, so kitchen timers alert your phone's lock screen even when the app is closed.

```
docs/          the website (GitHub Pages serves this folder)
push-server/   the timer-alert server (free Cloudflare Worker)
setup-push.ps1 one-time setup of timer alerts
publish.ps1    upload the site to GitHub (run after any change)
```

## What you need (one time)
- **Git for Windows**: https://git-scm.com/download/win (default options)
- **Node.js LTS**: https://nodejs.org (only needed for the timer-alert server)
- A free **GitHub** account and a free **Cloudflare** account (you can create the Cloudflare one during setup)

## Step 1: Create the GitHub repository
On github.com, click **New repository**, name it (for example `carnivore-cookbook`), make it **Public**, and click **Create**. Copy its address, for example `https://github.com/yourname/carnivore-cookbook.git`.

## Step 2: Open PowerShell in this folder
In File Explorer open this folder, click the address bar, type `powershell` and press Enter.
(If Windows says the scripts are blocked, run `Get-ChildItem *.ps1 | Unblock-File` once.)

## Step 3: Turn on timer alerts (optional, free)
```powershell
powershell -ExecutionPolicy Bypass -File .\setup-push.ps1
```
- It asks for your site address: `https://yourname.github.io/carnivore-cookbook` (your GitHub username + repo name).
- A browser opens to sign in to Cloudflare; click **Allow**.
- If asked to choose a **workers.dev subdomain**, type any name.
- It saves your alert keys in `push-server\.vapid-keys.json`. Keep a copy somewhere safe. It is never uploaded to GitHub. If you lose it, run setup again; phones just need to turn alerts on again.

Skip this step and the cookbook still works; timers then alert only while the app is open.

## Step 4: Upload the site
```powershell
powershell -ExecutionPolicy Bypass -File .\publish.ps1
```
The first time, it asks for the repository address from Step 1 plus your name and email for commits. Git may open a GitHub sign-in window.

Then, **first time only**: on GitHub open the repo → **Settings → Pages** → *Build and deployment*: **Deploy from a branch**, branch **main**, folder **/docs** → **Save**. After about a minute the site is live at `https://yourname.github.io/carnivore-cookbook/`.

## Step 5: On your phone
- **iPhone/iPad** (iOS 16.4+): open the site in **Safari** → **Share** → **Add to Home Screen**, then open it **from the new icon**. Tap the ⏱ button → **Turn on lock-screen alerts** → **Allow**.
- **Android**: open the site in Chrome → menu **⋮** → **Install app**. Tap ⏱ → **Turn on lock-screen alerts** → **Allow**.
- Check it: **Settings → Timer alerts → Send a test alert**, then lock the phone. It should buzz in about 2 seconds.

## Updating later
Change anything, then run `publish.ps1` again (add `-Message "what changed"` if you like). It bumps the app version automatically so installed phones update.
Changed something in `push-server\`? Run `publish.ps1 -Server` to redeploy it too.

## Features
Search everything (phrases, `-exclude`, `protein>40`, `calories<500`, `carbs<2`, `time<=20`), filters and sorting, recipe pages with nutrition, serving scaler, step timers, cook mode, ♥ Favorites / ☆ Want to try / 👍 liked / 👎 didn't like lists, meal planner with daily goals, combined shopping list, "What can I make?", dark mode, backup/restore, offline, and lock-screen timer alerts.

## About the timer-alert server
- Runs on Cloudflare's **free** Workers plan (100,000 requests/day; one timer uses about 2-3). If a limit were ever hit, alerts would pause for the rest of that day. Nothing is charged unless you upgrade yourself.
- It stores only each phone's push address and its pending timers (name + end time), and deletes each timer as soon as its alert is sent.
- Only your site's address may schedule alerts (set by `setup-push.ps1`).
- Apple and Google deliver the alerts using standard Web Push. No Apple developer account is needed.

Nutrition values are estimates per serving from USDA data for the listed ingredients. General cooking inspiration, not medical advice.
