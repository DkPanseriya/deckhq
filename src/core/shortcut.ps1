# DeckHQ — the three things only Windows can answer about a shortcut.
#
# WP-62. A `.lnk` is a binary format with no documented writer outside COM, so
# this is the one place in the package that has to ask Windows itself.
#
# THIS SCRIPT IS FIXED TEXT AND NOTHING IS EVER INTERPOLATED INTO IT. Node runs
# it with `-File`, never `-Command`: `docs/DEVIATIONS.md` §101 measured that
# `powershell -Command "<script>" <value>` APPENDS the value to the command
# text, so a path became script source.
#
# AND THE SHORTCUT'S OWN FIELDS DO NOT TRAVEL ON THE COMMAND LINE AT ALL. A
# `.lnk`'s `Arguments` is a quoted command line — `"C:\...\deckhq.mjs" "app"` —
# so passing it as a parameter would mean putting double quotes through Node's
# win32 quoting and then through PowerShell's `-File` parsing, and the two do
# not agree. Measured: that arrives as `Parameter set cannot be resolved using
# the specified named parameters`. So `-Action create` takes `-SpecFile`, a
# JSON file DeckHQ wrote under its own state directory, and reads every field
# out of it. No value with a quote, a space, a `%` or a backtick in it is ever
# on a command line here. `docs/DEVIATIONS.md` §144.
#
#   -Action folders              print the real Desktop / Programs / Startup
#                                folders as JSON. `%USERPROFILE%\Desktop` is a
#                                guess — a machine with OneDrive folder backup
#                                on has it somewhere else, and writing to the
#                                guess would put an icon on a desktop nobody
#                                looks at.
#   -Action create -SpecFile F   write one shortcut, from the JSON in F.
#   -Action inspect -Path P      print an existing shortcut's target, arguments
#                                and description as JSON, so `--remove` can
#                                confirm a file is ours before deleting it.
#
# Exit code is 0 on success and 1 on any failure, with the reason on stderr.

param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('folders', 'create', 'inspect')]
  [string]$Action,

  [string]$Path,
  [string]$SpecFile
)

$ErrorActionPreference = 'Stop'

try {
  if ($Action -eq 'folders') {
    [pscustomobject]@{
      desktop  = [Environment]::GetFolderPath('Desktop')
      programs = [Environment]::GetFolderPath('Programs')
      startup  = [Environment]::GetFolderPath('Startup')
    } | ConvertTo-Json -Compress
    exit 0
  }

  $shell = New-Object -ComObject WScript.Shell

  if ($Action -eq 'inspect') {
    if (-not $Path) { throw '-Path is required' }
    if (-not (Test-Path -LiteralPath $Path)) { throw "no such file: $Path" }
    $link = $shell.CreateShortcut($Path)
    [pscustomobject]@{
      path         = $Path
      target       = $link.TargetPath
      arguments    = $link.Arguments
      description  = $link.Description
      iconLocation = $link.IconLocation
    } | ConvertTo-Json -Compress
    exit 0
  }

  if (-not $SpecFile) { throw '-SpecFile is required' }
  if (-not (Test-Path -LiteralPath $SpecFile)) { throw "no such file: $SpecFile" }
  $spec = Get-Content -LiteralPath $SpecFile -Raw -Encoding UTF8 | ConvertFrom-Json

  if (-not $spec.path) { throw 'the spec has no "path"' }
  if (-not $spec.target) { throw 'the spec has no "target"' }

  # [System.IO.Path] rather than `Split-Path`: in Windows PowerShell 5.1
  # `Split-Path -LiteralPath X -Parent` puts two parameter sets in play and
  # fails with "Parameter set cannot be resolved using the specified named
  # parameters" — measured, and it says nothing about which parameter it
  # means. The .NET call has no parameter sets to resolve.
  $parent = [System.IO.Path]::GetDirectoryName($spec.path)
  if ($parent -and -not (Test-Path -LiteralPath $parent)) {
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
  }

  $link = $shell.CreateShortcut($spec.path)
  $link.TargetPath = $spec.target
  if ($spec.arguments) { $link.Arguments = $spec.arguments }
  if ($spec.workingDirectory) { $link.WorkingDirectory = $spec.workingDirectory }
  if ($spec.iconLocation) { $link.IconLocation = $spec.iconLocation }
  if ($spec.description) { $link.Description = $spec.description }
  if ($null -ne $spec.windowStyle) { $link.WindowStyle = [int]$spec.windowStyle }
  $link.Save()

  if (-not (Test-Path -LiteralPath $spec.path)) { throw "the shortcut was not written: $($spec.path)" }
  Write-Output $spec.path
  exit 0
}
catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}
