# Backlog

Lanes awaiting triage. Verdicts: architect | direct | drop | defer | pending.
Checkbox marks a lane consumed (plan written, or direct commit landed).

## Lanes

- [ ] **plugin-folder** — an install copies the plugin, not the repo's dev tools · verdict: direct · waits on: the uncommitted changes to `bench/replay.ts` and `bench/labels.ts` landing or being dropped
- [ ] **renderers-use-drawn-as** — every renderer draws a stretch the way `drawnAs` says · verdict: direct
- [ ] **keyboard-item-words** — the list rule finds the reply item by the words a reply uses for it · verdict: direct
- [ ] **judge-controls** — a grading run whose judge misgrades a known answer is refused · verdict: direct
- [ ] **bench-one-copy** — each prompt, flag list and scoring rule in the bench exists once · verdict: defer · promote when: the README's numbers are next rerun
- [ ] **letters-with-ime** — letters work with an input method on, or the README says to switch it off · verdict: pending · needs: a live session with a Chinese or Japanese input method
- [ ] **bench-outside-git** — the bench runs from a source archive · verdict: defer · signal: `Command failed: git rev-parse HEAD` · promote when: someone runs the bench from an archive
- [ ] **replay-counts-recomputed** — published replay counts follow the current measurement · verdict: defer · signal: none · promote when: a change to what the skim counts
- [ ] **nested-key-separator** — no two stretches in a reply share a key · verdict: defer · signal: none · promote when: a stretch opens a different one, or opens in its holder's colour
- [ ] **old-replies-live** — on Claude Code 2.1.300, a reply from before a style save keeps its stretches · verdict: pending · needs: a live session on Claude Code 2.1.299 or 2.1.300
- [ ] **theme-read** — stretch colours follow the theme the screen shows · verdict: defer · signal: none · promote when: a reader on a light screen reports dark highlights
- [ ] **tinted-256** — the four tinted highlights stay four colours on a 256-colour terminal · verdict: defer · signal: none · promote when: a reader reports two tinted stretches in one colour
- [ ] **tinted-neighbours** — stretches side by side on screen differ in tinted colour · verdict: pending · needs: a design call on whether neighbours on screen must differ
- [ ] **open-colour-gap** — opened words are in their colour from their first frame · verdict: defer · signal: none · promote when: the gap shows in a recorded take

## plugin-folder

As of Claude Code 2.1.302, an install from GitHub copies every tracked file, because
`.claude-plugin/marketplace.json` gives the plugin as `"source": "./"`, and it runs `npm install` on
the dev `package.json`. A fresh install measured 48 MB: `node_modules` 45 MB (typescript and
playwright), `docs/` 1.8 MB, then `bench/`, `film/` and `tests/`. The plugin itself (`hooks/`,
`types/`, `.claude-plugin/`) is about 110 KB.

Move the plugin's manifest, `hooks/` and `types/` into a folder of their own and point the
marketplace at it. Tests, bench and film import `../hooks`, and `bench/ab.ts` hashes
`hooks/parse.ts` by path into each run's manifest (`ASKING_CODE`), so make the move when no bench
run needs to resume.

## renderers-use-drawn-as

`compose` in `hooks/reply.tsx`, and `linkedMarkdown` and `writeOpen` in `hooks/register.tsx`, each
decide on their own whether a stretch is drawn as text, open or a link. `drawnAs` in
`hooks/parse.ts` says it once, and `hooks/layout.ts` and the bench use it. `writeOpen` does not
check `isClosed`, so where every stretch is drawn open, an unclosed `{{a|b` shows `b`; everywhere
else it shows `a`. Derive all three from `drawnAs` and extend the parity test in
`tests/drawn.test.tsx` to the desktop path. PR #12, merged in a65fbb8, changed both files; the three
functions are still there after it.

## keyboard-item-words

