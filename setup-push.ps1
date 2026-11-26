<#
  setup-push.ps1  -  one-time setup of lock-screen timer alerts (free Cloudflare Worker).

  What it does:
    1. Installs the Cloudflare tool (wrangler) inside push-server\
    2. Signs you in to Cloudflare (a browser window opens the first time)
    3. Makes the alert keys (VAPID) once and keeps them in push-server\.vapid-keys.json (never uploaded to GitHub)
    4. Deploys the alert server and stores the private key as a Cloudflare secret
    5. Writes the server address into docs\config.js so the site uses it

  Run it from PowerShell in this folder:
      powershell -ExecutionPolicy Bypass -File .\setup-push.ps1
  Then run publish.ps1 to put the updated site on GitHub.
  Safe to run again: it reuses the same keys, so phones that already turned alerts on keep working.
#>
param(
  [string]$SiteUrl = ""   # your GitHub Pages address, e.g. https://brandon.github.io/carnivore-cookbook
)

$ErrorActionPreference = "Continue"
Set-Location -LiteralPath $PSScriptRoot
$utf8 = New-Object System.Text.UTF8Encoding($false)

function Say($text, $color = "Cyan") { Write-Host ""; Write-Host "==> $text" -ForegroundColor $color }
function Fail($text) { Write-Host ""; Write-Host "STOPPED: $text" -ForegroundColor Red; exit 1 }
function Run-Text {
  # Runs a native command, shows its output live, and returns the output as one string.
  param([scriptblock]$Cmd)
  $lines = & $Cmd 2>&1 | ForEach-Object { $s = "$_"; Write-Host $s; $s }
  return ($lines -join "`n")
}

# ---- 0. checks
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Fail "Node.js is not installed. Install the LTS version from https://nodejs.org, then close and reopen PowerShell and run this again."
}
if (-not (Test-Path "push-server\wrangler.toml")) { Fail "Run this from the folder that contains push-server\ and docs\." }
if (-not (Test-Path "docs\index.html")) { Fail "docs\index.html not found. Run this from the cookbook folder." }

# ---- 1. site address (for CORS: only your site may schedule alerts)
$saved = "push-server\.site-url"
if (-not $SiteUrl -and (Test-Path $saved)) { $SiteUrl = (Get-Content $saved -Raw).Trim() }
while (-not $SiteUrl) {
  $SiteUrl = Read-Host "Your GitHub Pages address (example: https://yourname.github.io/carnivore-cookbook)"
}
try { $u = [Uri]$SiteUrl } catch { Fail "That doesn't look like a web address: $SiteUrl" }
if ($u.Scheme -ne "https") { Fail "The address must start with https://" }
$origin = $u.GetLeftPart([UriPartial]::Authority)
[IO.File]::WriteAllText((Join-Path $PSScriptRoot $saved), $SiteUrl, $utf8)
Say "Site: $SiteUrl  (alerts allowed from $origin)"

