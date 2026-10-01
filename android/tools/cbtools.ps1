# Color Brawl — Android build/install/test helpers.
# Dot-source this file:  . .\tools\cbtools.ps1
#
# ADB INVOCATION STRATEGY
# -----------------------
# Every adb call goes through cmd.exe with a single quoted command string, never through
# `& $adb @array`. PowerShell's argument binder intercepts tokens that look like its own
# parameters — `-p` (PipelineVariable), `-c`, `-s` (Scope) — and silently strips them, so
# `adb shell monkey -p <pkg> -c LAUNCHER 1` arrives at adb as `monkey -c LAUNCHER 1`, and
# `adb logcat -c` arrives as `adb logcat`. Quoting for cmd.exe sidesteps all of it.
#
# Screenshots use cmd.exe redirection for the same class of reason: PowerShell's `>`
# re-encodes native stdout, producing a 6.3 MB UTF-16 file instead of a 3.2 MB PNG.

$script:CB_SDK   = 'D:\Android SDK'
$script:CB_ADB   = "$script:CB_SDK\platform-tools\adb.exe"
$script:CB_PROJ  = 'C:\Users\Administrator\Desktop\dp\project\Color-Brawl-Android'
$script:CB_PKG   = 'com.colorbrawl.android'
$script:CB_SERIAL = 'emulator-5554'
$script:CB_LOG   = 'C:\Users\Administrator\Desktop\dp\logs'
$script:CB_SHOTS = "$script:CB_LOG\shots"

$env:JAVA_HOME = 'D:\Android Studio\jbr'
$env:ANDROID_HOME = $script:CB_SDK
$env:ANDROID_SDK_ROOT = $script:CB_SDK

$script:CB_ADB_SHIM = Join-Path $PSScriptRoot 'cb-adb.cmd'

function CB-Adb {
    <#
      .SYNOPSIS  Run adb against the emulator. Arguments are passed as ONE string.
      .EXAMPLE   CB-Adb 'shell input tap 1200 540'
      .EXAMPLE   CB-Adb 'logcat -d -v time'
      .NOTES
        Start-Process runs tools\cb-adb.cmd as a real process whose command line is built by
        .NET, not by PowerShell's argument binder. That binder is the whole problem: it
        consumes tokens matching its own parameters, so `monkey -p <pkg>` loses its `-p`
        (alias of -PipelineVariable) and even adb's `-s <serial>`. Calling the .cmd directly
        with `&` does not work either — PowerShell hands it the entire string as one argument.
    #>
    param([Parameter(Mandatory, Position = 0)][string]$AdbArgs)
    $out = Start-Process -FilePath $script:CB_ADB_SHIM -ArgumentList $AdbArgs `
        -NoNewWindow -Wait -PassThru `
        -RedirectStandardOutput "$env:TEMP\cb-adb-out.txt" `
        -RedirectStandardError "$env:TEMP\cb-adb-err.txt"
    $o = @(Get-Content "$env:TEMP\cb-adb-out.txt" -ErrorAction SilentlyContinue)
    $e = @(Get-Content "$env:TEMP\cb-adb-err.txt" -ErrorAction SilentlyContinue)
    Remove-Item "$env:TEMP\cb-adb-out.txt", "$env:TEMP\cb-adb-err.txt" -Force -ErrorAction SilentlyContinue
    # adb writes some informational output to stderr; surface it as data, not as a failure
    return @($o + $e | Where-Object { "$_" -ne '' })
}

function CB-Build {
    param([ValidateSet('debug', 'release')][string]$Variant = 'debug')
    Push-Location $script:CB_PROJ
    try {
        $task = if ($Variant -eq 'release') { 'assembleRelease' } else { 'assembleDebug' }
        $out = & .\gradlew.bat $task --console=plain 2>&1 | Out-String
        $code = $LASTEXITCODE
        $out -split "`r?`n" | Select-Object -Last 10 | ForEach-Object { Write-Host $_ }
        if ($code -ne 0) { throw "gradle $task failed (exit $code)" }
        $apk = Join-Path $script:CB_PROJ "app\build\outputs\apk\$Variant\app-$Variant.apk"
        if (-not (Test-Path $apk)) { throw "APK not produced: $apk" }
        Write-Host "APK: $apk  ($([math]::Round((Get-Item $apk).Length/1MB,2)) MB)" -ForegroundColor Green
        return $apk
    } finally { Pop-Location }
}

function CB-Install {
    param([string]$Apk = (Join-Path $script:CB_PROJ 'app\build\outputs\apk\debug\app-debug.apk'))
    if (-not (Test-Path $Apk)) { throw "APK not found: $Apk" }
    $out = (CB-Adb "install -r `"$Apk`"") -join "`n"
    Write-Host $out.Trim()
    if ($out -notmatch 'Success') { throw 'install failed' }
}

function CB-Launch {
    <#
      .SYNOPSIS  Launch Color Brawl, optionally straight into a match.
      .DESCRIPTION
        With -Query, launches through ACTION_VIEW with a URL carrying that query string.
        WebViewAssetLoader matches on path only, so the query reaches the page and the
        game's own documented parameters work: ?autostart=<seconds>, &mode=turf|zones|boss,
        &difficulty=chill|fresh|fierce, &map=<id>, &skipTitle, &autopilot.
      .EXAMPLE   CB-Launch -Query '?autostart=180&mode=turf&difficulty=fresh&skipTitle'
    #>
    param(
        [string]$Query = '',
        [switch]$FreshData,
        [switch]$KeepLogcat
    )
    if ($FreshData) {
        CB-Adb "shell pm clear $script:CB_PKG" | Out-Null
        Write-Host 'app data cleared (localStorage reset)'
    } else {
        CB-Adb "shell am force-stop $script:CB_PKG" | Out-Null
    }
    if (-not $KeepLogcat) { CB-Adb 'logcat -c' | Out-Null }
    if ($Query) {
        # Query parameters are delivered as intent extras, not as -d <url>: on a device an
        # http(s) URL passed to `am start -d` is routed to the default browser, so Chrome
        # opened instead of this app (observed). MainActivity appends them to the entry URL.
        $extras = ''
        foreach ($pair in ($Query.TrimStart('?') -split '&')) {
            if ($pair -eq '') { continue }
            $kv = $pair -split '=', 2
            $k = $kv[0]
            $v = if ($kv.Count -gt 1) { $kv[1] } else { '1' }
            if ($v -eq '1' -or $v -eq 'true') {
                $extras += " --ez cb_$k true"
            } else {
                $extras += " --es cb_$k `"$v`""
            }
        }
        CB-Adb "shell am start -n $script:CB_PKG/.MainActivity$extras" | Out-Null
        Write-Host "launched with: $Query"
    } else {
        # `am start -n <component>` instead of `monkey -p <pkg> -c <category>`: fewer flags to
        # trip over, and it is deterministic about which activity starts.
        CB-Adb "shell am start -n $script:CB_PKG/.MainActivity" | Out-Null
        Write-Host 'launched (launcher)'
    }
}