`KEYBOARD_ITEMS` in `bench/tasks.ts` knows the reply item only as `client`, `click` or `in-reply`.
The `keyboard-rewrite` task's own reply calls it "The reply itself.", so an answer that keeps that
item as a stretch of its own breaks `items-stay-visible`. Seen in the bench run comparing the 0.3.7
and 0.4.0 guides, 0.4.0 guide, repeat 1, where an override records it. Add `reply itself` to that
item's words. A run frozen on the old task then refuses to resume.

## judge-controls

A grade counts today when the judge's answer parses, so a judge that says yes to everything, or
reads "never" backwards, passes every check. Add control answers with a known grade to each run
(one that leaves out a must-know point, one that makes a forbidden claim), and refuse a run's
grades when the judge gets a control wrong.

## bench-one-copy

- `recall` and the rewrite prompt are in both `bench/ab.ts` and `bench/replay.ts`.
- The code that turns verdicts into scores is in both `bench/report.ts` and `bench/coverage.ts`.
- `bench/replay.ts` spells out the `claude -p` flags that `claudeArgs` in `bench/grading.ts` builds.
- A `bench/labels.ts` left uncommitted in a checkout is superseded by `bench/ab.ts`, and its
  `marked` is a different function from the one in `bench/measure.ts`. Delete it rather than commit
  it.

`replay.ts`, `report.ts` and `coverage.ts` feed the README's numbers, so change them when those
numbers are rerun, and the numbers change once.

## letters-with-ime

Not checked: while an input method composes, a letter key may stay in the composition, so only
committed text such as 啊 reaches `prompt.edit`. That matches no letter, so it would be typed and
the letters would go away. If a live check shows this, the README's letters paragraph says to
switch the input method off first.

## bench-outside-git

- Problem: `bench/ab.ts` runs `git rev-parse HEAD` to record the revision in a run's manifest, and
  throws outside a git checkout.
- Failure sequence: on a `git archive` of v0.3.7, `bun bench/stub/check.ts` failed three cases with
  `fatal: not a git repository`; a clone of the same tag passed.
- Signal: `Command failed: git rev-parse HEAD` in the run's output.
- Promote when: someone reports running the bench from an archive, or the bench is documented for
  use outside a clone.
- Fix shape: a resumed run does not compare the revision, so record it as unknown when git fails.

## replay-counts-recomputed

- Problem: `bench/out/replay.jsonl` stores the skim and full word counts taken at replay time, and
  `bench/report.ts` publishes them as stored. A change to how `bench/measure.ts` or
  `hooks/parse.ts` counts the skim leaves the published numbers as they were.
- Failure sequence: ec6a1b2 began counting a short form over several lines as drawn open, and
  `bench/results.md` kept project B at 19% until b0585db recomputed the rows by hand (21%).
- Signal: none. Nothing compares the stored counts with what `bench/measure.ts` gives today.
- Promote when: the next change to `bench/measure.ts` or `hooks/parse.ts` that changes what the
  skim counts. Neither file changed between b0585db and ec1b1d7.
- Fix shape: `bench/report.ts` recomputes skim and full from each row's saved text with
  `bench/measure.ts`; rows without text (the native rows) keep their stored counts.

## nested-key-separator

- Problem: a stretch's key joins its short form to its parents' with ` › ` (`KEY_SEPARATOR` in
  `hooks/parse.ts`), so a short form that itself holds ` › ` can take the key of a nested stretch.
- Failure sequence: `{{a › b|x}} {{a|{{b|y}}}}` keys as `a › b`, `a`, `a › b` (checked at
  ec1b1d7). The open list and the keyboard letters address stretches by key, so they cannot tell
  the first stretch from the nested one.
- The colour an opened stretch takes has the same cause. The open order finds a stretch's holder with
  `parentOf(opened.key)` in `hooks/register.tsx`. In `{{p|x {{q › r|y}}}}` the nested key is
  `p › q › r`, whose holder reads as `p › q`, a key no stretch has, so the nested stretch is not kept
  off p's colour. The tinted highlight passes the holder down the parse and is not affected.
- Signal: none. Nothing reports two stretches with one key.
- Promote when: someone reports a stretch that opens a different one, or keys change for another
  reason.
