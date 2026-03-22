$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$venvPython = Join-Path $root ".venv\Scripts\python.exe"
$frontendDir = Join-Path $root "frontend"

if (!(Test-Path $venvPython)) {
  Write-Host "Missing .venv. Run .\install\install.ps1 first." -ForegroundColor Yellow
  exit 1
}

$backend = Start-Process -FilePath $venvPython -ArgumentList "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000", "--reload" -WorkingDirectory $root -PassThru
$frontend = Start-Process -FilePath "npm" -ArgumentList "run", "dev", "--", "--host", "127.0.0.1", "--port", "5173" -WorkingDirectory $frontendDir -PassThru

Write-Host "Backend PID: $($backend.Id)"
Write-Host "Frontend PID: $($frontend.Id)"
Write-Host "Open http://127.0.0.1:5173"
Write-Host "Press Ctrl+C to stop both."

try {
  while ($true) {
    Start-Sleep -Seconds 2
  }
} finally {
  if (!$backend.HasExited) { Stop-Process -Id $backend.Id -Force }
  if (!$frontend.HasExited) { Stop-Process -Id $frontend.Id -Force }
}
