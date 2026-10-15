# Changelog

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
