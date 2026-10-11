# The typeface DeckHQ ships

DeckHQ is set in two open typefaces. Their files are in this folder, are served by the DeckHQ daemon
from its own loopback address like every other file of the interface, and are never fetched from
anywhere else: a machine with no network draws the same letters as one with it.

They are declared in `../style.css` under the product's own family names, by role: **DeckHQ Sans**
and **DeckHQ Numeric** are Inter (the second with its tabular figures switched on), and **DeckHQ
Mono** is JetBrains Mono. The files are the makers' own, byte for byte; nothing was subset, renamed
inside the file or otherwise modified.

Both are licensed under the **SIL Open Font License, Version 1.1**, which permits bundling and
redistribution with software, including commercially. Each licence travels with its font:
`OFL-Inter.txt` and `OFL-JetBrainsMono.txt`.

| File                          | Typeface                             | Version | Source                                                                                           | Bytes  | SHA-256                                                            |
| ----------------------------- | ------------------------------------ | ------- | ------------------------------------------------------------------------------------------------ | ------ | ------------------------------------------------------------------ |
| `InterVariable.woff2`         | Inter, variable (weights 100 to 900) | 4.1     | https://github.com/rsms/inter/raw/v4.1/docs/font-files/InterVariable.woff2                       | 352240 | `693b77d4f32ee9b8bfc995589b5fad5e99adf2832738661f5402f9978429a8e3` |
| `JetBrainsMono-Regular.woff2` | JetBrains Mono, Regular              | 2.304   | https://github.com/JetBrains/JetBrainsMono/raw/v2.304/fonts/webfonts/JetBrainsMono-Regular.woff2 | 92164  | `a9cb1cd82332b23a47e3a1239d25d13c86d16c4220695e34b243effa999f45f2` |
| `JetBrainsMono-Bold.woff2`    | JetBrains Mono, Bold                 | 2.304   | https://github.com/JetBrains/JetBrainsMono/raw/v2.304/fonts/webfonts/JetBrainsMono-Bold.woff2    | 94588  | `c503cc5ec5f8b2c7666b7ecda1adf44bd45f2e6579b2eba0fc292150416588a2` |
| `OFL-Inter.txt`               | Inter's licence                      | 4.1     | https://github.com/rsms/inter/raw/v4.1/LICENSE.txt                                               | 4380   | `262481e844521b326f5ecd053e59b98c8b2da78c8ee1bdbb6e8174305e54935a` |
| `OFL-JetBrainsMono.txt`       | JetBrains Mono's licence             | 2.304   | https://github.com/JetBrains/JetBrainsMono/raw/v2.304/OFL.txt                                    | 4399   | `30f0c136e3c88e422d0791acd97238870f9054a9729bc34cf2ff0d4ed8cac4ad` |

- Inter: Copyright (c) 2016 The Inter Project Authors (https://github.com/rsms/inter).
- JetBrains Mono: Copyright 2020 The JetBrains Mono Project Authors
  (https://github.com/JetBrains/JetBrainsMono).

Fetched on 11 October 2026 from each maker's own repository at the release tag named above.
`test/unit/floor-fonts.test.mjs` checks every file here against this table, so a file that changes
without its row changing fails the build.

To use your machine's own typeface instead: Settings → Look → Advanced → Font → System.
