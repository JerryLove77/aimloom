$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 3.0

$installerRoot = Split-Path $PSScriptRoot -Parent
$service = Join-Path $installerRoot 'gui/kvk-gui-service.ps1'
if (-not [IO.File]::Exists($service)) { throw 'GUI service is missing.' }
. (Join-Path $installerRoot 'kvk-engine.ps1')
# The worker loads the scheme adapter between the engine and the service; mirror that order.
. (Join-Path $installerRoot 'kvk-scheme.ps1')
. (Join-Path $installerRoot 'kvk-audio.ps1')
. (Join-Path $installerRoot 'kvk-crosshair.ps1')
. (Join-Path $installerRoot 'kvk-enemy.ps1')
. (Join-Path $installerRoot 'kvk-import.ps1')
. (Join-Path $installerRoot 'kvk-profile-apply.ps1')
. $service
. (Join-Path $PSScriptRoot 'helpers/gui-fixture.ps1')

function Assert($Condition, [string]$Message) { if (-not $Condition) { throw $Message } }

Invoke-WithKvkGuiFixture {
    param($f)

    # Break caught: malformed or extensible protocol inputs reach an engine operation.
    $badRoot = Invoke-KvkGuiRequest -Session $f.Session -Request @('not-an-object')
    Assert (-not $badRoot.ok -and $badRoot.error.code -eq 'ENGINE_ERROR') 'Array request roots must be rejected.'
    $unknown = Invoke-KvkGuiRequest -Session $f.Session -Request @{v=1;requestId='bad-op';op='removeEverything';args=@{}}
    Assert (-not $unknown.ok -and $unknown.error.code -eq 'ENGINE_ERROR') 'Unknown operations must be rejected.'
    $override = Invoke-KvkGuiRequest -Session $f.Session -Request @{
        v=1;requestId='override';op='locate';args=@{gameRoot=$f.GameRoot;localDataRoot=$f.LocalDataRoot}
    }
    Assert (-not $override.ok) 'A request must not override LocalApplicationData.'
    $negativeRevision = Invoke-KvkGuiRequest -Session $f.Session -Request @{
        v=1;requestId='negative';op='planInstall';args=@{gameRoot=$f.GameRoot;packRoot=$f.PackRoot;categories=@('sounds');revision=-1}
    }
    Assert (-not $negativeRevision.ok) 'Negative revisions must be rejected.'
    $duplicateCategories = Invoke-KvkGuiRequest -Session $f.Session -Request @{
        v=1;requestId='duplicate';op='planInstall';args=@{gameRoot=$f.GameRoot;packRoot=$f.PackRoot;categories=@('sounds','sounds');revision=1}
    }
    Assert (-not $duplicateCategories.ok) 'Duplicate categories must be rejected.'

    # Break caught: a one-row preview collapses its arrays or leaks engine casing.
    $preview = Invoke-KvkGuiRequest -Session $f.Session -Request @{
        v=1;requestId='p1';op='planInstall';args=@{
            gameRoot=$f.GameRoot;packRoot=$f.PackRoot;categories=@('sounds');revision=7
        }
    }
    Assert ($preview.ok) 'Install preview failed.'
    Assert (@($preview.data.rows).Count -eq 1) 'One-row previews must keep rows as an array.'
    Assert (@($preview.data.categories).Count -eq 1) 'One-category previews must keep categories as an array.'
    Assert ($preview.data.rows[0].key -eq 'sounds/hit.wav' -and $null -ne $preview.data.rows[0].PSObject.Properties['conflict']) 'Preview row DTO is incomplete.'

    # Break caught: generating a new preview leaves the old opaque plan executable.
    $oldId = $preview.data.planId
    $newPreview = Invoke-KvkGuiRequest -Session $f.Session -Request @{
        v=1;requestId='p2';op='planInstall';args=@{
            gameRoot=$f.GameRoot;packRoot=$f.PackRoot;categories=@('sounds');revision=8
        }
    }
    $oldRun = Invoke-KvkGuiRequest -Session $f.Session -Request @{
        v=1;requestId='e-old';op='execute';args=@{
            operationId='op-old';planId=$oldId;confirmation='install';allowConflicts=$false
        }
    }
    Assert (-not $oldRun.ok -and $oldRun.error.code -eq 'PLAN_MISSING') 'Superseded planId was accepted.'

    # Break caught: target bytes changed after preview are overwritten.
    [IO.File]::WriteAllText($f.Target, 'external edit', [Text.UTF8Encoding]::new($false))
    $run = Invoke-KvkGuiRequest -Session $f.Session -Request @{
        v=1;requestId='e1';op='execute';args=@{
            operationId='op1';planId=$newPreview.data.planId;confirmation='install';allowConflicts=$false
        }
    }
    Assert (-not $run.ok -and $run.error.code -eq 'PLAN_STALE') 'Changed preview was accepted.'
    Assert ([IO.File]::ReadAllText($f.Target) -ceq 'external edit') 'Rejected stale preview changed target bytes.'
}

Invoke-WithKvkGuiFixture {
    param($f)
    $preview = Invoke-KvkGuiRequest -Session $f.Session -Request @{
        v=1;requestId='p3';op='planInstall';args=@{gameRoot=$f.GameRoot;packRoot=$f.PackRoot;categories=@('sounds');revision=1}
    }
    $events = [Collections.Generic.List[object]]::new()
    $run = Invoke-KvkGuiRequest -Session $f.Session -Request @{
        v=1;requestId='e3';op='execute';args=@{operationId='op3';planId=$preview.data.planId;confirmation='install';allowConflicts=$false}
    } -Observer { param($event) $events.Add($event) }
    Assert ($run.ok -and $run.data.status -eq 'completed') 'Valid cached plan did not execute.'
    Assert ($run.data.batchId -match '^[a-f0-9]{32}$') 'Execution must expose the durable engine batch identifier.'
    Assert (@($run.data.items).Count -eq 1 -and @($run.data.errors).Count -eq 0) 'Execution arrays are malformed.'
    Assert (@($events).Count -gt 0) 'Execute did not forward engine observations.'

    $backups = Invoke-KvkGuiRequest -Session $f.Session -Request @{v=1;requestId='b1';op='backups';args=@{gameRoot=$f.GameRoot}}
    Assert ($backups.ok -and @($backups.data.records).Count -eq 1 -and $backups.data.hasPristine) 'Backup index omitted validated records or pristine state.'
    Assert (@($backups.data.records[0].categories).Count -eq 1 -and $backups.data.records[0].fileCount -eq 1) 'Backup DTO omitted manifest details.'
}

# Break caught: the native worker accepts non-object JSON, unknown fields, or writes non-JSON business output.
$worker = Join-Path $installerRoot 'gui/kvk-gui-worker.ps1'
if (-not [IO.File]::Exists($worker)) { throw 'GUI worker is missing.' }
$powershell = (Get-Process -Id $PID).Path
$lines = @(
    '[]',
    '{"v":1,"requestId":"native-1","op":"gameState","args":{},"extra":true}',
    '{"v":1,"requestId":"native-2","op":"gameState","args":{}}'
) | & $powershell -NoProfile -File $worker
Assert ($LASTEXITCODE -eq 0) 'Idle EOF must shut down the worker cleanly.'
Assert (@($lines).Count -eq 3) 'Worker must return exactly one reply for each input line.'
$native = @($lines | ForEach-Object { ConvertFrom-Json -InputObject $_ -ErrorAction Stop })
Assert (-not $native[0].ok -and -not $native[1].ok) 'Malformed native requests were accepted.'
Assert ($native[2].ok -and $native[2].data -in @('closed','running','unknown')) 'Native gameState reply is invalid.'

Microsoft.PowerShell.Utility\Write-Host 'PASS: GUI protocol validation, opaque plan cache, stale-plan protection, DTO arrays and JSONL worker.'

Invoke-WithKvkGuiFixture {
 param($f)
 foreach($version in @('1',$true)) {
  $reply=Invoke-KvkGuiRequest -Session $f.Session -Request @{v=$version;requestId='bad-version';op='gameState';args=@{}}
  Assert (-not $reply.ok) 'Protocol version must be an integer, not coerced string/bool.'
 }
 $unclassified=[InvalidOperationException]::new('backup preview changed after preview')
 $mapped=Get-KvkGuiMappedIssue $unclassified
 Assert ($mapped.code -eq 'ENGINE_ERROR') 'English words must not turn an unclassified execution failure into a safe preflight rejection.'
}

