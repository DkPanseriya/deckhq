#!/bin/sh
# DeckHQ for macOS. Double-click this file and it installs DeckHQ and opens it.
#
# All it does is run the one line the README and the site print, which is the
# shell installer published beside this release:
#
#     curl -fsSL https://dkpanseriya.github.io/deckhq/install.sh | sh
#
# That script looks for Node 18 or newer and OFFERS to install it with brew,
# then installs DeckHQ, then asks whether to put DeckHQ on your desktop and
# applications menu, then opens the floor. It asks before each of those and it
# is safe to run twice. There is nothing in this file but the line above.
#
# This file is not signed or notarised, so macOS may refuse it on a
# double-click. Right-click it and choose Open, or paste the one line into a
# Terminal window, which does exactly the same thing.
echo "DeckHQ: this installs DeckHQ on this machine and then opens it."
echo "It checks for Node first, and it asks before it installs anything."
echo
curl -fsSL https://dkpanseriya.github.io/deckhq/install.sh | sh
