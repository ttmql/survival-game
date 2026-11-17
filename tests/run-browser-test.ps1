# ============================================================================
# 无头 Chrome/Edge 交互测试启动器。
# 用法：
#   powershell -ExecutionPolicy Bypass -File .\tests\run-browser-test.ps1
# 可选参数：
#   -Port    调试端口（默认 9333）
#   -Seed    测试种子（默认 1A2B3C4D）
#   -Profile Chrome 用户数据目录（默认 .chrome-cdp，测试后自动删除）
# 说明：URL 带 &mute=1，让 AudioDirector 跳过真实音频调度，保证时序稳定。
# ============================================================================

param(
  [int]$Port = 9333,
  [string]$Seed = "1A2B3C4D",
  [string]$Profile = ".chrome-cdp",
  [ValidateSet("browser-check.mjs", "buildings-browser.mjs", "rooms-browser.mjs", "water-browser.mjs", "inventory-browser.mjs", "debug-browser.mjs", "gift-browser.mjs", "farming-browser.mjs", "lucian-browser.mjs", "night-browser.mjs", "enderman-browser.mjs", "portal-browser.mjs", "performance-browser.mjs", "modes-browser.mjs")]
  [string]$CheckScript = "browser-check.mjs"
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$gamePath = Join-Path $root "index.html"
$profile = [System.IO.Path]::GetFullPath((Join-Path $root $Profile))
# The test profile is disposable, but it must stay in its dedicated workspace directory.
$profileName = Split-Path -Leaf $profile
if ((Split-Path -Parent $profile) -ne $root -or $profileName -notmatch '^\.chrome-cdp(?:-[a-zA-Z0-9_-]+)?$') {
  throw "The browser profile must be a .chrome-cdp directory directly inside the workspace."
}

$chromeCandidates = @(
  "C:\Program Files\Google\Chrome\Application\chrome.exe",
  "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
  "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
  "C:\Program Files\Microsoft\Edge\Application\msedge.exe"
)
$chrome = $chromeCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1

if (-not $chrome) {
  throw "Chrome or Edge was not found, so the browser test cannot run."
}

if (Test-Path -LiteralPath $profile) {
  Remove-Item -LiteralPath $profile -Recurse -Force
}

$resolvedGame = (Resolve-Path -LiteralPath $gamePath).Path
$gameUri = [System.Uri]$resolvedGame
$url = $gameUri.AbsoluteUri + "?seed=" + [Uri]::EscapeDataString($Seed) + "&mute=1"

$arguments = @(
  "--headless=new",
  "--no-sandbox",
  "--disable-gpu",
  "--disable-crash-reporter",
  "--disable-breakpad",
  "--no-first-run",
  "--disable-background-timer-throttling",
  "--disable-renderer-backgrounding",
  "--hide-scrollbars",
  "--window-size=1440,1000",
  "--force-device-scale-factor=1",
  "--remote-debugging-port=$Port",
  "--remote-allow-origins=*",
  "--user-data-dir=$profile",
  "about:blank"
)

$browser = Start-Process -FilePath $chrome -ArgumentList $arguments -WindowStyle Hidden -PassThru
Start-Sleep -Milliseconds 1600

try {
  & node (Join-Path $PSScriptRoot $CheckScript) $Port $url
  $exitCode = $LASTEXITCODE
}
finally {
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = "SilentlyContinue"
  taskkill.exe /PID $browser.Id /T /F 2>$null | Out-Null
  Start-Sleep -Milliseconds 500
  $ErrorActionPreference = $previousPreference
}

exit $exitCode
