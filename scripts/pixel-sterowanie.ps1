# Pixel przez scrcpy ZE STEROWANIEM (mysz + klawiatura z PC ida do telefonu).
# Uwaga: kliki/wpisywanie w okno trafiaja do telefonu - moga kolidowac z innym agentem.
# Uruchom: prawy klik -> "Run with PowerShell"

$adb = "C:\Users\razor\Android\platform-tools\adb.exe"
$scrcpy = Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Recurse -Filter "scrcpy.exe" -ErrorAction SilentlyContinue | Select-Object -First 1

if (-not $scrcpy) { Write-Host "Nie znaleziono scrcpy.exe. Zainstaluj: winget install Genymobile.scrcpy" -ForegroundColor Red; exit 1 }

$devices = & $adb devices | Select-String "device$"
if (-not $devices) { Write-Host "Brak podlaczonego urzadzenia adb. Podlacz Pixela i wlacz debugowanie USB." -ForegroundColor Red; exit 1 }

Write-Host "Uruchamiam scrcpy ZE STEROWANIEM..." -ForegroundColor Green
& $scrcpy.FullName --window-title Pixel-sterowanie --stay-awake --max-fps=30
