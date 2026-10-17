# E2E map — cc-stretch

A Claude Code plugin: in the terminal's fullscreen layout a reply's stretches open in place when
clicked, and text in such a paragraph is selected by the plugin itself.

## Environments

| Environment | Reach | Ready when | Which build | Accounts | May write | Started by |
|---|---|---|---|---|---|---|
| local | `claude --plugin-dir <package> --settings '{"enabledPlugins":{"cc-stretch@cc-stretch":false}}'`, run with `CLAUDE_CODE_NO_FLICKER=1` in a WezTerm pane of 100 × 30 | the prompt's `❯` drawn under a rule | `<package>` is `git archive <sha>` of the commit under test, without `tests/` | the Claude Code login already on the machine | the clipboard, through a drag: save its text first and put it back | you |

There is no staging or production: the plugin runs only inside a reader's own Claude Code.

## Scripted

`npm test` runs `claude plugin validate .` and the specs in `tests/` under Claude Code's test
harness. The harness stands in for the host, so it does not draw a terminal, move a pointer or
reload the plugin: drawing, clicks and drags are proved in a live session.

## Driving a live session

`film/recorder.mjs` holds the pattern. Open the pane with `wezterm cli spawn` and `split-pane`;
type with `wezterm cli send-text --no-paste`; click by sending SGR mouse sequences; read every
screen with `wezterm cli get-text --escapes` and parse it with `film/screen.mjs`, which keeps
colours, underline, inverse and OSC 8 links. Wait for what the screen should show, never a fixed
delay: under load a redraw after a press took over a second.

As of Claude Code 2.1.302 a session reads a click's position in cells, counted from 1, until its
`--debug-file` log says `Mouse reports in pixels`, and in pixels from then on, at a cell's middle
pixel. In these runs the switch came once a reply holding a stretch was drawn, so a click sent in
pixels before that, such as on the style toolbar in a new session, is lost. Read the log before each
click.

## Features

### Open and close a stretch

- **Reach:** a reply whose paragraph holds a stretch; ask for "two stretches" in the prompt.
- **Drive:**
  1. Click a closed stretch (an underlined run that is not an OSC 8 link): its words grow in place,
     tinted, ending in `«`.
  2. Click the `«`: the stretch shrinks back to its short form.
- **Writes:** nothing.
- **Gotchas:** with `CLAUDE_CODE_NO_FLICKER=0` the session draws on the main screen, where every
  stretch is drawn open and nothing is pressable.

### Select text in a paragraph that holds a stretch

- **Reach:** a press away from a stretch, dragged, inside such a paragraph.
- **Drive:**
  1. Press, move with the button held, release inside the paragraph: the cells crossed are drawn
     inverse and their text is on the clipboard.
  2. Move the pointer into the paragraph and out of it: the highlight goes.
- **Writes:** the clipboard; save its text first and put it back.
- **Gotchas:** the paragraph hears the pointer leave only after it has heard it inside, so a driver
  that only sends a motion outside never clears a highlight.
