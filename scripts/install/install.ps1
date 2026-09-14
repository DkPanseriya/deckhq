<#
  DeckHQ - the one line, for Windows. WP-75.

      irm https://dkpanseriya.github.io/deckhq/install.ps1 | iex

  What it does, in order, and nothing else:

    1. Looks for Node 18 or newer on the PATH. If it is not there it says so
       and OFFERS to install it with `winget install OpenJS.NodeJS.LTS`. It
       asks first, every time.
    2. `npm install -g deckhq@latest`.
    3. Asks whether to put DeckHQ on the Desktop and in the Start Menu, and
       runs `deckhq shortcut --install --yes` only if you say yes.
    4. Runs `deckhq app`.

  THIS SCRIPT IS NOT PART OF THE RUNTIME. DeckHQ has zero runtime
  dependencies and this file is not in the npm tarball (`package.json`'s
  `files` list does not carry `scripts/`); it is published as a static file
  beside the documentation site. Nothing here is imported by the product.

  NETWORK: `winget` if you agree to it, and `npm`. Nothing else. No telemetry,
  no version ping, no analytics. DeckHQ itself makes no outbound network calls
  of any kind.

  IT IS SAFE TO RUN TWICE. Every step is idempotent: an up-to-date global
  install is a no-op, the shortcut installer records what it wrote and refuses
  to overwrite a file it did not write, and `deckhq app` reuses a running
  DeckHQ rather than starting a second one.

  WINDOWS POWERSHELL 5.1 IS THE FLOOR, and it is the shell most people on
  Windows still have. So: no `&&`, no `||`, no ternary `? :`, no `??`, no
  null-conditional `?.`, and no `param()` block - a script run through `iex`
  is a string, and a param block is not allowed at the top of one.
#>

$ErrorActionPreference = 'Stop'
$DeckhqMinNode = 18

function Write-Step {
    param([string] $Text)
    Write-Host ''
    Write-Host "  $Text"
}

function Write-Warn {
    param([string] $Text)
    Write-Host ''
    Write-Host "  $Text" -ForegroundColor Yellow
}

function Test-Have {
    param([string] $Name)
    $found = Get-Command $Name -ErrorAction SilentlyContinue
    if ($null -eq $found) { return $false }
    return $true
}

# One question. A session with no console answers no to everything, which is
# the only safe default for a script that can install software.
function Read-YesNo {
    param([string] $Question)
    if ($env:DECKHQ_INSTALL_YES -eq '1') { return $true }
    if (-not [Environment]::UserInteractive) { return $false }
    Write-Host ''
    $reply = Read-Host "  $Question [y/N]"
    if ($null -eq $reply) { return $false }
    $trimmed = $reply.Trim().ToLowerInvariant()
    if ($trimmed -eq 'y') { return $true }
    if ($trimmed -eq 'yes') { return $true }
    return $false
}

# The major version of the Node on the PATH, or 0.
function Get-NodeMajor {
    if (-not (Test-Have 'node')) { return 0 }
    # No `2>$null` on a native command: in Windows PowerShell 5.1 that wraps
    # every stderr line in a NativeCommandError and makes a healthy exit look
    # like a failure. The try/catch is the whole guard.
    try {
        $raw = & node -p 'parseInt(process.versions.node, 10)'
    }
    catch {
        return 0
    }
    $n = 0
    if ([int]::TryParse([string]$raw, [ref] $n)) { return $n }
    return 0
}

# winget writes the new PATH into the registry, and this session was started
# with the old one. Re-read both halves rather than telling the user to open a
# new terminal for something we can fix here.
function Update-PathFromRegistry {
    $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $user = [Environment]::GetEnvironmentVariable('Path', 'User')
    $parts = @()
    if ($machine) { $parts += $machine }
    if ($user) { $parts += $user }
    if ($parts.Count -gt 0) { $env:Path = ($parts -join ';') }
}

function Install-Deckhq {
    Write-Host ''
    Write-Host '  DeckHQ - every AI coding session on your machine, on one office floor.'
    Write-Host '  Local, private, MIT. This installs one npm package and opens a window.'

    $major = Get-NodeMajor

    if ($major -lt $DeckhqMinNode) {
        if ($major -eq 0) {
            Write-Step "Node $DeckhqMinNode or newer is needed, and there is no node on your PATH."
        }
        else {
            Write-Step "Node $DeckhqMinNode or newer is needed. The node on your PATH is $major."
        }

        if (-not (Test-Have 'winget')) {
            Write-Warn 'winget is not on this machine either, so there is nothing to offer.'
            Write-Warn 'Install Node from https://nodejs.org/en/download and run this again.'
            return 1
        }

        if (-not (Read-YesNo 'Install Node with `winget install OpenJS.NodeJS.LTS`?')) {
            Write-Warn 'Nothing was installed. https://nodejs.org/en/download installs it too.'
            return 1
        }

        Write-Step 'winget install -e --id OpenJS.NodeJS.LTS'
        & winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements | Out-Host
        Update-PathFromRegistry

        $major = Get-NodeMajor
        if ($major -lt $DeckhqMinNode) {
            Write-Warn 'Node is still not on this session''s PATH. Open a new PowerShell and run'
            Write-Warn 'this again - the installer put it somewhere this window cannot see yet.'
            return 1
        }
    }

    $version = & node -v
    Write-Step "Node $version - good."

    if (-not (Test-Have 'npm')) {
        Write-Warn 'npm is not on your PATH, and it normally comes with Node.'
        Write-Warn 'Install Node from https://nodejs.org/en/download and run this again.'
        return 1
    }

    Write-Step 'npm install -g deckhq@latest'
    & npm install -g deckhq@latest | Out-Host
    if ($LASTEXITCODE -ne 0) {
        Write-Warn "npm exited $LASTEXITCODE. Nothing else was run."
        return $LASTEXITCODE
    }

    Update-PathFromRegistry
    if (-not (Test-Have 'deckhq')) {
        Write-Warn 'deckhq was installed but is not on this PATH. npm puts global commands in:'
        Write-Host ''
        Write-Host "    $(& npm prefix -g)"
        Write-Host ''
        Write-Warn 'Open a new PowerShell and run `deckhq app`.'
        return 1
    }

    # The same question `deckhq app` asks on its first window, asked here
    # because this script has the console. Saying no costs nothing: `deckhq
    # shortcut --install` is there whenever you want it, and `--remove --yes`
    # takes back only what DeckHQ wrote.
    if (Read-YesNo 'Put DeckHQ on your Desktop and Start Menu?') {
        Write-Step 'deckhq shortcut --install --yes'
        & deckhq shortcut --install --yes | Out-Host
        if ($LASTEXITCODE -ne 0) {
            Write-Warn 'The shortcut could not be written; DeckHQ still works.'
        }
    }
    else {
        Write-Step 'No shortcut. `deckhq shortcut --install` whenever you want one.'
    }

    Write-Step 'deckhq app'
    & deckhq app --no-pin | Out-Host
    return 0
}

# `Out-Host` on every native call above, and no bare expression anywhere in
# the function, so this variable is the exit code and nothing else - a
# function's return value in PowerShell is everything it wrote to the success
# stream, and `npm`'s own output goes there unless it is sent to the host.
$deckhqExit = Install-Deckhq

# `exit` only when this is a file. Run through `irm ... | iex` the script is a
# string in the user's own session, and `exit` there closes their terminal -
# after a successful install, which would be a memorable way to end.
if ($MyInvocation.MyCommand.Path) { exit $deckhqExit }