# Break caught: the scheme operations bypass the typed boundary, accept a path instead of a
# theme file name, or allow a scheme preview to execute an unchecked plan.
Invoke-WithKvkGuiFixture {
    param($f)
    $settings = @'
{
	"booleanSettings":
	{
		"EBooleanSettingId::OverrideAllNewMapMaterials": false,
		"EBooleanSettingId::SolidSkyColor": false,
		"EBooleanSettingId::ShowSunInSkybox": true
	},
	"integerSettings":
	{
		"EIntegerSettingId::FloorMat": 0,
		"EIntegerSettingId::SkyPreset": 6,
		"EIntegerSettingId::CloudCover": 0,
		"EIntegerSettingId::WallMat": 50
	},
	"floatSettings":
	{
		"EFloatSettingId::XSens": 0.91,
		"EFloatSettingId::WallRoughness": 1,
		"EFloatSettingId::WallMetallic": 1,
		"EFloatSettingId::WallFullBright": 0.5,
		"EFloatSettingId::WallTextureScale": 1,
		"EFloatSettingId::FloorRoughness": 1,
		"EFloatSettingId::FloorMetallic": 0,
		"EFloatSettingId::FloorFullBright": 0.3,
		"EFloatSettingId::FloorTextureScale": 1,
		"EFloatSettingId::CeilingRoughness": 1,
		"EFloatSettingId::CeilingMetallic": 0,
		"EFloatSettingId::CeilingFullBright": 0.3,
		"EFloatSettingId::CeilingTextureScale": 1,
		"EFloatSettingId::RampRoughness": 1,
		"EFloatSettingId::RampMetallic": 0,
		"EFloatSettingId::RampFullBright": 0.5,
		"EFloatSettingId::RampTextureScale": 1
	},
	"stringSettings":
	{
		"EStringSettingId::CurrentThemeName": "Old",
		"EStringSettingId::WallMaterial": "DRYWALL",
		"EStringSettingId::FloorMaterial": "GRID 8",
		"EStringSettingId::CeilingMaterial": "DRYWALL",
		"EStringSettingId::RampMaterial": "DRYWALL"
	},
	"vectorSettings":
	{
		"EVectorSettingId::WallColor": {"x": 1, "y": 1, "z": 1},
		"EVectorSettingId::FloorColor": {"x": 1, "y": 1, "z": 1},
		"EVectorSettingId::CeilingColor": {"x": 1, "y": 1, "z": 1},
		"EVectorSettingId::RampColor": {"x": 1, "y": 1, "z": 1}
	},
	"colorSettings":
	{
		"EColorSettingId::SkyColor": {"r": 1, "g": 2, "b": 3, "a": 255}
	}
}
'@
    $primary = Join-Path $f.GameRoot 'FPSAimTrainer/Saved/SaveGames/PrimaryUserSettings.json'
    Write-KvkGuiFixtureText $primary $settings
    $themes = Join-Path $f.GameRoot 'FPSAimTrainer/Saved/SaveGames/Themes'
    Write-KvkGuiFixtureText (Join-Path $themes 'Blue.json') '{"themeName":"Blue","wallMaterial":"CONCRETE TILES","wallRoughness":0.25,"wallMetallic":0,"wallFullBright":0.5,"wallTint":{"x":0.1,"y":0.2,"z":0.9},"wallTextureScale":2.5,"floorMaterial":"WOOD PARQUET","floorRoughness":0.75,"floorMetallic":0.1,"floorFullBright":0,"floorTint":{"x":0.3,"y":0.4,"z":0.5},"floorTextureScale":3,"ceilingMaterial":"METAL SHEET","ceilingRoughness":1,"ceilingMetallic":1,"ceilingFullBright":0.9,"ceilingTint":{"x":0.6,"y":0.7,"z":0.8},"ceilingTextureScale":0.5,"rampMaterial":"PURE COLOR","rampRoughness":0.5,"rampMetallic":0.5,"rampFullBright":0.25,"rampTint":{"x":0.9,"y":0.1,"z":0.2},"rampTextureScale":1.5,"skyPresetId":2,"cloudCoverId":4,"solidSkyColor":true,"sunVisible":false,"skyColor":{"b":20,"g":30,"r":40,"a":255}}'
    Write-KvkGuiFixtureText (Join-Path $themes 'Broken.json') '{ not json'
    $original = [IO.File]::ReadAllText($primary)

    foreach ($bad in @(
        @{gameRoot=$f.GameRoot;file='../../secret.json';revision=1},
        @{gameRoot=$f.GameRoot;file='Blue.txt';revision=1},
        @{gameRoot=$f.GameRoot;file='Blue.json';revision=-1},
        @{gameRoot=$f.GameRoot;file='Blue.json';revision=1;extra=1}
    )) {
        $reply = Invoke-KvkGuiRequest -Session $f.Session -Request @{v=1;requestId='bad-scheme';op='planScheme';args=$bad}
        Assert (-not $reply.ok) "An unsafe scheme preview request was accepted: $($bad.file)"
    }
    $extra = Invoke-KvkGuiRequest -Session $f.Session -Request @{v=1;requestId='bad-list';op='schemeList';args=@{gameRoot=$f.GameRoot;extra=1}}
    Assert (-not $extra.ok) 'schemeList accepted an unknown argument.'

    $list = Invoke-KvkGuiRequest -Session $f.Session -Request @{v=1;requestId='list';op='schemeList';args=@{gameRoot=$f.GameRoot}}
    Assert ($list.ok) 'schemeList failed.'
    Assert (@($list.data.themes).Count -eq 2) 'Both theme files must be listed.'
    Assert ($list.data.current -eq 'Old') 'The current theme must come from the settings file.'
    $blue = @($list.data.themes | Where-Object {$_.file -eq 'Blue.json'})[0]
    Assert ($blue.name -eq 'Blue' -and $blue.readable -and -not $blue.duplicateName) 'A readable theme DTO is incomplete.'
    $broken = @($list.data.themes | Where-Object {$_.file -eq 'Broken.json'})[0]
    Assert (-not $broken.readable -and $null -eq $broken.name) 'An unreadable theme must be listed without a name.'

    $preview = Invoke-KvkGuiRequest -Session $f.Session -Request @{v=1;requestId='ps';op='planScheme';args=@{gameRoot=$f.GameRoot;file='Blue.json';revision=3}}
    Assert ($preview.ok) 'planScheme failed.'
    Assert ($preview.data.kind -eq 'install' -and @($preview.data.rows).Count -eq 1) 'A scheme preview must be one install-shaped row.'
    Assert ($preview.data.rows[0].category -eq 'primary') 'The scheme preview must target the primary settings category.'
    Assert ([IO.File]::ReadAllText($primary) -ceq $original) 'Preparing a scheme preview wrote game settings.'

    # Break caught: target bytes changed after the scheme preview are still overwritten.
    Write-KvkGuiFixtureText $primary ($original + ' ')
    $stale = Invoke-KvkGuiRequest -Session $f.Session -Request @{v=1;requestId='se';op='execute';args=@{operationId='scheme-stale';planId=$preview.data.planId;confirmation='install';allowConflicts=$false}}
    Assert (-not $stale.ok) 'A stale scheme plan was executed.'
    Assert ([IO.File]::ReadAllText($primary) -ceq ($original + ' ')) 'A rejected scheme execution wrote game settings.'

    Write-KvkGuiFixtureText $primary $original
    $fresh = Invoke-KvkGuiRequest -Session $f.Session -Request @{v=1;requestId='ps2';op='planScheme';args=@{gameRoot=$f.GameRoot;file='Blue.json';revision=4}}
    $run = Invoke-KvkGuiRequest -Session $f.Session -Request @{v=1;requestId='se2';op='execute';args=@{operationId='scheme-1';planId=$fresh.data.planId;confirmation='install';allowConflicts=$false}}
    Assert ($run.ok -and $run.data.status -eq 'completed') 'Scheme execution failed.'
    $after = ConvertFrom-Json ([IO.File]::ReadAllText($primary)) -AsHashtable
    Assert ($after.stringSettings['EStringSettingId::CurrentThemeName'] -eq 'Blue') 'The scheme was not applied.'
    Assert ($after.floatSettings['EFloatSettingId::XSens'] -eq 0.91) 'Scheme apply touched an unrelated setting.'
    Assert ($after.stringSettings['EStringSettingId::WallMaterial'] -eq 'CONCRETE TILES') 'The wall material was not applied.'

    $undo = Invoke-KvkGuiRequest -Session $f.Session -Request @{v=1;requestId='undo';op='planRestore';args=@{gameRoot=$f.GameRoot;sourceId=$run.data.batchId;revision=1}}
    Assert ($undo.ok) 'The scheme batch could not be planned for restore.'
    $restored = Invoke-KvkGuiRequest -Session $f.Session -Request @{v=1;requestId='undo2';op='execute';args=@{operationId='scheme-undo';planId=$undo.data.planId;confirmation='restore';allowConflicts=$false}}
    Assert ($restored.ok -and $restored.data.status -eq 'restored') 'The scheme batch could not be undone.'
    Assert ([IO.File]::ReadAllText($primary) -ceq $original) 'Undo did not restore the exact original bytes.'
}
Microsoft.PowerShell.Utility\Write-Host 'PASS: scheme listing, preview and replacement cross the typed boundary with an undoable batch.'

