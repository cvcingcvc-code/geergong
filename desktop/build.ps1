# Gorgon Workbench — Windows desktop build (Phase 8).
#
# Produces a ONEDIR bundle at:
#     release/Gorgon-Workbench-Windows/Gorgon Workbench.exe
#
# onedir (not onefile) is deliberate: onefile unpacks to a temp dir on every
# launch, which is slower and more fragile with a bundled webview. For a
# competition build, stability beats file count.
#
# Usage:
#     powershell -ExecutionPolicy Bypass -File desktop/build.ps1

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Desktop  = Join-Path $RepoRoot "desktop"
$AppDist  = Join-Path $RepoRoot "app\dist"
$OutDir   = Join-Path $RepoRoot "release"
$BuildDir = Join-Path $RepoRoot "build\pyinstaller"
$Name     = "Gorgon Workbench"

# The interpreter MUST be the one that has pyinstaller + pywebview installed.
# `python` on PATH is often a different (managed) install, so allow an explicit
# override and fail loudly instead of producing a broken bundle.
$Python = $env:GORGON_PYTHON
if (-not $Python) { $Python = "python" }

Write-Host "[build] repo: $RepoRoot"
Write-Host "[build] python: $Python"

& $Python -c "import PyInstaller, webview" 2>$null
if ($LASTEXITCODE -ne 0) {
    throw "Python '$Python' lacks pyinstaller/webview. Install: $Python -m pip install -r desktop/requirements-desktop.txt  (or set GORGON_PYTHON)"
}
Write-Host "[build] toolchain OK"

# ── 1. frontend must be built ────────────────────────────────────────────
if (-not (Test-Path (Join-Path $AppDist "index.html"))) {
    Write-Host "[build] app/dist missing -> running vite build"
    Push-Location (Join-Path $RepoRoot "app")
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "vite build failed" }
    Pop-Location
} else {
    Write-Host "[build] app/dist present, reusing"
}

if (-not (Test-Path (Join-Path $AppDist "index.html"))) {
    throw "app/dist/index.html still missing after build"
}

# ── 2. python deps ───────────────────────────────────────────────────────
Write-Host "[build] installing desktop requirements"
& $Python -m pip install --quiet --disable-pip-version-check -r (Join-Path $Desktop "requirements-desktop.txt")
if ($LASTEXITCODE -ne 0) { throw "pip install failed" }

# ── 3. pyinstaller (onedir) ──────────────────────────────────────────────
# Bundled data:
#   app/dist          -> the built Workbench frontend
#   pipeline          -> the search API the launcher starts
# NOTE: no .env, no key file, no secret is bundled. Provide a model key via
# the host environment only (GORGON_AI_API_KEY).
$sep = ";"
$addData = @(
    "$AppDist${sep}app/dist",
    "$(Join-Path $RepoRoot 'pipeline')${sep}pipeline"
)

$iconArgs = @()
$iconPath = Join-Path $Desktop "icon.ico"
if (Test-Path $iconPath) { $iconArgs = @("--icon", $iconPath) }

Write-Host "[build] running pyinstaller (onedir)"
& $Python -m PyInstaller `
    --noconfirm `
    --clean `
    --windowed `
    --name "$Name" `
    --distpath $OutDir `
    --workpath $BuildDir `
    --specpath $BuildDir `
    @iconArgs `
    --add-data $addData[0] `
    --add-data $addData[1] `
    --hidden-import webview `
    --hidden-import pipeline.api.server `
    (Join-Path $Desktop "main.py")

if ($LASTEXITCODE -ne 0) { throw "pyinstaller failed" }

$target = Join-Path $OutDir "Gorgon-Workbench-Windows"
if (Test-Path (Join-Path $OutDir $Name)) {
    if (Test-Path $target) { Remove-Item -Recurse -Force $target }
    Rename-Item -Path (Join-Path $OutDir $Name) -NewName "Gorgon-Workbench-Windows"
}

$exe = Join-Path $target "Gorgon Workbench.exe"
if (Test-Path $exe) {
    Write-Host "[build] OK -> $exe"
} else {
    throw "expected exe not found at $exe"
}