Push-Location push-server
try {
  # ---- 2. install wrangler (local to this folder)
  Say "Installing the Cloudflare tool (first run takes a minute)..."
  & npm install --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { Fail "npm install failed. Check your internet connection and try again." }

  # ---- 3. sign in to Cloudflare
  Say "Checking your Cloudflare sign-in..."
  $who = Run-Text { npx wrangler whoami }
  if ($who -match "not authenticated|You are not logged in") {
    Say "A browser window will open. Sign in (or create a free account) and click Allow." "Yellow"
    & npx wrangler login
    if ($LASTEXITCODE -ne 0) { Fail "Cloudflare sign-in did not finish. Run this script again." }
  }

  # ---- 4. alert keys (made once, reused forever)
  if (Test-Path ".vapid-keys.json") {
    Say "Using your existing alert keys (.vapid-keys.json)"
    $keys = Get-Content ".vapid-keys.json" -Raw | ConvertFrom-Json
  } else {
    Say "Making your alert keys..."
    $json = (& node gen-vapid.mjs) -join ""
    if ($LASTEXITCODE -ne 0 -or -not $json) { Fail "Couldn't make the keys (node gen-vapid.mjs)." }
    $keys = $json | ConvertFrom-Json
    [IO.File]::WriteAllText((Join-Path (Get-Location) ".vapid-keys.json"), $json, $utf8)
    Write-Host "Saved push-server\.vapid-keys.json  (keep a copy somewhere safe; it is NOT uploaded to GitHub)" -ForegroundColor Yellow
  }
  if (-not $keys.publicKey -or -not $keys.privateJwk) { Fail ".vapid-keys.json looks damaged. Delete it and run again (phones will need to turn alerts on again)." }

  # ---- 5. settings in wrangler.toml
  $tomlPath = Join-Path (Get-Location) "wrangler.toml"
  $toml = [IO.File]::ReadAllText($tomlPath)
  $toml = [regex]::Replace($toml, '(?m)^ALLOWED_ORIGINS = ".*"$', "ALLOWED_ORIGINS = `"$origin`"")
  $toml = [regex]::Replace($toml, '(?m)^VAPID_PUBLIC_KEY = ".*"$', "VAPID_PUBLIC_KEY = `"$($keys.publicKey)`"")
  $toml = [regex]::Replace($toml, '(?m)^VAPID_SUBJECT = ".*"$', "VAPID_SUBJECT = `"$SiteUrl`"")
  [IO.File]::WriteAllText($tomlPath, $toml, $utf8)

  # ---- 6. deploy
  Say "Deploying the alert server to Cloudflare..."
  Write-Host "(If it asks you to pick a workers.dev subdomain, choose any name; it's free.)" -ForegroundColor Yellow
  & npx wrangler deploy                     # run live so any first-time questions show up
  if ($LASTEXITCODE -ne 0) { Fail "Deploy failed (see the messages above)." }
  Say "Reading the server address..."
  $dep = Run-Text { npx wrangler deploy }   # quick repeat (no questions now) to capture the address
  if ($LASTEXITCODE -ne 0) { Fail "Deploy failed (see the messages above)." }
  $workerUrl = [regex]::Match($dep, 'https://[A-Za-z0-9.-]+\.workers\.dev').Value
  if (-not $workerUrl) {
    $workerUrl = Read-Host "Couldn't read the server address from the output. Paste it here (https://...workers.dev)"
  }
  $workerUrl = $workerUrl.TrimEnd("/")

  # ---- 7. private key -> Cloudflare secret (piped, never shown on screen)
  Say "Storing the private key as a Cloudflare secret..."
  $keys.privateJwk | & npx wrangler secret put VAPID_PRIVATE_JWK
  if ($LASTEXITCODE -ne 0) { Fail "Couldn't save the secret. Run this script again." }
}
finally { Pop-Location }

# ---- 8. tell the site where the server is
$cfg = "/* Timer-alert server address. setup-push.ps1 fills this in. Leave empty to use in-app alerts only. */`nwindow.EKC_PUSH = { server: `"$workerUrl`" };`n"
[IO.File]::WriteAllText((Join-Path $PSScriptRoot "docs\config.js"), $cfg, $utf8)

# ---- 9. quick check
Say "Checking the server..."
try {
  $h = Invoke-RestMethod -Uri "$workerUrl/health" -TimeoutSec 20
  $v = Invoke-RestMethod -Uri "$workerUrl/vapid" -TimeoutSec 20
  if ($h.ok -and $v.publicKey -eq $keys.publicKey) { Write-Host "Server is up and using your keys." -ForegroundColor Green }
  else { Write-Host "Server answered, but the key doesn't match yet. Wait a minute and run this again." -ForegroundColor Yellow }
} catch { Write-Host "Couldn't reach $workerUrl yet (new servers can take a minute). That's usually fine." -ForegroundColor Yellow }

Say "Done! Alert server: $workerUrl" "Green"
Write-Host "Next:"
Write-Host "  1. Run   powershell -ExecutionPolicy Bypass -File .\publish.ps1   to upload the site."
Write-Host "  2. On your phone open $SiteUrl (iPhone: add it to the Home Screen and open it from the icon),"
Write-Host "     then tap the timer button -> Turn on lock-screen alerts -> Settings -> Send a test alert."
