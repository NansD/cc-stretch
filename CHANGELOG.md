# Changelog

## 0.4.0 — 2026-10-16

- Stretches open from the keyboard. In the terminal's fullscreen layout, alt+↓ or ctrl+↓ puts a
  letter over each closed stretch in the latest three replies on screen (up to 26), and typing that
  letter opens it in place; alt+↑ or ctrl+↑ puts letters over each «, to close. Typing anything else
  puts the letters away and is typed as usual; so do recalling a prompt, sending one, and the same
  chord again. As of Claude Code 2.1.301 a plugin has no chords of its own, so these are the chords
  that scroll the diff panel's file list.
- Lists stay lists. Claude writes each list item as a short stretch of its own, so every item stays
  in view and opens on its own, instead of the whole list hiding inside one stretch. The guide gains
  one line: "Stretch list items, not whole lists." In the guide bench, on the list tasks the line
  was written for, answers kept every item in view 4 times out of 6 with it and 0 out of 5 without
  it; on held-out list tasks both kept them 6 times out of 6.
- A paragraph whose last row ends in a stretch no longer passes its underline, or a letter's
  background, to the start of the next paragraph's first row (seen in Claude Code 2.1.302 in
  WezTerm).
- A short film of what's new is attached to this release. `film/releases/0.4.0` records and cuts
  it, and `node film/compose.mjs --release=<version>` renders a release's film from its take.

## 0.3.7 — 2026-10-16

- Drawing a reply no longer hangs when a stretch sits inside a short form written over several
  lines, or when the reply holds a character from U+E000 to U+E004, which the plugin used to mark
  links. Nerd Font icons sit in that part of Unicode, the Private Use Area; those characters are now
  drawn as written, and a link after them on the same line opens.
- The benchmark counts a short form written over several lines as the terminal draws it: already
  open. One measured reply's skim went from 102 to 260 words, so project B's skim is 21% of the
  original's words instead of 19%; all projects together stay at 17%.
- `bench/ab.ts` compares versions of the guide on fixed tasks: it checks each answer against the
  guide's layout rules and has a model grade it. `bench/README.md` explains how to run it and how a
  new finding about how Claude writes stretchtext joins it.

## 0.3.6 — 2026-10-16

- Chinese and Japanese stretches grow a character at a time around their short form, and Thai a
  word at a time, instead of going blank and then appearing whole. The words you already read stay
  where they are.

## 0.3.5 — 2026-10-16

- Tool calls are drawn by Claude Code itself again: a click on a finished group's one-line summary
  opens it, and a terminal that draws no links no longer prints `▸ show (https://cc-stretch.invalid/)`
  ([#1](https://github.com/pro-vi/cc-stretch/issues/1)). The plugin's own `▸ show` fold is gone.
  Contributed by @ppikkuaho in [#10](https://github.com/pro-vi/cc-stretch/pull/10).
- Chinese and Japanese replies wrap between characters, so a row no longer ends half empty, and
  punctuation such as ， or 。 or a Japanese small kana never starts a row. Korean wraps at spaces and
  Thai between words; Thai vowel and tone marks no longer take a cell of their own.
- While a reply streams, a stretch after a code span that runs over a line break shows as its short
  form instead of its raw markup ([#6](https://github.com/pro-vi/cc-stretch/issues/6)).
- A line such as "```python …" inside a code block no longer ends the block
  ([#7](https://github.com/pro-vi/cc-stretch/issues/7)).
- Emoji such as 🚀 count as two cells, so a click after one lands on the phrase under it
  ([#8](https://github.com/pro-vi/cc-stretch/issues/8)).
- `npm run bench:report` runs on a fresh clone without writing over the published numbers
  ([#9](https://github.com/pro-vi/cc-stretch/issues/9)).

#6 to #9 were reported by @rahul05ranjan.

## 0.3.4 — 2026-10-15

- In fullscreen on Claude Code 2.1.300, a new reply's stretches are underlined and open on a click
  again. That version hands the plugin a finished reply with its long forms already hidden, so the
  short forms showed as plain text; a session resumed with `--continue` was not affected
  ([#3](https://github.com/pro-vi/cc-stretch/issues/3)). Contributed by @danielhernik in
  [#5](https://github.com/pro-vi/cc-stretch/pull/5).

## 0.3.3 — 2026-10-15

- The guide sent to Claude is back to its 0.3.1 text. The line 0.3.2 added, asking that a short form
  never be a label such as "What changed.", did not reduce such labels when 11 real replies were
  rewritten under both guides, and it made the shortest reading slightly longer.

## 0.3.2 — 2026-10-15

- Claude is told that each short form must say something itself, the gist of its long form. A label
  for the long form, such as "Details." or "What changed.", is not a short form.
- The README gathers where clicks don't work, and why, under Limits.

## 0.3.1 — 2026-10-15

- On Claude Code's main screen, where a printed reply cannot change and so every stretch shows open,
  the first such reply now says why in a dim line, and how to get clickable stretches: `/tui
  fullscreen`, or starting Claude Code with `CLAUDE_CODE_NO_FLICKER=1` in setups that start on the
  main screen anyway ([#3](https://github.com/pro-vi/cc-stretch/issues/3)).
- The README names those setups.

## 0.3.0 — 2026-10-15

- In the terminal, the words a stretch adds are drawn in a colour of their own, a different one for
  each stretch you open. The one you opened last is brightest; the others fade a little, and all of
  them fade once you write your next prompt. Each `«` keeps its stretch's bright colour.
- Closed stretches are underlined in the text's own colour, no longer blue, so colour marks only what
  you opened.
- A `«` after a rule or a code block goes on a line of its own, in the terminal and in the desktop
  app. Before, it turned the rule into plain dashes or left the code block unclosed.

## 0.2.0 — 2026-10-14

- Clickable stretches in the Claude desktop app: each stretch is a link that opens in place, and `«`
  closes it. Contributed by @LGuillermoAngaritaG in
  [#2](https://github.com/pro-vi/cc-stretch/pull/2).
- Desktop links also work when a short form holds brackets, code, a link or hundreds of characters.
- The markup stays hidden while a reply streams even with a phone or VS Code attached. Only a session
  with the desktop app attached shows it.
- In the terminal, a short form written over several lines is drawn open. Before, drawing its
  paragraph ran past Claude Code's time limit.
- The note that tells Claude what you opened no longer lists a short form written over several lines
  as unopened. When nothing was clicked, it no longer implies the desktop app drew every stretch open.
- A bug report template asks for the Claude Code version, where you run it, and what you see.

## 0.1.0 — 2026-10-14

- First release: stretchtext replies in Claude Code's fullscreen terminal.
