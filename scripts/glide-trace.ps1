<#
.SYNOPSIS
    One command for tracing Glide's player on a connected device.

.DESCRIPTION
    Enables the player's verbose tracing, prints a snapshot of the playback service and
    media session, then tails the player log together with crashes. Everything else on the
    device is silenced.

    Tracing is read once when the player's classes load, so the app is restarted to pick
    it up unless -NoRestart is given.

.EXAMPLE
    .\scripts\glide-trace.ps1
    Full trace of everything the player does.

.EXAMPLE
    .\scripts\glide-trace.ps1 -Filter "SERVICE|SESSION|ENGINE"
    Only the media session and native player lifecycle.

.EXAMPLE
    .\scripts\glide-trace.ps1 -Snapshot
    Print the service and session state and exit, without tailing.

.EXAMPLE
    .\scripts\glide-trace.ps1 -Off
    Turn tracing back off, so release-level logging resumes.
#>
[CmdletBinding()]
param(
    # Regex applied to the log stream. Omit to see everything.
    [string] $Filter,
    # Also write the session to this file.
    [string] $LogFile,
    # Print the service/session snapshot and exit.
    [switch] $Snapshot,
    # Keep the app running instead of restarting it to pick up tracing.
    [switch] $NoRestart,
    # Disable tracing and exit.
    [switch] $Off
)

$ErrorActionPreference = 'Stop'
$package = 'com.glide.app'
$tag = 'GlideVLC'

if (-not (Get-Command adb -ErrorAction SilentlyContinue)) {
    throw "adb is not on PATH. Add <sdk>\platform-tools to PATH, or run it from there."
}
if (-not (adb devices | Select-String -Pattern '\bdevice$')) {
    throw "No device is connected. Check 'adb devices'."
}

if ($Off) {
    adb shell setprop "log.tag.$tag" INFO
    adb shell am force-stop $package
    Write-Host "Tracing off. Relaunch the app." -ForegroundColor Yellow
    return
}

function Show-Snapshot {
    Write-Host "`n=== playback service ===" -ForegroundColor Cyan
    $service = adb shell dumpsys activity services $package |
        Select-String -Pattern 'GlidePlaybackService|isForeground|ServiceRecord'
    if ($service) { $service } else { Write-Host "  not running" -ForegroundColor DarkGray }

    Write-Host "`n=== media session ===" -ForegroundColor Cyan
    $session = adb shell dumpsys media_session | Select-String -Pattern $package -Context 0, 8
    if ($session) { $session } else { Write-Host "  no session registered" -ForegroundColor DarkGray }

    Write-Host "`n=== notifications posted ===" -ForegroundColor Cyan
    $notes = adb shell dumpsys notification --noredact | Select-String -Pattern $package -Context 0, 3
    if ($notes) { $notes } else { Write-Host "  none" -ForegroundColor DarkGray }

    Write-Host "`n=== granted permissions ===" -ForegroundColor Cyan
    adb shell dumpsys package $package |
        Select-String -Pattern 'android.permission\.[A-Z_]+: granted=true' |
        ForEach-Object { "  " + ($_ -replace '.*android\.permission\.', '') }
}

if ($Snapshot) {
    Show-Snapshot
    return
}

adb shell setprop "log.tag.$tag" VERBOSE
if (-not $NoRestart) {
    # The trace flag is read when the player's classes load, so a running process keeps
    # whatever it started with.
    adb shell am force-stop $package
    Write-Host "Tracing on, app stopped. Open Glide now." -ForegroundColor Green
} else {
    Write-Host "Tracing on. It applies from the next app launch." -ForegroundColor Yellow
}

Show-Snapshot

Write-Host "`n=== log (Ctrl+C to stop) ===" -ForegroundColor Cyan
adb logcat -c
$stream = { adb logcat -v time -s $tag 'AndroidRuntime:E' }

$pipeline = & $stream
if ($Filter) { $pipeline = $pipeline | Select-String -Pattern $Filter }
if ($LogFile) { $pipeline | Tee-Object -FilePath $LogFile } else { $pipeline }
