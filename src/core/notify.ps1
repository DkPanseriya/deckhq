# DeckHQ's Windows toast, WP-16.
#
# THIS FILE IS A FIXED SCRIPT. Nothing the user, an agent or a runtime can
# influence is ever spliced into its text: the title and the body arrive as
# PowerShell parameters — separate argv elements handed to `powershell.exe
# -File` by `spawn()` — and reach the toast through `CreateTextNode`, a DOM
# call that stores them as text rather than parsing them as XML.
#
# `-Command` was measured and rejected for this. `powershell -Command <script>
# <args...>` does NOT bind trailing arguments to `$args`: it APPENDS them to
# the command text. A title of `Ada "; & $( ... )` became script source and
# failed to parse. `-File` binds them as literal strings and the same title
# arrived intact as one argument. See docs/DEVIATIONS.md §99.
#
# A failure here is not an error the user should see; the caller ignores the
# exit code and the floor's badge carries the count regardless.

param(
  [Parameter(Mandatory = $true)][string]$Title,
  [Parameter(Mandatory = $true)][string]$Body
)

$ErrorActionPreference = 'Stop'

[void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
[void][Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType = WindowsRuntime]

$template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent(
  [Windows.UI.Notifications.ToastTemplateType]::ToastText02)
$texts = $template.GetElementsByTagName('text')
[void]$texts.Item(0).AppendChild($template.CreateTextNode($Title))
[void]$texts.Item(1).AppendChild($template.CreateTextNode($Body))

$toast = [Windows.UI.Notifications.ToastNotification]::new($template)

# Windows will not show a toast for an application it has no identity for, and
# DeckHQ is a node process with no AppUserModelID of its own. Windows
# PowerShell's own shortcut identity is the one every scripted toast on this
# platform borrows; it is why the toast reads as coming from PowerShell.
$aumid = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe'
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($aumid).Show($toast)
