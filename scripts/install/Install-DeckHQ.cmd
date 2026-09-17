@echo off
REM DeckHQ for Windows. Double-click this file and it installs DeckHQ and opens it.
REM
REM All it does is run the one line the README and the site print, which is the
REM PowerShell installer published beside this release:
REM
REM     irm https://dkpanseriya.github.io/deckhq/install.ps1 | iex
REM
REM That script looks for Node 18 or newer and OFFERS to install it, then
REM installs DeckHQ, then asks whether to write a Desktop and Start Menu icon,
REM then opens the floor. It asks before each of those and it is safe to run
REM twice. There is nothing in this file but the line above.
REM
REM This file is not signed, so Windows SmartScreen may warn about it. Signing
REM needs a certificate this project does not buy. Pasting the one line into a
REM PowerShell window does exactly the same thing and raises no warning.
echo DeckHQ: this installs DeckHQ on this machine and then opens it.
echo It checks for Node first, and it asks before it installs anything.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://dkpanseriya.github.io/deckhq/install.ps1 | iex"
echo.
pause
