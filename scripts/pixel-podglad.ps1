# Podglad ekranu Pixela przez scrcpy (tryb tylko-podglad, bez sterowania).
# Uruchom: prawy klik -> "Run with PowerShell", albo: powershell -ExecutionPolicy Bypass -File .\scripts\pixel-podglad.ps1

$adb = "C:\Users\razor\Android\platform-tools\adb.exe"
$scrcpy = Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Recurse -Filter "scrcpy.exe" -ErrorAction SilentlyContinue | Select-Object -First 1

if (-not $scrcpy) { Write-Host "Nie znaleziono scrcpy.exe. Zainstaluj: winget install Genymobile.scrcpy" -ForegroundColor Red; exit 1 }

# Sprawdz czy telefon jest podlaczony
$devices = & $adb devices | Select-String "device$"
if (-not $devices) { Write-Host "Brak podlaczonego urzadzenia adb. Podlacz Pixela i wlacz debugowanie USB." -ForegroundColor Red; exit 1 }

Write-Host "Uruchamiam podglad..." -ForegroundColor Green
# Uwaga: --stay-awake nie dziala razem z --no-control (scrcpy to blokuje), wiec go nie ma.
& $scrcpy.FullName --no-control --window-title Pixel-podglad --max-fps=30
