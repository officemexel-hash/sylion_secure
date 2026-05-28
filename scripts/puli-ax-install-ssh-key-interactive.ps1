param(
  [string]$RouterIp = "192.168.8.1",
  [string]$User = "root",
  [string]$PublicKeyPath = ".deploy\sylion_puli_ax_ed25519.pub"
)

$ErrorActionPreference = "Stop"

Write-Host "SYLION Puli AX SSH key installer" -ForegroundColor Cyan
Write-Host "This script never asks Codex to know or store the router password." -ForegroundColor Yellow
Write-Host "You will be prompted by SSH. Type the router admin/root password in this window only." -ForegroundColor Yellow

if (!(Test-Path -LiteralPath $PublicKeyPath)) {
  throw "Public key not found: $PublicKeyPath"
}

$publicKey = (Get-Content -LiteralPath $PublicKeyPath -Raw).Trim()
if ($publicKey -notmatch '^ssh-ed25519\s+') {
  throw "Unexpected public key format. Expected ssh-ed25519."
}

$remote = @"
set -eu
umask 077
mkdir -p /etc/dropbear
touch /etc/dropbear/authorized_keys
if ! grep -qxF '$publicKey' /etc/dropbear/authorized_keys 2>/dev/null; then
  printf '%s\n' '$publicKey' >> /etc/dropbear/authorized_keys
fi
chmod 700 /etc/dropbear
chmod 600 /etc/dropbear/authorized_keys
/etc/init.d/dropbear restart >/dev/null 2>&1 || true
echo sylion_puli_ax_key_installed
"@

ssh `
  -o PubkeyAuthentication=no `
  -o PreferredAuthentications=password,keyboard-interactive `
  -o StrictHostKeyChecking=accept-new `
  "$User@$RouterIp" `
  $remote

Write-Host "Now verifying key-only access..." -ForegroundColor Cyan
ssh `
  -i ".deploy\sylion_puli_ax_ed25519" `
  -o BatchMode=yes `
  -o PasswordAuthentication=no `
  -o StrictHostKeyChecking=accept-new `
  "$User@$RouterIp" `
  "echo sylion_puli_ax_key_auth_ok"

Write-Host "Done. Key auth is ready for Codex automation." -ForegroundColor Green
