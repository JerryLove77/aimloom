#Requires -Version 7.0
<#
.SYNOPSIS
Shared check: refuse a packaged EXE that embeds this machine's local paths.

.DESCRIPTION
rustc bakes each dependency's source path into panic locations, so an app.exe built without
path remapping (see build-exe.ps1) ships the builder's Windows user name, computer name and
literal `C:\Users\...` paths in its bytes — the released v0.1.1 and v0.1.2 Aimloom.exe carried
`C:\Users\<name>\.cargo\registry\...` 317 times. Dot-source this file and call
Assert-KvkNoLocalPaths on every EXE a packaging script is about to hand out, in both
package-test-build.ps1 and package-setup.ps1, so the rule can never drift between the two.
#>
Set-StrictMode -Version 3.0

function Assert-KvkNoLocalPaths {
    <#
    .SYNOPSIS
    Throws if the file at -Path contains, case-insensitively, the current $env:USERNAME,
    $env:USERPROFILE, $env:COMPUTERNAME, or the literal C:\Users\ — searched as ASCII/UTF-8 text
    and as UTF-16LE text, since rustc's embedded strings can appear either way. The thrown
    message names only the rule and a hit count, never the matched text.
    #>
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$Path)

    $needles = [ordered]@{}
    if ($env:USERNAME) { $needles["the builder's Windows user name"] = $env:USERNAME }
    if ($env:USERPROFILE) { $needles["the builder's user profile path"] = $env:USERPROFILE }
    if ($env:COMPUTERNAME) { $needles["the builder's computer name"] = $env:COMPUTERNAME }
    $needles['a literal C:\Users\ path'] = 'C:\Users\'

    $bytes = [IO.File]::ReadAllBytes($Path)
    $ascii = [Text.Encoding]::UTF8.GetString($bytes)
    $utf16 = [Text.Encoding]::Unicode.GetString($bytes)

    $hits = [Collections.Generic.List[string]]::new()
    foreach ($rule in $needles.GetEnumerator()) {
        $needle = $rule.Value
        if (-not $needle) { continue }
        $pattern = [regex]::Escape($needle)
        $options = [Text.RegularExpressions.RegexOptions]::IgnoreCase
        $count = [regex]::Matches($ascii, $pattern, $options).Count + [regex]::Matches($utf16, $pattern, $options).Count
        if ($count -gt 0) { $hits.Add("$($rule.Key): $count hit(s)") }
    }
    if ($hits.Count -gt 0) {
        # The file name only: a full path can itself contain the user name this check protects.
        throw "$([IO.Path]::GetFileName($Path)) embeds a local build path and must not ship. " + ($hits -join '; ')
    }
}
