<!--
  The handover template — WP-70, `docs/07-STUDIO-DESIGN.md` §6.

  THIS FILE IS THE SHAPE, NOT A HANDOVER. It sits beside the planner's brief
  because it is the same kind of thing: a document this build asks an agent to
  write, kept in one place so the file that is asked for and the file
  `src/studio/handover.mjs` parses are the same file.

  The `{{HANDOVERS_DIR}}` placeholder is filled in by `handoverInstruction()`
  when a role brief is rendered. Nothing else here is substituted, and nothing
  here is written to a project on its own: a handover is written by the AGENT,
  as an ordinary file, or it does not exist.

  The four headings below are the four `SECTIONS` in `handover.mjs`, and the
  parse is tolerant — heading level, numbering and extra words are all fine.
  What is NOT invented is a missing section: a heading you leave out is
  reported to the user as missing, which is the point of there being four.
-->

# Handover for `<cardId>`

Written to `{{HANDOVERS_DIR}}/<cardId>.md`. The filename is the card id and nothing else, so
card `c7`'s handover is `c7.md`. A handover whose name matches no card on the board is still
read and still shown — as **unattached**, so a typo is visible rather than silent.

## What changed

What you actually did, in the terms a reviewer will look for: the files, the behaviour, the
decision behind anything surprising. Not a plan, and not a summary of the card — the card is
already on the board.

## Tests run

The commands you ran and the counts the runner printed, **in its words**. For example:

    npm test — 2044 tests, 2043 passing, 1 skipped

DeckHQ quotes this line back to the user and attributes it to you: it shows _"the handover says
2043 passing"_. It runs nothing to check it, and it never prints the figure in its own voice. A
count you did not see is a lie this product will repeat, so write what you saw and, if you ran
nothing, say that instead.

## Open questions

What you could not decide, what you had to guess, and what you would want the user to look at
first. An empty list is a real answer; an invented one is not.

## Next step

The one thing you would do next if the card came back to you. One or two lines.

<!--
  Writing this file does NOT move your card. It raises a review: the card is
  flagged and stays exactly where it is (§5.2 — the column is the user's). The
  user then either accepts the handover, naming the column the card moves to,
  or bounces it back with a note, which arrives in your next brief.
-->