# Break caught: audio operations accept a name the game cannot resolve, the wrong value
# shape for an event, or execute a plan whose reviewed settings changed.
Invoke-WithKvkGuiFixture {
    param($f)
    $sounds = Join-Path $f.GameRoot 'FPSAimTrainer/sounds'
    foreach ($file in @('Bell5.ogg','spawn05.ogg','hit.wav','Twice.ogg','Twice.wav')) { Write-KvkGuiFixtureText (Join-Path $sounds $file) 'x' }
    $primary = Join-Path $f.GameRoot 'FPSAimTrainer/Saved/SaveGames/PrimaryUserSettings.json'
    $settings = @'
{
	"stringSettings":
	{
		"EStringSettingId::CurrentThemeName": "Old",
		"EStringSettingId::KillConfirmedSound": "saya;Bell5",
		"EStringSettingId::SpawnSound": "",
		"EStringSettingId::MBSGoodSound": "None",
		"EStringSettingId::MBSOkaySound": "None",
		"EStringSettingId::MBSBadSound": "None",
		"EStringSettingId::MBSChangeNowSound": "spawn05"
	}
}
'@
    Write-KvkGuiFixtureText $primary $settings
    $original = [IO.File]::ReadAllText($primary)

    foreach ($bad in @(
        @{gameRoot=$f.GameRoot;event='shoot';names=@('hit');revision=1},
        @{gameRoot=$f.GameRoot;event='mbsGood';names=@();revision=1},
        @{gameRoot=$f.GameRoot;event='mbsGood';names=@('hit','Bell5');revision=1},
        @{gameRoot=$f.GameRoot;event='kill';names=@('missing');revision=1},
        @{gameRoot=$f.GameRoot;event='kill';names=@('Twice');revision=1},
        @{gameRoot=$f.GameRoot;event='kill';names=@('hit');revision=1;extra=1},
        @{gameRoot=$f.GameRoot;event='kill';names='hit';revision=1},
        @{gameRoot=$f.GameRoot;event='kill';names=@('saya;Bell5');revision=1}
    )) {
        $reply = Invoke-KvkGuiRequest -Session $f.Session -Request @{v=1;requestId='bad-audio';op='planAudio';args=$bad}
        Assert (-not $reply.ok) "An unsafe audio preview was accepted: $($bad.event)"
    }
    $extra = Invoke-KvkGuiRequest -Session $f.Session -Request @{v=1;requestId='bad-list';op='audioList';args=@{gameRoot=$f.GameRoot;extra=1}}
    Assert (-not $extra.ok) 'audioList accepted an unknown argument.'

    $list = Invoke-KvkGuiRequest -Session $f.Session -Request @{v=1;requestId='sounds';op='audioList';args=@{gameRoot=$f.GameRoot}}
    if (-not $list.ok) { throw "audioList failed: $($list.error.message)" }
    $names = @($list.data.sounds | ForEach-Object {$_.name} | Sort-Object)
    Assert ($names -contains 'Bell5' -and $names -contains 'hit' -and $names -contains 'Twice') 'Installed sounds must be listed.'
    Assert (@($list.data.sounds | Where-Object {$_.name -eq 'Twice'})[0].ambiguous) 'An ambiguous name must be flagged.'
    Assert (($list.data.bindings.kill -join ',') -eq 'saya,Bell5') 'The current kill list must be reported.'
    Assert ($list.data.bindings.mbsGood.Count -eq 1 -and $list.data.bindings.mbsGood[0] -eq 'None') 'A single value must stay one element.'

    $preview = Invoke-KvkGuiRequest -Session $f.Session -Request @{v=1;requestId='pa';op='planAudio';args=@{gameRoot=$f.GameRoot;event='kill';names=@('hit','hit');revision=2}}
    Assert ($preview.ok) 'planAudio failed.'
    Assert ($preview.data.kind -eq 'install' -and @($preview.data.rows).Count -eq 1) 'An audio preview must be one install-shaped row.'
    Assert ([IO.File]::ReadAllText($primary) -ceq $original) 'Preparing an audio preview wrote game settings.'

    # Break caught: settings changed after the review are overwritten anyway.
    Write-KvkGuiFixtureText $primary ($original + ' ')
    $stale = Invoke-KvkGuiRequest -Session $f.Session -Request @{v=1;requestId='sa';op='execute';args=@{operationId='audio-stale';planId=$preview.data.planId;confirmation='install';allowConflicts=$false}}
    Assert (-not $stale.ok) 'A stale audio plan was executed.'
    Assert ([IO.File]::ReadAllText($primary) -ceq ($original + ' ')) 'A rejected audio execution wrote game settings.'

    Write-KvkGuiFixtureText $primary $original
    $fresh = Invoke-KvkGuiRequest -Session $f.Session -Request @{v=1;requestId='pa2';op='planAudio';args=@{gameRoot=$f.GameRoot;event='kill';names=@('hit','hit');revision=3}}
    $run = Invoke-KvkGuiRequest -Session $f.Session -Request @{v=1;requestId='sa2';op='execute';args=@{operationId='audio-1';planId=$fresh.data.planId;confirmation='install';allowConflicts=$false}}
    Assert ($run.ok -and $run.data.status -eq 'completed') 'Audio execution failed.'
    $after = ConvertFrom-Json ([IO.File]::ReadAllText($primary)) -AsHashtable
    Assert ($after.stringSettings['EStringSettingId::KillConfirmedSound'] -ceq 'hit;hit') 'Duplicates must survive the write.'
    Assert ($after.stringSettings['EStringSettingId::MBSChangeNowSound'] -ceq 'spawn05') 'An unrelated event changed.'
    $undo = Invoke-KvkGuiRequest -Session $f.Session -Request @{v=1;requestId='ua';op='planRestore';args=@{gameRoot=$f.GameRoot;sourceId=$run.data.batchId;revision=1}}
    $restored = Invoke-KvkGuiRequest -Session $f.Session -Request @{v=1;requestId='ua2';op='execute';args=@{operationId='audio-undo';planId=$undo.data.planId;confirmation='restore';allowConflicts=$false}}
    Assert ($restored.ok -and $restored.data.status -eq 'restored') 'The audio batch could not be undone.'
    Assert ([IO.File]::ReadAllText($primary) -ceq $original) 'Undo did not restore the exact original bytes.'
}
Microsoft.PowerShell.Utility\Write-Host 'PASS: audio listing, preview and replacement cross the typed boundary with an undoable batch.'

