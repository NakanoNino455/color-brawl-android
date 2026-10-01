# Color Brawl — real multi-touch probe.
#
# `adb shell input tap/swipe` can only synthesise ONE pointer, so it cannot exercise the
# multi-touch paths at all. This drives the emulator's touchscreen device directly through
# /dev/input with `sendevent`, emitting genuine concurrent MT protocol-B slots:
#
#   slot 0 = left thumb on the movement slider   (held down the whole time)
#   slot 1 = right thumb dragging the camera      (added while slot 0 is still down)
#   slot 2 = a third finger on FIRE               (added while 0 and 1 are both down)
#
# That is exactly the "move + look + fire" case the port has to survive.
#
# Usage:  .\mt-probe.ps1 -Action down|move|up|all
param(
    [ValidateSet('down', 'move', 'up', 'all')][string]$Action = 'all',
    [string]$Serial = 'emulator-5554'
)

$ADB = 'D:\Android SDK\platform-tools\adb.exe'

function Sh {
    param([string]$Cmd)
    & cmd.exe /c "`"$ADB`" -s $Serial $Cmd" 2>&1
}

# --- locate the touchscreen -------------------------------------------------
$devOut = Sh 'shell getevent -pl'
$lines = $devOut -split "`r?`n"
$dev = $null
for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match 'add device \d+: (/dev/input/event\d+)') { $cand = $Matches[1] }
    if ($lines[$i] -match 'name:\s+"(.+)"') { $name = $Matches[1] }
    if ($lines[$i] -match 'ABS_MT_POSITION_X') {
        if ($cand) { $dev = $cand; $devName = $name; break }
    }
}
if (-not $dev) { throw 'no multi-touch input device found on the emulator' }

# --- axis ranges (emulator touchscreen is 0..32767 on both axes) ------------
$maxX = 32767; $maxY = 32767

function Send {
    param([string]$Dev, [string]$Events)
    $cmd = "shell `"$Events`""
    Sh $cmd | Out-Null
}

function Ev {
    param([int]$type, [int]$code, [int]$value)
    "sendevent $dev $type $code $value"
}

function Slot {
    param([int]$id, [int]$x, [int]$y, [int]$pressure = 100)
    # EV_ABS=3: ABS_MT_SLOT=0x2f, ABS_MT_TRACKING_ID=0x39, ABS_MT_POSITION_X=0x35,
    #          ABS_MT_POSITION_Y=0x36, ABS_MT_PRESSURE=0x3a
    # EV_SYN=0: SYN_REPORT=0
    @(
        (Ev 3 0x2f $id)
        (Ev 3 0x39 $id)
        (Ev 3 0x35 $x)
        (Ev 3 0x36 $y)
        (Ev 3 0x3a $pressure)
    ) -join '; '
}

function Syn { (Ev 0 0 0) }

function Release {
    param([int]$id)
    @((Ev 3 0x2f $id), (Ev 3 0x39 -1)) -join '; '
}

# Screen geometry: 2400x1080 landscape. Normalised -> raw absolute units.
function Px { param([double]$fx) [int]([math]::Round($fx * $maxX)) }
function Py { param([double]$fy) [int]([math]::Round($fy * $maxY)) }

# Left thumb: joystick centre is ~ (0.13 * 1080, 1080 - 0.26*1080) in screen px.
# In normalised units: x ~0.058, y ~0.87.  Push it forward (screen up) => y decreases.
$LX = Px 0.058; $LY = Py 0.87
$LF = Py 0.68          # forward
$RX = Px 0.55;  $RY = Py 0.50
$R2 = Px 0.72;  $R2Y = Py 0.42
$FX = Px 0.905; $FY = Py 0.46   # FIRE button

Write-Host "touch device: $dev ($devName)" -ForegroundColor Cyan

if ($Action -in 'down', 'all') {
    Write-Host '--- slot 0: left thumb presses the movement slider ---'
    Sh ("shell `"$(Slot 0 $LX $LY); $(Syn)`"") | Out-Null
    Write-Host '--- slot 0 slides forward (movement) ---'
    Sh ("shell `"$(Slot 0 $LX $LF); $(Syn)`"") | Out-Null
    Start-Sleep -Milliseconds 250

    Write-Host '--- slot 1 added: right thumb drags the camera (while slot 0 held) ---'
    Sh ("shell `"$(Slot 1 $RX $RY); $(Syn)`"") | Out-Null
    for ($k = 1; $k -le 6; $k++) {
        Sh ("shell `"$(Slot 1 ($RX + $k * 900) ($RY - $k * 200)); $(Syn)`"") | Out-Null
        Start-Sleep -Milliseconds 40
    }

    Write-Host '--- slot 2 added: third finger on FIRE (while 0 and 1 held) ---'
    Sh ("shell `"$(Slot 2 $FX $FY); $(Syn)`"") | Out-Null
    Start-Sleep -Milliseconds 900
    Write-Host '--- MULTI-TOUCH: move + look + fire all active simultaneously ---'
    for ($k = 1; $k -le 8; $k++) {
        Sh ("shell `"$(Slot 1 ($RX + $k * 1200) ($RY - $k * 150)); $(Slot 0 $LX ($LF + $k * 60)); $(Syn)`"") | Out-Null
        Start-Sleep -Milliseconds 90
    }
}

if ($Action -in 'up', 'all') {
    Write-Host '--- releasing, highest slot first (as a real multi-touch lift does) ---'
    Sh ("shell `"$(Release 2); $(Slot 0 $LX $LF); $(Syn)`"") | Out-Null
    Start-Sleep -Milliseconds 120
    Sh ("shell `"$(Release 1); $(Slot 0 $LX $LF); $(Syn)`"") | Out-Null
    Start-Sleep -Milliseconds 120
    Sh ("shell `"$(Release 0); $(Syn)`"") | Out-Null
    Write-Host 'all pointers released'
}
