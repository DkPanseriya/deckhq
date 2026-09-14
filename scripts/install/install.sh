#!/bin/sh
# DeckHQ — the one line, for macOS and Linux. WP-75.
#
#   curl -fsSL https://dkpanseriya.github.io/deckhq/install.sh | sh
#
# What it does, in order, and nothing else:
#
#   1. Looks for Node 18 or newer on the PATH. If it is not there it says so
#      and OFFERS to install it — `brew install node` on macOS, the distro's
#      own command printed for you to run on Linux. It asks first, every time.
#   2. `npm install -g deckhq@latest`.
#   3. Asks whether to put DeckHQ on your desktop and applications menu, and
#      runs `deckhq shortcut --install --yes` only if you say yes.
#   4. Runs `deckhq app`.
#
# THIS SCRIPT IS NOT PART OF THE RUNTIME. DeckHQ has zero runtime
# dependencies and this file is not in the npm tarball (`package.json`'s
# `files` list does not carry `scripts/`); it is published as a static file
# beside the documentation site. Nothing here is imported by the product.
#
# NETWORK: the three commands above — `brew`, `npm`, and whatever you choose
# to run for your distro — and nothing else. No telemetry, no version ping,
# no analytics. DeckHQ itself makes no outbound network calls of any kind.
#
# IT IS SAFE TO RUN TWICE. Every step is idempotent: an up-to-date global
# install is a no-op, the shortcut installer records what it wrote and refuses
# to overwrite a file it did not write, and `deckhq app` reuses a running
# DeckHQ rather than starting a second one.
#
# READING THE PROMPTS WHEN THIS IS PIPED. `curl … | sh` hands the script
# itself to the shell on stdin, so `read` would eat the script. Every question
# below is asked on /dev/tty, and a machine with no terminal is never asked
# anything: it installs the package and stops before anything else.

set -eu

DECKHQ_MIN_NODE=18

say() { printf '%s\n' "$*"; }
step() { printf '\n  %s\n' "$*"; }
warn() { printf '\n  %s\n' "$*" >&2; }

have() { command -v "$1" >/dev/null 2>&1; }

# One question, answered on the terminal rather than on stdin. A run with no
# terminal answers no to everything, which is the only safe default for a
# script that can install software.
ask() {
    if [ "${DECKHQ_INSTALL_YES:-}" = "1" ]; then
        return 0
    fi
    if [ ! -r /dev/tty ]; then
        return 1
    fi
    printf '\n  %s [y/N] ' "$1" >/dev/tty
    reply=''
    read -r reply </dev/tty || reply=''
    case "$reply" in
        y | Y | yes | YES | Yes) return 0 ;;
        *) return 1 ;;
    esac
}

# The major version of the Node on the PATH, or 0.
node_major() {
    if ! have node; then
        echo 0
        return 0
    fi
    node -p 'parseInt(process.versions.node, 10) || 0' 2>/dev/null || echo 0
}

# The command this distribution installs Node with. Printed, never run: a
# package manager that wants a password is a conversation this script has no
# business having on your behalf.
linux_node_command() {
    id=''
    if [ -r /etc/os-release ]; then
        # shellcheck disable=SC1091
        id=$(. /etc/os-release 2>/dev/null && printf '%s' "${ID:-}${ID_LIKE:+ $ID_LIKE}")
    fi
    case "$id" in
        *debian* | *ubuntu*) echo 'sudo apt-get install -y nodejs npm' ;;
        *fedora* | *rhel* | *centos*) echo 'sudo dnf install -y nodejs npm' ;;
        *arch*) echo 'sudo pacman -S --needed nodejs npm' ;;
        *alpine*) echo 'sudo apk add nodejs npm' ;;
        *suse*) echo 'sudo zypper install -y nodejs npm' ;;
        *) echo '' ;;
    esac
}

main() {
    say ''
    say '  DeckHQ — every AI coding session on your machine, on one office floor.'
    say '  Local, private, MIT. This installs one npm package and opens a window.'

    major=$(node_major)

    if [ "$major" -lt "$DECKHQ_MIN_NODE" ]; then
        if [ "$major" -eq 0 ]; then
            step "Node $DECKHQ_MIN_NODE or newer is needed, and there is no node on your PATH."
        else
            step "Node $DECKHQ_MIN_NODE or newer is needed. The node on your PATH is $major."
        fi

        os=$(uname -s 2>/dev/null || echo unknown)
        case "$os" in
            Darwin)
                if have brew; then
                    if ask 'Install Node with `brew install node`?'; then
                        step 'brew install node'
                        brew install node
                    else
                        warn 'Nothing was installed. https://nodejs.org/en/download installs it too.'
                        return 1
                    fi
                else
                    warn 'Homebrew is not installed either. Either:'
                    warn '  https://nodejs.org/en/download   — the official installer, no Homebrew'
                    warn '  https://brew.sh                  — then run this again'
                    return 1
                fi
                ;;
            Linux)
                cmd=$(linux_node_command)
                warn 'Install Node first. On this distribution that is:'
                if [ -n "$cmd" ]; then
                    warn ''
                    warn "    $cmd"
                    warn ''
                    warn 'Check the version it gives you — several distributions still ship a Node'
                    warn "older than $DECKHQ_MIN_NODE. https://nodejs.org/en/download has the current one."
                else
                    warn ''
                    warn '    https://nodejs.org/en/download'
                    warn ''
                fi
                warn 'Then run this again. Nothing was installed.'
                return 1
                ;;
            *)
                warn "This script knows how to help on macOS and Linux; this is $os."
                warn 'Install Node 18 or newer from https://nodejs.org/en/download, then:'
                warn ''
                warn '    npm install -g deckhq@latest'
                warn ''
                return 1
                ;;
        esac

        major=$(node_major)
        if [ "$major" -lt "$DECKHQ_MIN_NODE" ]; then
            warn "Node is still not on this shell's PATH. Open a new terminal and run this again."
            return 1
        fi
    fi

    step "Node $(node -v) — good."

    if ! have npm; then
        warn 'npm is not on your PATH, and it normally comes with Node.'
        warn 'Install Node from https://nodejs.org/en/download and run this again.'
        return 1
    fi

    step 'npm install -g deckhq@latest'
    npm install -g deckhq@latest

    if ! have deckhq; then
        warn 'deckhq was installed but is not on this PATH. npm puts global commands in:'
        warn ''
        warn "    $(npm prefix -g 2>/dev/null || echo '<npm prefix -g>')/bin"
        warn ''
        warn 'Add that to your PATH, open a new terminal, and run `deckhq app`.'
        return 1
    fi

    # The same question `deckhq app` asks on its first window, asked here
    # because this script has the terminal and the window will not. Saying no
    # costs nothing: `deckhq shortcut --install` is there whenever you want it,
    # and `--remove --yes` takes back only what DeckHQ wrote.
    if ask 'Put DeckHQ on your Desktop and applications menu?'; then
        step 'deckhq shortcut --install --yes'
        deckhq shortcut --install --yes || warn 'The shortcut could not be written; DeckHQ still works.'
    else
        step 'No shortcut. `deckhq shortcut --install` whenever you want one.'
    fi

    step 'deckhq app'
    deckhq app --no-pin
}

main "$@"