- Fix shape: join keys with a character a short form cannot hold, such as a noncharacter. That
  changes every nested stretch's key, so open lists saved before it read nested stretches as closed
  once. The open order can take a stretch's holder from the parse, as `placesOf` does.

## old-replies-live

Claude Code 2.1.299 and 2.1.300 hand the AssistantMessage site a reply as the streaming filter left
it, with its long forms gone. `rawOf` in `hooks/register.tsx` finds the markup again: a reply the
plugin did not keep, such as one from before a style save reloaded the plugin, is found by reading
the session's messages once per load. Only the plugin test engine covers this; 0.5.0's live checks
ran on 2.1.302. Acceptance: on 2.1.300, a reply drawn before `/cc-stretch:style` and a save still
shows its stretches after the save.

## theme-read

- Problem: `isLight` in `hooks/register.tsx` reads the `theme` row from `$.config.list` and takes
  any value that does not start with `light` as dark. As of Claude Code 2.1.302 the row holds the
  setting, so `auto` reads as `auto`, not as the theme it resolves to.
- Failure sequence: theme `auto` on a light screen, a `custom:<name>` theme, a theme row another
  plugin hides, or a list that fails. Under tinted, closed stretches sit on the dark palette's
  near-black highlights (`#403002`, `#2c2240`, `#122623`, `#361e16`), readable with light text but
  not the pale ones meant for a light screen. Opened words take the dark palette's colours on white,
  at 1.3–1.9:1 contrast, as they did before 0.5.0.
- The read runs on every draw of a reply that is tinted or has an open stretch. A theme change is
  not one of the render hook's triggers, so a reply keeps its palette until it redraws for another
  reason, and two replies can show two palettes. The read's cost per draw is unmeasured.
- Signal: none.
- Promote when: a reader on a light screen reports dark highlights.
- Fix shape: classify the value explicitly (`light*`, `dark*`, and a stated choice for `auto`,
  `custom:*` and no row), with tests for a light row, an `auto` row and a failed list. Whether the
  read can leave the draw depends on Claude Code telling a plugin the theme changed; unchecked.

## tinted-256

- Problem: the tinted highlights are 24-bit colours. A terminal that shows 256 colours draws each as
  the nearest of its own.
- Failure sequence: by ansi-styles' 256-colour formula, on dark places 0 and 3 (`#403002`,
  `#361e16`) both become index 58, and on light places 0 and 2 both become 188. The first and fourth
  stretch on dark, or the first and third on light, then share a highlight. Computed, not seen on a
  256-colour terminal.
- Signal: none.
- Promote when: a reader reports two tinted stretches in one colour.
- Fix shape: choose the highlight mixes so the four land on four different 256-colour indexes on
  each theme, and test that with the same formula.

## tinted-neighbours

Under tinted, `placesOf` in `hooks/register.tsx` counts places in reading order, depth first, so
stretches hidden inside a closed one use up colours. In `A {{a|x {{b|1}} {{c|2}} {{d|3}}}} and
{{e|4}}.` a takes place 0 and e place 4, so the two closed stretches on screen share a colour. In
`{{p|p {{a|a {{a1|x}} {{a2|y}}}} {{b|b1}}}}` a takes 1 and b 5: the skip past p's colour lands on a's,
so the two siblings in p's open text match. Counting this way gives each stretch one colour before
and after it opens; making neighbours on screen differ is weighed against that.

## open-colour-gap

- Problem: the words a stretch adds take their colour from `tints`, which holds only stretches already
  in the open order. The hooks write that after the reply's Client posts the press, so until the
  next draw the growing words are drawn with no colour, in every style. Older than 0.5.0.
- Signal: none. The tests wait 2000 ms before reading colours, so they do not see it, and the gap is
  untimed.
- Promote when: the gap shows in a recorded take, or a reader reports it.
- Fix shape: under tinted the colour is known before the press, so the Client can be given each
  stretch's word colours along with its highlight.
