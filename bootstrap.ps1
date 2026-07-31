[CmdletBinding()]
param(
    [switch]$Start
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $projectRoot

if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) {
    throw 'Node.js 20 or newer is required.'
}

$arguments = @('scripts/bootstrap.mjs')
if ($Start) {
    $arguments += '--start'
}

& node.exe @arguments
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}