# Break caught: the crosshair page applies a non-canonical image, an unsafe name, or a
# plan whose slot changed after the review.
Invoke-WithKvkGuiFixture {
    param($f)
    $crosshairs = Join-Path $f.GameRoot 'FPSAimTrainer/crosshairs'
    Write-KvkGuiFixtureText (Join-Path $crosshairs 'slot.png') 'original slot bytes'
    $slot = Join-Path $crosshairs 'slot.png'
    $original = [IO.File]::ReadAllText($slot)
    $rgba = 'iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAYAAAB/qH1jAAAALUlEQVR4AQEiAN3/AAD/B2QU9Qf/KOsHZDzhB/8AUNcHZGTNB/94wwdkjLkH/+7IDtXxPpQHAAAAAElFTkSuQmCC'

    foreach ($bad in @(
        @{gameRoot=$f.GameRoot;file='../escape.png';pngBase64=$rgba;revision=1},
        @{gameRoot=$f.GameRoot;file='slot.jpg';pngBase64=$rgba;revision=1},
        @{gameRoot=$f.GameRoot;file='slot.png';pngBase64='!!!!';revision=1},
        @{gameRoot=$f.GameRoot;file='slot.png';pngBase64=$rgba;revision=-1},
        @{gameRoot=$f.GameRoot;file='slot.png';pngBase64=$rgba;revision=1;extra=1},
        @{gameRoot=$f.GameRoot;file='missing.png';pngBase64=$rgba;revision=1}
    )) {
        $reply = Invoke-KvkGuiRequest -Session $f.Session -Request @{v=1;requestId='bad-ch';op='planCrosshair';args=$bad}
        Assert (-not $reply.ok) "An unsafe crosshair preview was accepted: $($bad.file)"
    }
    # Colour type 2 is not the canonical RGBA the adapter accepts.
    $rgb = [byte[]][Convert]::FromBase64String($rgba); $rgb[25] = 2
    $nonCanonical = Invoke-KvkGuiRequest -Session $f.Session -Request @{v=1;requestId='rgb';op='planCrosshair';args=@{gameRoot=$f.GameRoot;file='slot.png';pngBase64=[Convert]::ToBase64String($rgb);revision=1}}
    Assert (-not $nonCanonical.ok) 'A non-RGBA image was accepted.'
    Assert ([IO.File]::ReadAllText($slot) -ceq $original) 'A rejected crosshair preview wrote the slot.'

    $list = Invoke-KvkGuiRequest -Session $f.Session -Request @{v=1;requestId='slots';op='crosshairList';args=@{gameRoot=$f.GameRoot}}
    Assert ($list.ok -and @($list.data.crosshairs).Count -eq 1 -and $list.data.crosshairs[0].file -ceq 'slot.png') 'crosshairList must report the installed slots.'

    $preview = Invoke-KvkGuiRequest -Session $f.Session -Request @{v=1;requestId='pc';op='planCrosshair';args=@{gameRoot=$f.GameRoot;file='slot.png';pngBase64=$rgba;revision=2}}
    Assert ($preview.ok) 'planCrosshair failed.'
    Assert ($preview.data.kind -eq 'install' -and @($preview.data.rows).Count -eq 1) 'A crosshair preview must be one install-shaped row.'
    Assert ($preview.data.rows[0].category -eq 'crosshairs') 'The preview must target the crosshairs category.'
    Assert ([IO.File]::ReadAllText($slot) -ceq $original) 'Preparing a crosshair preview wrote the slot.'

    # Break caught: the slot changed after review is overwritten anyway.
    Write-KvkGuiFixtureText $slot 'changed after review'
    $stale = Invoke-KvkGuiRequest -Session $f.Session -Request @{v=1;requestId='sc';op='execute';args=@{operationId='ch-stale';planId=$preview.data.planId;confirmation='install';allowConflicts=$false}}
    Assert (-not $stale.ok) 'A stale crosshair plan was executed.'
    Assert ([IO.File]::ReadAllText($slot) -ceq 'changed after review') 'A rejected crosshair execution wrote the slot.'

    Write-KvkGuiFixtureText $slot $original
    $fresh = Invoke-KvkGuiRequest -Session $f.Session -Request @{v=1;requestId='pc2';op='planCrosshair';args=@{gameRoot=$f.GameRoot;file='slot.png';pngBase64=$rgba;revision=3}}
    $run = Invoke-KvkGuiRequest -Session $f.Session -Request @{v=1;requestId='sc2';op='execute';args=@{operationId='ch-1';planId=$fresh.data.planId;confirmation='install';allowConflicts=$false}}
    Assert ($run.ok -and $run.data.status -eq 'completed') 'Crosshair execution failed.'
    Assert ([Convert]::ToBase64String([IO.File]::ReadAllBytes($slot)) -ceq $rgba) 'The slot image was not replaced.'
    $undo = Invoke-KvkGuiRequest -Session $f.Session -Request @{v=1;requestId='uc';op='planRestore';args=@{gameRoot=$f.GameRoot;sourceId=$run.data.batchId;revision=1}}
    $restored = Invoke-KvkGuiRequest -Session $f.Session -Request @{v=1;requestId='uc2';op='execute';args=@{operationId='ch-undo';planId=$undo.data.planId;confirmation='restore';allowConflicts=$false}}
    Assert ($restored.ok -and $restored.data.status -eq 'restored') 'The crosshair batch could not be undone.'
    Assert ([IO.File]::ReadAllText($slot) -ceq $original) 'Undo did not restore the original slot bytes.'
}
Microsoft.PowerShell.Utility\Write-Host 'PASS: crosshair slot listing, image replacement and undo cross the typed boundary.'

# Break caught: the add path overwrites an installed crosshair or accepts an unsafe name.
Invoke-WithKvkGuiFixture {
    param($f)
    $crosshairs = Join-Path $f.GameRoot 'FPSAimTrainer/crosshairs'
    Write-KvkGuiFixtureText (Join-Path $crosshairs 'slot.png') 'original slot bytes'
    $rgba = 'iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAYAAAB/qH1jAAAALUlEQVR4AQEiAN3/AAD/B2QU9Qf/KOsHZDzhB/8AUNcHZGTNB/94wwdkjLkH/+7IDtXxPpQHAAAAAElFTkSuQmCC'

    foreach ($bad in @(
        @{gameRoot=$f.GameRoot;file='../escape.png';pngBase64=$rgba;revision=1},
        @{gameRoot=$f.GameRoot;file='slot.png';pngBase64=$rgba;revision=1},
        @{gameRoot=$f.GameRoot;file='bare';pngBase64=$rgba;revision=1},
        @{gameRoot=$f.GameRoot;file='new.png';pngBase64=$rgba;revision=1;extra=1}
    )) {
        $reply = Invoke-KvkGuiRequest -Session $f.Session -Request @{v=1;requestId='bad-add';op='planCrosshairAdd';args=$bad}
        Assert (-not $reply.ok) "An unsafe crosshair add was accepted: $($bad.file)"
    }
    $preview = Invoke-KvkGuiRequest -Session $f.Session -Request @{v=1;requestId='add';op='planCrosshairAdd';args=@{gameRoot=$f.GameRoot;file='new.png';pngBase64=$rgba;revision=1}}
    Assert ($preview.ok) 'planCrosshairAdd failed.'
    Assert ($preview.data.rows[0].action -eq 'create') 'Adding must plan a create action.'
    Assert (-not [IO.File]::Exists((Join-Path $crosshairs 'new.png'))) 'Preparing an add created the file.'
    $run = Invoke-KvkGuiRequest -Session $f.Session -Request @{v=1;requestId='add2';op='execute';args=@{operationId='ch-add';planId=$preview.data.planId;confirmation='install';allowConflicts=$false}}
    Assert ($run.ok -and $run.data.status -eq 'completed') 'Crosshair add failed.'
    Assert ([Convert]::ToBase64String([IO.File]::ReadAllBytes((Join-Path $crosshairs 'new.png'))) -ceq $rgba) 'The new crosshair was not written.'
    Assert ([IO.File]::ReadAllText((Join-Path $crosshairs 'slot.png')) -ceq 'original slot bytes') 'The add changed another slot.'
    $undo = Invoke-KvkGuiRequest -Session $f.Session -Request @{v=1;requestId='addu';op='planRestore';args=@{gameRoot=$f.GameRoot;sourceId=$run.data.batchId;revision=1}}
    $restored = Invoke-KvkGuiRequest -Session $f.Session -Request @{v=1;requestId='addu2';op='execute';args=@{operationId='ch-addundo';planId=$undo.data.planId;confirmation='restore';allowConflicts=$false}}
    Assert ($restored.ok -and $restored.data.status -eq 'restored') 'The add could not be undone.'
    Assert (-not [IO.File]::Exists((Join-Path $crosshairs 'new.png'))) 'Undo did not remove the added crosshair.'
}
Microsoft.PowerShell.Utility\Write-Host 'PASS: crosshair add creates one new file and can be undone.'

