$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$python = Get-Command py -ErrorAction SilentlyContinue
if ($python) {
  & py -3 "$root/install/install.py" @args
} else {
  & python "$root/install/install.py" @args
}
