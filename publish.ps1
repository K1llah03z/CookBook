<#
  publish.ps1  -  upload the cookbook site to GitHub (GitHub Pages serves the docs\ folder).

  Every run:
    - bumps the app version in docs\sw.js so installed phones pick up the update
    - commits everything and pushes to GitHub
    - with -Server, also redeploys the timer-alert server (only needed if you changed push-server\)

  Usage (from this folder):
      powershell -ExecutionPolicy Bypass -File .\publish.ps1
      powershell -ExecutionPolicy Bypass -File .\publish.ps1 -Message "Added my own recipes"
      powershell -ExecutionPolicy Bypass -File .\publish.ps1 -Server
  First run asks for your GitHub repository address and sets everything up.
#>
param(
  [string]$Message = "",
  [switch]$Server
)

$ErrorActionPreference = "Continue"
Set-Location -LiteralPath $PSScriptRoot
$utf8 = New-Object System.Text.UTF8Encoding($false)
function Say($text, $color = "Cyan") { Write-Host ""; Write-Host "==> $text" -ForegroundColor $color }
function Fail($text) { Write-Host ""; Write-Host "STOPPED: $text" -ForegroundColor Red; exit 1 }

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Fail "Git is not installed. Install it from https://git-scm.com/download/win (default options), reopen PowerShell, and run this again."
}
if (-not (Test-Path "docs\index.html")) { Fail "Run this from the cookbook folder (the one with docs\ in it)." }

# ---- first run: make this folder a git repo connected to GitHub
if (-not (Test-Path ".git")) {
  Say "First run: connecting this folder to your GitHub repository"
  $remote = ""
  while (-not $remote) { $remote = Read-Host "Repository address (example: https://github.com/yourname/carnivore-cookbook.git)" }
  & git init | Out-Null
  & git symbolic-ref HEAD refs/heads/main
  & git remote add origin $remote
  if (-not (& git config user.name))  { & git config user.name  (Read-Host "Your name for GitHub commits") }
  if (-not (& git config user.email)) { & git config user.email (Read-Host "Your GitHub email (or the no-reply address from GitHub settings)") }
}
$branch = (& git rev-parse --abbrev-ref HEAD 2>$null)
if (-not $branch -or $branch -eq "HEAD") { $branch = "main" }

# ---- bump the service-worker version so phones update
$swPath = Join-Path $PSScriptRoot "docs\sw.js"
$sw = [IO.File]::ReadAllText($swPath)
# Version = year.month.DDNN  (day of the month + that day's build number, e.g. 2026.11.2601, 2026.11.2602)
$now = Get-Date
$prefix = "{0}.{1}.{2}" -f $now.Year, $now.Month, $now.Day
$cur = [regex]::Match($sw, 'const VERSION = "([^"]*)";').Groups[1].Value
$n = 1
$m = [regex]::Match($cur, '^' + [regex]::Escape($prefix) + '(\d{2})$')
if ($m.Success) { $n = [int]$m.Groups[1].Value + 1 }
$ver = $prefix + $n.ToString("00")
$sw = [regex]::Replace($sw, 'const VERSION = "[^"]*";', "const VERSION = `"$ver`";")
[IO.File]::WriteAllText($swPath, $sw, $utf8)
Say "App version $ver  (was $cur)"

# ---- optional: redeploy the alert server
if ($Server) {
  if (-not (Test-Path "push-server\.vapid-keys.json")) { Fail "Run setup-push.ps1 first." }
  Say "Redeploying the timer-alert server..."
  Push-Location push-server
  & npx wrangler deploy
  $code = $LASTEXITCODE
  Pop-Location
  if ($code -ne 0) { Fail "Server deploy failed (see messages above)." }
}

# ---- safety: never upload keys
$bad = & git ls-files --cached --others --exclude-standard | Where-Object { $_ -match '\.vapid-keys\.json$|\.dev\.vars$|(^|/)\.wrangler/|node_modules/' }
if ($bad) { Fail "These private files would be uploaded: $($bad -join ', '). Check .gitignore." }

# ---- commit and push
if (-not $Message) { $Message = "Update cookbook " + (Get-Date -Format "yyyy-MM-dd HH:mm") }
& git add -A
& git commit -m $Message | Out-Host
Say "Uploading to GitHub..."
& git push -u origin $branch
if ($LASTEXITCODE -ne 0) {
  Write-Host "GitHub has changes this folder doesn't (for example a README made on github.com). Combining them..." -ForegroundColor Yellow
  & git pull --rebase origin $branch
  if ($LASTEXITCODE -ne 0) { Fail "Couldn't combine automatically. Run 'git status' to see what's different, or ask for help." }
  & git push -u origin $branch
  if ($LASTEXITCODE -ne 0) { Fail "Push failed. If GitHub asked you to sign in, finish that and run this again." }
}

$url = (& git remote get-url origin)
Say "Uploaded!" "Green"
if ($url -match 'github\.com[:/]+([^/]+)/([^/.]+)') {
  $pages = "https://$($Matches[1]).github.io/$($Matches[2])/"
  Write-Host "Site (after GitHub finishes building, about 1 minute): $pages"
  Write-Host "First time only: on GitHub open the repo -> Settings -> Pages -> Branch: $branch, folder: /docs -> Save."
}