# Break caught: exporting a code-generated PNG overwrites a file, writes inside the game
# directory, or accepts a path smuggled in through the file name.
Invoke-WithKvkGuiFixture {
    param($f)
    $out = Join-Path $f.Root 'exports'
    $null = [IO.Directory]::CreateDirectory($out)
    $rgba = 'iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAYAAAB/qH1jAAAALUlEQVR4AQEiAN3/AAD/B2QU9Qf/KOsHZDzhB/8AUNcHZGTNB/94wwdkjLkH/+7IDtXxPpQHAAAAAElFTkSuQmCC'
    foreach ($bad in @(
        @{directory=$out;fileName='../escape.png';base64=$rgba;gameRoot=$f.GameRoot},
        @{directory=$out;fileName='shot.png';base64='!!!!';gameRoot=$f.GameRoot},
        @{directory=(Join-Path $f.GameRoot 'FPSAimTrainer/crosshairs');fileName='sneak.png';base64=$rgba;gameRoot=$f.GameRoot},
        @{directory=(Join-Path $f.Root 'missing');fileName='shot.png';base64=$rgba;gameRoot=$f.GameRoot},
        @{directory=$out;fileName='shot.png';base64=$rgba;gameRoot=$f.GameRoot;extra=1}
    )) {
        $reply = Invoke-KvkGuiRequest -Session $f.Session -Request @{v=1;requestId='bad-export';op='exportFile';args=$bad}
        Assert (-not $reply.ok) "An unsafe export was accepted: $($bad.fileName)"
    }
    Assert (-not [IO.File]::Exists((Join-Path $f.GameRoot 'FPSAimTrainer/crosshairs/sneak.png'))) 'An export was written inside the game directory.'

    $saved = Invoke-KvkGuiRequest -Session $f.Session -Request @{v=1;requestId='export';op='exportFile';args=@{directory=$out;fileName='shot.png';base64=$rgba;gameRoot=$f.GameRoot}}
    Assert ($saved.ok) 'exportFile failed.'
    $written = Join-Path $out 'shot.png'
    Assert ([Convert]::ToBase64String([IO.File]::ReadAllBytes($written)) -ceq $rgba) 'The exported bytes differ from the request.'
    Assert ($saved.data.sha256 -ceq (Get-KvkHash $written)) 'The reported hash does not match the file.'

    $again = Invoke-KvkGuiRequest -Session $f.Session -Request @{v=1;requestId='export2';op='exportFile';args=@{directory=$out;fileName='shot.png';base64=$rgba;gameRoot=$f.GameRoot}}
    Assert (-not $again.ok) 'An export overwrote an existing file.'
    Assert ([Convert]::ToBase64String([IO.File]::ReadAllBytes($written)) -ceq $rgba) 'A refused export changed the existing file.'
    # Exporting is not a game change, so it must leave no backup batch behind.
    $backups = Invoke-KvkGuiRequest -Session $f.Session -Request @{v=1;requestId='b-export';op='backups';args=@{gameRoot=$f.GameRoot}}
    Assert ($backups.ok -and @($backups.data.records).Count -eq 0) 'An export created a backup record.'
}
Microsoft.PowerShell.Utility\Write-Host 'PASS: code-to-PNG export writes one new file outside the game and never overwrites.'

