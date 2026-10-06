# NuggetVPN installer for Windows.
#
#   irm https://raw.githubusercontent.com/Rigby-Foundation/NuggetVPN/main/scripts/install.ps1 | iex
#
# Downloads the latest release's installer from GitHub, checks it against the
# SHA-256 GitHub publishes for it, installs it silently (one UAC prompt), and
# starts the app. Running it again updates an existing install in place.

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue' # Invoke-WebRequest is many times slower with the bar
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Repo = 'Rigby-Foundation/NuggetVPN'

function Say($text) { Write-Host "  $text" }

if (-not [Environment]::Is64BitOperatingSystem) {
    throw 'NuggetVPN needs 64-bit Windows.'
}
if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') {
    Say 'ARM64 Windows: installing the x64 build, which runs under emulation.'
}

Say 'Looking up the latest release...'
$release = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest" `
    -Headers @{ 'User-Agent' = 'NuggetVPN-install'; 'Accept' = 'application/vnd.github+json' }
$asset = $release.assets | Where-Object { $_.name -like '*-windows-amd64-installer.exe' } | Select-Object -First 1
if (-not $asset) {
    throw "Release $($release.tag_name) has no Windows installer."
}

$target = Join-Path $env:TEMP $asset.name
Say "Downloading $($asset.name) ($([math]::Round($asset.size / 1MB, 1)) MB)..."
Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $target -UseBasicParsing `
    -Headers @{ 'User-Agent' = 'NuggetVPN-install' }

# GitHub records each asset's SHA-256 as "sha256:<hex>". Older releases may
# predate that; then there is nothing to compare against.
if ($asset.digest -and $asset.digest.StartsWith('sha256:')) {
    $expected = $asset.digest.Substring(7).ToLowerInvariant()
    $actual = (Get-FileHash -Algorithm SHA256 -Path $target).Hash.ToLowerInvariant()
    if ($actual -ne $expected) {
        Remove-Item $target -Force
        throw "The download does not match its published checksum; not installing."
    }
    Say 'Checksum verified.'
}

Say 'Installing (Windows will ask for permission)...'
$process = Start-Process -FilePath $target -ArgumentList '/S' -Verb RunAs -Wait -PassThru
Remove-Item $target -Force -ErrorAction SilentlyContinue
if ($process.ExitCode -ne 0) {
    throw "The installer stopped with code $($process.ExitCode)."
}

# Where it went: the installer records the program in the uninstall list.
$keyName = 'Rigby FoundationNuggetVPN'
$executable = $null
foreach ($root in 'HKLM:', 'HKCU:') {
    $key = "$root\Software\Microsoft\Windows\CurrentVersion\Uninstall\$keyName"
    if (Test-Path $key) {
        $executable = (Get-ItemProperty -Path $key -Name DisplayIcon -ErrorAction SilentlyContinue).DisplayIcon
        if ($executable) { break }
    }
}
if (-not $executable) {
    $executable = Join-Path $env:ProgramFiles 'Rigby Foundation\NuggetVPN\NuggetVPN.exe'
}

Say "NuggetVPN $($release.tag_name) is installed."
if (Test-Path $executable) {
    # Started from this (non-elevated) shell, so it runs as the user.
    Start-Process -FilePath $executable
}
