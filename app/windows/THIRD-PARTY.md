# Third-party code in DeckHQ for Windows

DeckHQ itself has no dependencies. The Windows app carries two things DeckHQ did not write, because
a window and a runtime have to come from somewhere. Neither is committed to this repository: each is
downloaded at build time from its publisher and refused unless it matches a hash. The values below
are the ones `pins.json` holds; `test/unit/app-windows.test.mjs` fails if the two files disagree.

## Microsoft Edge WebView2 SDK

|            |                                                                                                                                    |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Package    | `Microsoft.Web.WebView2` (NuGet)                                                                                                   |
| Version    | 1.0.2903.40                                                                                                                        |
| URL        | https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/1.0.2903.40/microsoft.web.webview2.1.0.2903.40.nupkg                 |
| SHA-512    | `a432d2ae9ca66b7c723865e5c37028c32ed771e05d7896ee919cca2d574f085bf27e79fc3eb08bca5327e9ce39ea36b44dc38e6a5f0875009538d0d153638693` |
| Licence    | BSD-style, "Copyright (C) Microsoft Corporation. All rights reserved." Shipped as `licenses\WebView2-LICENSE.txt`.                 |
| Signature  | Authenticode, `CN=Microsoft Corporation, O=Microsoft Corporation`; checked by `fetch-webview2.mjs` on every build.                 |
| Fetched by | `app/windows/fetch-webview2.mjs`                                                                                                   |

Four files are taken out of the package and shipped. Nothing else in it is used.

| File in the package                              | SHA-256                                                            |
| ------------------------------------------------ | ------------------------------------------------------------------ |
| `lib/net462/Microsoft.Web.WebView2.Core.dll`     | `88a3b62f45225a811cdb85df6dfd95c2bff9a0e43e3b04f813b125eaca56cc9f` |
| `lib/net462/Microsoft.Web.WebView2.WinForms.dll` | `29fc954c3fde1749817d158f3dd5ebe9efd3b3ce9708d86092fb1e9f023a1cb0` |
| `runtimes/win-x64/native/WebView2Loader.dll`     | `462b36fd1be6ca9f7563466a89e57c41ef4a4def3e0a84fa885d203aea4a3aaf` |
| `runtimes/win-arm64/native/WebView2Loader.dll`   | `cb561ae4537e39bba5dd8af1f648f189d9562b1003fd110a9e889ace527fb4e8` |
| `LICENSE.txt`                                    | `0af8f1b807512aae39c2ac1aa4d0cae65cabecb6fd554b8439a5162a0d6eca55` |

The SDK is not the browser. The **WebView2 Runtime** that draws the page is part of Windows 11 and
arrives with Microsoft Edge on Windows 10; DeckHQ does not ship it, install it or update it.

## Node.js

|            |                                                                                                                         |
| ---------- | ----------------------------------------------------------------------------------------------------------------------- |
| Version    | 24.19.0, Windows x64                                                                                                    |
| URL        | https://nodejs.org/dist/v24.19.0/node-v24.19.0-win-x64.zip                                                              |
| SHA-256    | The value that release's `SHASUMS256.txt` lists for the zip. Not yet committed to `pins.json`: see the note below.      |
| Licence    | MIT, with the licences of its bundled components. Shipped as `licenses\Node-LICENSE.txt`, from the zip's own `LICENSE`. |
| Signature  | Authenticode, `O=OpenJS Foundation`; checked by `fetch-node.mjs` on every build.                                        |
| Fetched by | `app/windows/fetch-node.mjs`, in CI. Only `node.exe` and `LICENSE` are taken; npm and corepack are not shipped.         |

The build that wrote this file ran on a machine that was not allowed to download the Node zip, so
its hash could not be measured there and none is written down. Until `node.sha256` in `pins.json`
is filled in, the zip is held to the hash nodejs.org publishes beside it and to the publisher's
signature on `node.exe`; the first CI run prints the value to commit.