# Break caught: the enemy page accepts an unknown shape or an out-of-catalog/already-equipped
# pair, writes outside the two characterModelOverride strings, or executes a plan whose
# settings changed after review.
Invoke-WithKvkGuiFixture {
    param($f)
    $primary = Join-Path $f.GameRoot 'FPSAimTrainer/Saved/SaveGames/PrimaryUserSettings.json'
    $settings = "{`n`t`"floatSettings`":`n`t{`n`t`t`"EFloatSettingId::XSens`": 0.91`n`t},`n`t`"characterModelOverride`":`n`t{`n`t`t`"Cylindrical`":`n`t`t{`n`t`t`t`"characterModel`": `"Stylized Ecto`",`n`t`t`t`"characterSkin`": `"Default`"`n`t`t},`n`t`t`"Cuboid`":`n`t`t{`n`t`t`t`"characterModel`": `"Ghost`",`n`t`t`t`"characterSkin`": `"Default`"`n`t`t},`n`t`t`"Spheroid`":`n`t`t{`n`t`t`t`"characterModel`": `"Mummy`",`n`t`t`t`"characterSkin`": `"Default`"`n`t`t}`n`t},`n`t`"currentlySelectedBoundingBoxType`": `"Cuboid`"`n}`n"
    Write-KvkGuiFixtureText $primary $settings
    $original = [IO.File]::ReadAllText($primary)

    foreach ($bad in @(
        @{gameRoot=$f.GameRoot;shape='humanoid';model='Ghost';skin='Default';revision=1},
        @{gameRoot=$f.GameRoot;shape='cylindrical';model='Does Not Exist';skin='Default';revision=1},
        @{gameRoot=$f.GameRoot;shape='cylindrical';model='Stylized Ecto';skin='Default';revision=1},
        @{gameRoot=$f.GameRoot;shape='cuboid';model='Stylized Ecto';skin='Default';revision=1},
        @{gameRoot=$f.GameRoot;shape='cylindrical';model='Ghost';skin='Default';revision=-1},
        @{gameRoot=$f.GameRoot;shape='cylindrical';model='Ghost';skin='Default';revision=1;extra=1}
    )) {
        $reply = Invoke-KvkGuiRequest -Session $f.Session -Request @{v=1;requestId='bad-enemy';op='planEnemy';args=$bad}
        Assert (-not $reply.ok) "An unsafe enemy preview was accepted: $($bad.shape)/$($bad.model)"
    }
    Assert ([IO.File]::ReadAllText($primary) -ceq $original) 'A rejected enemy preview wrote the settings.'

    $list = Invoke-KvkGuiRequest -Session $f.Session -Request @{v=1;requestId='enemies';op='enemyList';args=@{gameRoot=$f.GameRoot}}
    Assert ($list.ok) 'enemyList failed.'
    Assert (@($list.data.skins).Count -eq 15) 'enemyList must report the fixed 15-skin catalog.'
    Assert ($list.data.current.cylindrical.model -ceq 'Stylized Ecto' -and $list.data.current.cuboid.model -ceq 'Ghost' -and $list.data.current.spheroid.model -ceq 'Mummy') 'enemyList must report the current pair per shape.'

    $preview = Invoke-KvkGuiRequest -Session $f.Session -Request @{v=1;requestId='pe';op='planEnemy';args=@{gameRoot=$f.GameRoot;shape='cylindrical';model='Ghost';skin='Default';revision=2}}
    Assert ($preview.ok) 'planEnemy failed.'
    Assert ($preview.data.rows[0].category -eq 'primary') 'An enemy preview must target the settings file.'
    Write-KvkGuiFixtureText $primary ($original + ' ')
    $stale = Invoke-KvkGuiRequest -Session $f.Session -Request @{v=1;requestId='se';op='execute';args=@{operationId='enemy-stale';planId=$preview.data.planId;confirmation='install';allowConflicts=$false}}
    Assert (-not $stale.ok) 'A stale enemy plan was executed.'

    Write-KvkGuiFixtureText $primary $original
    $fresh = Invoke-KvkGuiRequest -Session $f.Session -Request @{v=1;requestId='pe2';op='planEnemy';args=@{gameRoot=$f.GameRoot;shape='cylindrical';model='Ghost';skin='Default';revision=3}}
    $run = Invoke-KvkGuiRequest -Session $f.Session -Request @{v=1;requestId='se2';op='execute';args=@{operationId='enemy-1';planId=$fresh.data.planId;confirmation='install';allowConflicts=$false}}
    Assert ($run.ok -and $run.data.status -eq 'completed') 'Enemy execution failed.'
    $after = [IO.File]::ReadAllText($primary)
    $expected = $original.Replace('"characterModel": "Stylized Ecto"','"characterModel": "Ghost"')
    Assert ($after -ceq $expected) 'Only the two characterModelOverride strings may change, in place.'
    $undo = Invoke-KvkGuiRequest -Session $f.Session -Request @{v=1;requestId='ue';op='planRestore';args=@{gameRoot=$f.GameRoot;sourceId=$run.data.batchId;revision=1}}
    $restored = Invoke-KvkGuiRequest -Session $f.Session -Request @{v=1;requestId='ue2';op='execute';args=@{operationId='enemy-undo';planId=$undo.data.planId;confirmation='restore';allowConflicts=$false}}
    Assert ($restored.ok -and [IO.File]::ReadAllText($primary) -ceq $original) 'The enemy batch could not be undone to the exact bytes.'
}
Microsoft.PowerShell.Utility\Write-Host 'PASS: an enemy skin change writes only the two catalog strings, refuses stale plans and can be undone.'

# A success reply has no error property, and StrictMode throws on reading one.
function Get-ReplyError($Reply) { if ($Reply.ok) { return '' } return [string]$Reply.error.message }

# Break caught: applying a saved Profile is a plan op like the others -- one preview, one
# executable batch, refused when a reference no longer resolves or the review goes stale.
Invoke-WithKvkGuiFixture {
    param($f)
    $primary = Join-Path $f.GameRoot 'FPSAimTrainer/Saved/SaveGames/PrimaryUserSettings.json'
    # Carries every key the two writers own -- scheme's materials/sky (New-KvkSchemePlan
    # requires all of them) and all six audio Sound keys. A Profile no longer manages the
    # enemy (2026-09-21), so EnemyBodyColor below must stay untouched by the apply.
    $settings = @'
{
	"booleanSettings":
	{
		"EBooleanSettingId::OverrideAllNewMapMaterials": false,
		"EBooleanSettingId::SolidSkyColor": false,
		"EBooleanSettingId::ShowSunInSkybox": true
	},
	"integerSettings":
	{
		"EIntegerSettingId::FloorMat": 0,
		"EIntegerSettingId::SkyPreset": 6,
		"EIntegerSettingId::CloudCover": 0,
		"EIntegerSettingId::WallMat": 50
	},
	"floatSettings":
	{
		"EFloatSettingId::XSens": 0.91,
		"EFloatSettingId::EnemyRoughness": 0.5,
		"EFloatSettingId::WallRoughness": 1,
		"EFloatSettingId::WallMetallic": 1,
		"EFloatSettingId::WallFullBright": 0.5,
		"EFloatSettingId::WallTextureScale": 1,
		"EFloatSettingId::FloorRoughness": 1,
		"EFloatSettingId::FloorMetallic": 0,
		"EFloatSettingId::FloorFullBright": 0.3,
		"EFloatSettingId::FloorTextureScale": 1,
		"EFloatSettingId::CeilingRoughness": 1,
		"EFloatSettingId::CeilingMetallic": 0,
		"EFloatSettingId::CeilingFullBright": 0.3,
		"EFloatSettingId::CeilingTextureScale": 1,
		"EFloatSettingId::RampRoughness": 1,
		"EFloatSettingId::RampMetallic": 0,
		"EFloatSettingId::RampFullBright": 0.5,
		"EFloatSettingId::RampTextureScale": 1
	},
	"stringSettings":
	{
		"EStringSettingId::CurrentThemeName": "Old",
		"EStringSettingId::WallMaterial": "DRYWALL",
		"EStringSettingId::FloorMaterial": "GRID 8",
		"EStringSettingId::CeilingMaterial": "DRYWALL",
		"EStringSettingId::RampMaterial": "DRYWALL",
		"EStringSettingId::KillConfirmedSound": "OldKill",
		"EStringSettingId::SpawnSound": "",
		"EStringSettingId::MBSGoodSound": "OldGood",
		"EStringSettingId::MBSOkaySound": "OldOkay",
		"EStringSettingId::MBSBadSound": "OldBad",
		"EStringSettingId::MBSChangeNowSound": "OldChange"
	},
	"vectorSettings":
	{
		"EVectorSettingId::WallColor": {"x": 1, "y": 1, "z": 1},
		"EVectorSettingId::FloorColor": {"x": 1, "y": 1, "z": 1},
		"EVectorSettingId::CeilingColor": {"x": 1, "y": 1, "z": 1},
		"EVectorSettingId::RampColor": {"x": 1, "y": 1, "z": 1},
		"EVectorSettingId::EnemyBodyColor": {"x": 0.5, "y": 0.5, "z": 0.5}
	},
	"colorSettings":
	{
		"EColorSettingId::SkyColor": {"r": 1, "g": 2, "b": 3, "a": 255}
	}
}
'@
    Write-KvkGuiFixtureText $primary $settings
    $themes = Join-Path $f.GameRoot 'FPSAimTrainer/Saved/SaveGames/Themes'
    $sounds = Join-Path $f.GameRoot 'FPSAimTrainer/sounds'
    Write-KvkGuiFixtureText (Join-Path $themes 'Combo.json') '{"themeName":"Combo","wallMaterial":"CONCRETE TILES","wallRoughness":0.25,"wallMetallic":0,"wallFullBright":0.5,"wallTint":{"x":0.1,"y":0.2,"z":0.9},"wallTextureScale":2.5,"floorMaterial":"WOOD PARQUET","floorRoughness":0.75,"floorMetallic":0.1,"floorFullBright":0,"floorTint":{"x":0.3,"y":0.4,"z":0.5},"floorTextureScale":3,"ceilingMaterial":"METAL SHEET","ceilingRoughness":1,"ceilingMetallic":1,"ceilingFullBright":0.9,"ceilingTint":{"x":0.6,"y":0.7,"z":0.8},"ceilingTextureScale":0.5,"rampMaterial":"PURE COLOR","rampRoughness":0.5,"rampMetallic":0.5,"rampFullBright":0.25,"rampTint":{"x":0.9,"y":0.1,"z":0.2},"rampTextureScale":1.5,"skyPresetId":2,"cloudCoverId":4,"solidSkyColor":true,"sunVisible":false,"skyColor":{"b":20,"g":30,"r":40,"a":255}}'
    Write-KvkGuiFixtureText (Join-Path $sounds 'Good.wav') 'good'
    $original = [IO.File]::ReadAllText($primary)

    $profile = @{
        schemaVersion=1;id='pf-apply';name='Combo Profile'
        scheme=@{name='Combo';path=(Join-Path $themes 'Combo.json')}
        audio=@{mbsGood=@(@{name='Good';path=(Join-Path $sounds 'Good.wav')})}
    }
    $saved = Invoke-KvkGuiRequest -Session $f.Session -Request @{v=1;requestId='save';op='profileSave';args=@{profile=$profile}}
    Assert ($saved.ok) "profileSave failed: $(Get-ReplyError $saved)"

    foreach ($bad in @(
        @{gameRoot=$f.GameRoot;id='../escape';revision=1},
        @{gameRoot=$f.GameRoot;id='pf-apply';revision=-1},
        @{gameRoot=$f.GameRoot;id='pf-apply';revision=1;extra=1}
    )) {
        $reply = Invoke-KvkGuiRequest -Session $f.Session -Request @{v=1;requestId='bad-apply';op='planProfileApply';args=$bad}
        Assert (-not $reply.ok) "An unsafe planProfileApply request was accepted: $($bad.id)"
    }
    $missing = Invoke-KvkGuiRequest -Session $f.Session -Request @{v=1;requestId='missing-apply';op='planProfileApply';args=@{gameRoot=$f.GameRoot;id='no-such-profile';revision=1}}
    Assert (-not $missing.ok) 'planProfileApply accepted an id with no saved Profile.'

    $preview = Invoke-KvkGuiRequest -Session $f.Session -Request @{v=1;requestId='pfa';op='planProfileApply';args=@{gameRoot=$f.GameRoot;id='pf-apply';revision=2}}
    Assert ($preview.ok) "planProfileApply failed: $(Get-ReplyError $preview)"
    Assert ($preview.data.kind -eq 'install' -and @($preview.data.rows).Count -eq 1 -and $preview.data.rows[0].category -eq 'primary') 'A Profile apply preview must be one install-shaped row targeting the settings file.'
    Assert ([IO.File]::ReadAllText($primary) -ceq $original) 'Preparing a Profile apply preview wrote game settings.'

    # Break caught: settings changed after the review are still overwritten.
    Write-KvkGuiFixtureText $primary ($original + ' ')
    $stale = Invoke-KvkGuiRequest -Session $f.Session -Request @{v=1;requestId='sfa';op='execute';args=@{operationId='profile-apply-stale';planId=$preview.data.planId;confirmation='install';allowConflicts=$false}}
    Assert (-not $stale.ok) 'A stale Profile apply plan was executed.'
    Assert ([IO.File]::ReadAllText($primary) -ceq ($original + ' ')) 'A rejected Profile apply execution wrote game settings.'

    Write-KvkGuiFixtureText $primary $original
    $fresh = Invoke-KvkGuiRequest -Session $f.Session -Request @{v=1;requestId='pfa2';op='planProfileApply';args=@{gameRoot=$f.GameRoot;id='pf-apply';revision=3}}
    $run = Invoke-KvkGuiRequest -Session $f.Session -Request @{v=1;requestId='sfa2';op='execute';args=@{operationId='profile-apply-1';planId=$fresh.data.planId;confirmation='install';allowConflicts=$false}}
    Assert ($run.ok -and $run.data.status -eq 'completed') "Profile apply execution failed: $(Get-ReplyError $run)"
    $after = ConvertFrom-Json ([IO.File]::ReadAllText($primary)) -AsHashtable
    Assert ($after.stringSettings['EStringSettingId::CurrentThemeName'] -ceq 'Combo') 'The scheme half of the Profile was not applied.'
    Assert ($after.stringSettings['EStringSettingId::MBSGoodSound'] -ceq 'Good') 'The audio half of the Profile was not applied.'
    Assert ($after.stringSettings['EStringSettingId::MBSOkaySound'] -ceq 'OldOkay') 'An event the Profile left untouched must keep its current binding.'
    Assert ($after.vectorSettings['EVectorSettingId::EnemyBodyColor'].x -eq 0.5) 'A Profile no longer manages the enemy; applying it must not touch EnemyBodyColor.'
    Assert ($after.floatSettings['EFloatSettingId::XSens'] -eq 0.91) 'A Profile apply touched an unrelated setting.'
    $undo = Invoke-KvkGuiRequest -Session $f.Session -Request @{v=1;requestId='ufa';op='planRestore';args=@{gameRoot=$f.GameRoot;sourceId=$run.data.batchId;revision=1}}
    $restored = Invoke-KvkGuiRequest -Session $f.Session -Request @{v=1;requestId='ufa2';op='execute';args=@{operationId='profile-apply-undo';planId=$undo.data.planId;confirmation='restore';allowConflicts=$false}}
    Assert ($restored.ok -and [IO.File]::ReadAllText($primary) -ceq $original) 'The Profile apply batch could not be undone to the exact bytes.'
}
Microsoft.PowerShell.Utility\Write-Host 'PASS: applying a saved Profile merges scheme and audio into one plan, leaves the enemy untouched, and can be undone.'
# Break caught: an import overwrites, accepts bytes from the UI, or leaves an executable plan behind.
Invoke-WithKvkGuiFixture {
    param($f)
    $themes = Join-Path $f.GameRoot 'FPSAimTrainer/Saved/SaveGames/Themes'
    $sounds = Join-Path $f.GameRoot 'FPSAimTrainer/sounds'
    $downloads = Join-Path $f.Root 'downloads'
    $null = [IO.Directory]::CreateDirectory($downloads); $null = [IO.Directory]::CreateDirectory($themes)
    Write-KvkGuiFixtureText (Join-Path $themes 'Installed.json') '{"themeName":"Installed Theme"}'
    $source = Join-Path $downloads 'Incoming.json'
    Write-KvkGuiFixtureText $source '{"themeName":"Incoming Theme","wallMaterial":"DRYWALL"}'
    $hash = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()
    $clash = Join-Path $downloads 'Clash.json'
    Write-KvkGuiFixtureText $clash '{"themeName":"installed THEME"}'
    $clashHash = (Get-FileHash -LiteralPath $clash -Algorithm SHA256).Hash.ToLowerInvariant()

    foreach ($bad in @(
        @{gameRoot=$f.GameRoot;kind='theme';sourcePath=$source;sourceSha256=$hash;file='../escape.json';revision=1},
        @{gameRoot=$f.GameRoot;kind='theme';sourcePath=$source;sourceSha256=$hash;file='Installed.json';revision=1},
        @{gameRoot=$f.GameRoot;kind='theme';sourcePath=$source;sourceSha256=('0'*64);file='Incoming.json';revision=1},
        @{gameRoot=$f.GameRoot;kind='theme';sourcePath=$source;sourceSha256='nope';file='Incoming.json';revision=1},
        @{gameRoot=$f.GameRoot;kind='theme';sourcePath=$clash;sourceSha256=$clashHash;file='Clash.json';revision=1},
        @{gameRoot=$f.GameRoot;kind='theme';sourcePath='Incoming.json';sourceSha256=$hash;file='Incoming.json';revision=1},
        @{gameRoot=$f.GameRoot;kind='crosshair';sourcePath=$source;sourceSha256=$hash;file='Incoming.json';revision=1},
        @{gameRoot=$f.GameRoot;kind='sound';sourcePath=$source;sourceSha256=$hash;file='Incoming.wav';revision=1},
        @{gameRoot=$f.GameRoot;kind='theme';sourcePath=$source;sourceSha256=$hash;file='Incoming.json';revision=-1},
        @{gameRoot=$f.GameRoot;kind='theme';sourcePath=$source;sourceSha256=$hash;file='Incoming.json';revision=1;bytes='AAAA'}
    )) {
        $reply = Invoke-KvkGuiRequest -Session $f.Session -Request @{v=1;requestId='bad-import';op='planFileAdd';args=$bad}
        Assert (-not $reply.ok) "An unsafe import was accepted: $($bad.file) / $($bad.kind)"
        Assert ($null -eq $f.Session.Plan) 'A refused import left an executable plan behind.'
    }
    Assert (@([IO.Directory]::GetFiles($themes)).Count -eq 1) 'A refused import wrote the Themes folder.'

    $preview = Invoke-KvkGuiRequest -Session $f.Session -Request @{v=1;requestId='imp';op='planFileAdd';args=@{gameRoot=$f.GameRoot;kind='theme';sourcePath=$source;sourceSha256=$hash;file='Incoming.json';revision=1}}
    Assert ($preview.ok) "planFileAdd failed: $(Get-ReplyError $preview)"
    Assert (@($preview.data.rows).Count -eq 1 -and $preview.data.rows[0].action -eq 'create' -and $preview.data.rows[0].key -ceq 'themes/Incoming.json') 'An import must preview exactly one create row.'
    Assert (-not [IO.File]::Exists((Join-Path $themes 'Incoming.json'))) 'Preparing an import wrote the game directory.'
    $run = Invoke-KvkGuiRequest -Session $f.Session -Request @{v=1;requestId='imp2';op='execute';args=@{operationId='import-1';planId=$preview.data.planId;confirmation='install';allowConflicts=$false}}
    Assert ($run.ok -and $run.data.status -eq 'completed') "Import failed: $(Get-ReplyError $run)"
    Assert ([IO.File]::ReadAllText((Join-Path $themes 'Incoming.json')) -ceq [IO.File]::ReadAllText($source)) 'The theme was not copied as is.'
    $listed = Invoke-KvkGuiRequest -Session $f.Session -Request @{v=1;requestId='impl';op='schemeList';args=@{gameRoot=$f.GameRoot}}
    Assert (@($listed.data.themes | Where-Object { $_.name -ceq 'Incoming Theme' -and $_.readable -and -not $_.duplicateName }).Count -eq 1) 'The imported theme must be listed and usable.'
    # A plan is single use: the executed id must not run again.
    $again = Invoke-KvkGuiRequest -Session $f.Session -Request @{v=1;requestId='imp3';op='execute';args=@{operationId='import-2';planId=$preview.data.planId;confirmation='install';allowConflicts=$false}}
    Assert (-not $again.ok) 'An executed import plan ran twice.'

    $wav = Join-Path $downloads 'bell.wav'
    [IO.File]::WriteAllBytes($wav, [byte[]](82,73,70,70,1,2,3,4))
    $wavHash = (Get-FileHash -LiteralPath $wav -Algorithm SHA256).Hash.ToLowerInvariant()
    $sound = Invoke-KvkGuiRequest -Session $f.Session -Request @{v=1;requestId='snd';op='planFileAdd';args=@{gameRoot=$f.GameRoot;kind='sound';sourcePath=$wav;sourceSha256=$wavHash;file='bell.wav';revision=2}}
    Assert ($sound.ok -and $sound.data.rows[0].key -ceq 'sounds/bell.wav') "planFileAdd for a sound failed: $(Get-ReplyError $sound)"
    $ran = Invoke-KvkGuiRequest -Session $f.Session -Request @{v=1;requestId='snd2';op='execute';args=@{operationId='import-3';planId=$sound.data.planId;confirmation='install';allowConflicts=$false}}
    Assert ($ran.ok -and $ran.data.status -eq 'completed') 'Sound import failed.'
    $undo = Invoke-KvkGuiRequest -Session $f.Session -Request @{v=1;requestId='sndu';op='planRestore';args=@{gameRoot=$f.GameRoot;sourceId=$ran.data.batchId;revision=1}}
    $restored = Invoke-KvkGuiRequest -Session $f.Session -Request @{v=1;requestId='sndu2';op='execute';args=@{operationId='import-undo';planId=$undo.data.planId;confirmation='restore';allowConflicts=$false}}
    Assert ($restored.ok -and $restored.data.status -eq 'restored') 'The import could not be undone.'
    Assert (-not [IO.File]::Exists((Join-Path $sounds 'bell.wav'))) 'Undo did not remove the imported sound.'
}
Microsoft.PowerShell.Utility\Write-Host 'PASS: a file import adds exactly one new file by path, refuses unsafe requests and can be undone.'

# Break caught: an issue or a final report reaches the English UI with only Chinese text.
$cjk = '[\u3000-\u303f\u3400-\u9fff\uff00-\uffef]'
function Assert-English($Text, [string]$What) {
    Assert ($Text -is [string] -and -not [string]::IsNullOrWhiteSpace($Text) -and $Text -cnotmatch $cjk) "$What must carry English without CJK: '$Text'"
}
$nativeIssues = @(
    '{"v":1,"requestId":"en-1","op":"execute","args":{"operationId":"op-en","planId":"missing-plan","confirmation":"install","allowConflicts":false}}',
    '{"v":1,"requestId":"en-2","op":"removeEverything","args":{}}',
    '{"v":1,"requestId":"en-3","op":"planCrosshair","args":{"gameRoot":"C:/NoSuchGame","file":"a.png","pngBase64":"!!!!","revision":1}}',
    '{"v":1,"requestId":"en-4","op":"profileSave","args":{"profile":{"id":"p1"}}}'
) | & $powershell -NoProfile -File $worker
Assert ($LASTEXITCODE -eq 0) 'The worker must exit cleanly after the English checks.'
$nativeIssues = @($nativeIssues | ForEach-Object { ConvertFrom-Json -InputObject $_ -ErrorAction Stop })
Assert ($nativeIssues.Count -eq 4) 'The worker must answer each English check once.'
Assert ($nativeIssues[0].error.code -ceq 'PLAN_MISSING') "Expected PLAN_MISSING, got $($nativeIssues[0].error.code)"
Assert ($nativeIssues[1].error.code -ceq 'ENGINE_ERROR') "Expected ENGINE_ERROR, got $($nativeIssues[1].error.code)"
Assert ($nativeIssues[2].error.message -cmatch $cjk) 'The crosshair refusal keeps its Chinese message.'
# The Profile refusal is worded in the engine, so it carries its own English, not the fixed line.
Assert ($nativeIssues[3].error.message -cmatch $cjk) 'The Profile refusal keeps its Chinese message.'
Assert ($nativeIssues[3].error.messageEn -cne 'The engine reported an error. Details are in worker.log; send a report from Settings, or write to feedback@aimloom.dev.') 'A Profile refusal must carry its own English, not the fixed line.'
foreach ($reply in $nativeIssues) {
    Assert (-not $reply.ok) "$($reply.requestId) must be refused."
    Assert ($null -ne $reply.error.PSObject.Properties['messageEn']) "$($reply.requestId) has no messageEn."
    Assert-English $reply.error.messageEn $reply.requestId
}

Invoke-WithKvkGuiFixture {
    param($f)
    $withEnglish = [InvalidOperationException]::new('引擎失败')
    $withEnglish.Data['KvkCode'] = 'CONFLICT'; $withEnglish.Data['KvkMessageEn'] = 'The engine refused.'
    $mapped = Get-KvkGuiMappedIssue $withEnglish
    Assert ($mapped.code -ceq 'CONFLICT' -and $mapped.messageEn -ceq 'The engine refused.') 'The mapper must carry the exception English.'
    $mapped = Get-KvkGuiMappedIssue ([InvalidOperationException]::new('plain English failure'))
    Assert ($mapped.messageEn -ceq 'plain English failure') 'An English exception message is its own English.'
    $mapped = Get-KvkGuiMappedIssue ([InvalidOperationException]::new('只有中文'))
    Assert ($mapped.messageEn -ceq 'The engine reported an error. Details are in worker.log; send a report from Settings, or write to feedback@aimloom.dev.') 'A Chinese-only exception gets the fixed English line.'
    $issue = New-KvkGuiIssue 'ENGINE_ERROR' '中文' '中文'
    Assert-English $issue.messageEn 'An issue whose English is Chinese'

    $report = New-KvkReport 'rolled-back' 'id' @() @('写入失败','plain failure') @('The write failed.','plain failure')
    $dto = ConvertTo-KvkGuiExecution $report
    Assert (@($dto.errorsEn).Count -eq 2 -and $dto.errorsEn[0] -ceq 'The write failed.') 'The execution DTO must carry errorsEn.'
    $dto = ConvertTo-KvkGuiExecution (New-KvkReport 'rolled-back' 'id' @() @('只有中文','plain failure'))
    Assert (@($dto.errorsEn).Count -eq 2 -and $dto.errorsEn[1] -ceq 'plain failure') 'errorsEn must be derived when the engine gave none.'
    Assert-English $dto.errorsEn[0] 'A derived English error line'
    $dto = ConvertTo-KvkGuiExecution (New-KvkReport 'completed' 'id' @() @())
    Assert ($null -ne $dto.PSObject.Properties['errorsEn'] -and @($dto.errorsEn).Count -eq 0) 'A clean report still has an empty errorsEn.'
    Assert ((ConvertTo-Json -InputObject $dto -Compress) -cmatch '"errorsEn":\[\]') 'An empty errorsEn must stay an array on the wire.'
}
Microsoft.PowerShell.Utility\Write-Host 'PASS: every issue and final report carries English without CJK.'

# Break caught: an English refusal that names a Chinese file is thrown away, so an English
# player reads the fixed line instead of learning which file was refused (ROADMAP I18N-NAMES).
# Game content is never translated, so the name travels inside double quotes.
$named='The Themes folder already has "中文主题.json", and adding never overwrites it. Choose another file name.'
$namedZh='Themes 文件夹里已经有「中文主题.json」，添加不会覆盖它；请换一个文件名。'
$issue=New-KvkGuiIssue 'ENGINE_ERROR' $namedZh $named
Assert ($issue.messageEn -ceq $named) "A quoted Chinese name must survive the English filter: $($issue.messageEn)"
$exception=[InvalidOperationException]::new($namedZh)
$exception.Data['KvkCode']='ENGINE_ERROR';$exception.Data['KvkMessageEn']=$named
Assert ((Get-KvkGuiMappedIssue $exception).messageEn -ceq $named) 'The mapper must keep an English message that quotes a Chinese name.'
$dto=ConvertTo-KvkGuiExecution (New-KvkReport 'rolled-back' 'id' @() @($namedZh) @($named))
Assert ($dto.errorsEn[0] -ceq $named) 'errorsEn must keep an English line that quotes a Chinese name.'
# The fixed line promises worker.log, and only the worker's stderr is copied there.
$workerSource=[IO.File]::ReadAllText((Join-Path $installerRoot 'gui/kvk-gui-worker.ps1'))
Assert ($workerSource -match '\$global:KvkStderrDetails\s*=\s*\$true') 'The GUI worker must enable the untranslated-message log.'
Microsoft.PowerShell.Utility\Write-Host 'PASS: an English refusal may name a Chinese file; an untranslated one is logged.'