function CB-Shot {
    param([Parameter(Mandatory)][string]$Name)
    New-Item -ItemType Directory -Force -Path $script:CB_SHOTS | Out-Null
    $f = Join-Path $script:CB_SHOTS "$Name.png"
    Remove-Item $f -Force -ErrorAction SilentlyContinue
    & cmd.exe /c "`"$script:CB_ADB`" -s $script:CB_SERIAL exec-out screencap -p > `"$f`"" 2>&1 | Out-Null
    $b = [System.IO.File]::ReadAllBytes($f)
    if ($b[0] -ne 0x89 -or $b[1] -ne 0x50) { throw "screenshot is not a PNG: $f" }
    Write-Host "shot: $f  ($([math]::Round($b.Length/1KB,0)) KB)" -ForegroundColor Green
    return $f
}

function CB-Tap {
    param([Parameter(Mandatory)][int]$X, [Parameter(Mandatory)][int]$Y)
    CB-Adb "shell input tap $X $Y" | Out-Null
    Write-Host "tap ($X,$Y)"
}

function CB-Logs {
    param([string]$Pattern = 'ColorBrawl|CB/ERROR|CB/WARNING', [int]$Last = 40)
    $out = (CB-Adb 'logcat -d -v time') -join "`n"
    $out -split "`r?`n" | Select-String -Pattern $Pattern | Select-Object -Last $Last |
        ForEach-Object { $_.Line }
}

function CB-Errors {
    $out = (CB-Adb 'logcat -d -v time') -join "`n"
    $out -split "`r?`n" |
        Select-String -Pattern 'CB/ERROR|FATAL EXCEPTION|E/ColorBrawl|Uncaught|Unhandled promise' |
        ForEach-Object { $_.Line }
}

function CB-MemInfo {
    $out = (CB-Adb "shell dumpsys meminfo $script:CB_PKG") -join "`n"
    $m = [regex]::Match($out, 'TOTAL PSS:\s*(\d+)')
    if ($m.Success) {
        $kb = [int]$m.Groups[1].Value
        Write-Host ("TOTAL PSS: {0:N0} KB ({1:N1} MB)" -f $kb, ($kb / 1024))
    } else { Write-Host ($out -split "`n" | Select-Object -First 20) }
}

function CB-Fps {
    param([int]$Seconds = 10)
    CB-Adb "shell dumpsys gfxinfo $script:CB_PKG reset" | Out-Null
    Start-Sleep -Seconds $Seconds
    $out = (CB-Adb "shell dumpsys gfxinfo $script:CB_PKG") -join "`n"
    $total = [regex]::Match($out, 'Total frames rendered:\s*(\d+)')
    $janky = [regex]::Match($out, 'Janky frames:\s*(\d+)')
    if ($total.Success) {
        $n = [int]$total.Groups[1].Value
        Write-Host ("frames in ${Seconds}s: {0}  =>  {1:N1} fps" -f $n, ($n / $Seconds))
    } else { Write-Host 'no frame stats (is the app running and rendering?)' }
    if ($janky.Success) { Write-Host ("janky frames: {0}" -f $janky.Groups[1].Value) }
}

function CB-Back {
    CB-Adb 'shell input keyevent KEYCODE_BACK' | Out-Null
    Write-Host 'back'
}

Write-Host 'Color Brawl tools: CB-Build CB-Install CB-Launch CB-Shot CB-Tap CB-Back CB-Logs CB-Errors CB-MemInfo CB-Fps' -ForegroundColor Cyan
