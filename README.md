# cc-stretch

**Claude writes a lot. Now you can read a little.**

![A reply in Claude Code growing in place as phrases are clicked](docs/stretch.gif)

Replies arrive short. Click a linked phrase and it grows right where it stands. Click `«` and it
shrinks back. Claude is told which parts you opened, so it doesn't assume you read the rest.

## Install

In a Claude Code session:

```
/plugin install cc-stretch --marketplace pro-vi/cc-stretch
/tui fullscreen
```

In the terminal, clicks need Claude Code's fullscreen renderer. `/tui fullscreen` switches to it,
restarting and resuming your session. Without it, every stretch shows open. In the Claude desktop
app stretches are links: click one to open it in place, click `«` to close it. No setting needed.

## What to expect

You read about a sixth of what Claude writes. Across 69 real replies from four of my coding
projects, the version you see before clicking was 17% of the words Claude wrote without the
plugin. It carries about two of every three most important points; the rest is one click away. My
replies run long, so if yours are short you will save less. How this was measured, and how to run
it on your own transcripts: [`bench/`](bench/README.md).

## A silly plugin about a serious idea

In 1967 Ted Nelson described **stretchtext**: text that "stretches, becoming longer, with
replacement phrases, new details and additional clauses popping into place", and shrinks back on
demand, while "the reader remains oriented" (*Hypertext Note 8*). In 1970 he put it like this:
"Gaps appear between phrases; new words and phrases pop into the gaps, an item at a time."

It never caught on. The hard part, as later writers put it, was "how to author the text in the
first place" (Wadge and schraefel, 1999): someone had to write every level by hand.

Language models write every level for free, and they are good at it. So all this plugin does is
plug a 59-year-old idea into a terminal. The idea is Nelson's. Most of the code is Claude's. I
mostly clicked things.

Here is what that looks like. The reply opens with

> A monad is a type that wraps values and lets you chain steps that each return a wrapped value.

and one click on that sentence turns it into this (new words in bold, the way *Dream Machines*
appears to set the words Nelson's own example adds):

> **In programming,** a monad is a **generic** type that wraps values, **and it** lets you chain
> steps that each **take a plain value and** return a wrapped value**, without unwrapping anything
> by hand between the steps.**

The words you already read never move. New ones open up around them, on both sides.

## Three words

- **skim**: a reply with every stretch closed. What you read by default.
- **full**: the same reply with every stretch open. Everything Claude wrote.
- **read**: what you actually read, the skim plus the stretches you opened.

The point of the plugin is the gap between them. Nelson's word for this was levels; ours is
*progressive attention*. Progressive disclosure is the interface deciding what to hide from you.
Here you spend your attention one phrase at a time, and because nothing you have read moves, you
never lose your place.

## What else it does

- **Stretches nest.** A long form can hold more stretches.
- **Streaming stays clean.** While a reply streams, stretches already show as their short forms.
- **Quieter tool calls.** A finished group of tool calls folds to Claude Code's own one-line summary
  (`Ran 3 shell commands ▸ show`). Running calls, and calls that errored, stay open.
- **Nothing hides where clicks can't land.** On the classic renderer, and on other surfaces, every
  stretch is drawn open.

## Limits

- Claude writes every level up front, so a reply costs about as many tokens as before. You read
  less; you don't pay less.
- The `{{short|long}}` markup shows as raw text wherever the plugin isn't loaded.
- Built on Claude Code's function-hook plugin API, which is early access and changes between
  releases. Checked on Claude Code 2.1.292 to 2.1.294.
- In the Claude desktop app the plugin's tool-call folding is not drawn; the app shows its own.
  Desktop links checked on Claude Code 2.1.295.

## Development

```
npm test            # claude plugin validate . && claude plugin test .
npm run typecheck   # the benchmark scripts
```

The film in `film/` is made from a real recorded session: `film/take.mjs` drives Claude Code in a
WezTerm pane and records its screen, and `film/compose.mjs` renders the film. Archive pictures in the
film: photographs of the Hypertext Editing System at Brown University, October 1969, by Gregory Lloyd
(CC BY-SA 4.0, via Wikimedia Commons), and a photograph of Ted Nelson, 2010, by Beatrice Murch
(CC BY 2.0, via Wikimedia Commons). They are not stored in this repo; `film/CREDITS.md` lists each
source, its license and where to fetch it into `film/out/assets/`.

---

Not affiliated with Anthropic. Clawd belongs to Anthropic; stretchtext belongs to Ted Nelson.
