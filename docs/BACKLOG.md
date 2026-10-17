# Backlog

Lanes awaiting triage. Verdicts: architect | direct | drop | defer | pending.
Checkbox marks a lane consumed (plan written, or direct commit landed).

## Lanes

- [ ] **plugin-folder** — an install copies the plugin, not the repo's dev tools · verdict: direct · waits on: the uncommitted guide-bench work in `bench/` landing
- [ ] **renderers-use-drawn-as** — every renderer draws a stretch the way `drawnAs` says · verdict: direct · waits on: PR #12 merged or closed
- [ ] **keyboard-item-words** — the list rule finds the reply item by the words a reply uses for it · verdict: direct
- [ ] **judge-controls** — a grading run whose judge misgrades a known answer is refused · verdict: direct
- [ ] **bench-one-copy** — each prompt, flag list and scoring rule in the bench exists once · verdict: defer · promote when: the README's numbers are next rerun
- [ ] **letters-with-ime** — letters work with an input method on, or the README says to switch it off · verdict: pending · needs: a live session with a Chinese or Japanese input method
- [ ] **bench-outside-git** — the bench runs from a source archive · verdict: defer · signal: `Command failed: git rev-parse HEAD` · promote when: someone runs the bench from an archive
- [ ] **replay-counts-recomputed** — published replay counts follow the current measurement · verdict: defer · signal: none · promote when: a change to what the skim counts
- [ ] **nested-key-separator** — no two stretches in a reply share a key · verdict: defer · signal: none · promote when: a stretch opens a different one
- [ ] **row-start-style** — a paragraph's first row never shows the previous row's style · verdict: defer · signal: none · promote when: a stray underline is reported or filmed

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
`tests/drawn.test.tsx` to the desktop path. PR #12 changes both files, so land this after it.

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
- Signal: none. Nothing reports two stretches with one key.
- Promote when: someone reports a stretch that opens a different one, or keys change for another
  reason.
- Fix shape: join keys with a character a short form cannot hold, such as a noncharacter. That
  changes every nested stretch's key, so open lists saved before it read nested stretches as closed
  once.

## row-start-style

- Problem: in Claude Code 2.1.302 in WezTerm, the cells that start a paragraph's first row can take
  the style the previous paragraph's last row ends in (a stretch's underline, a letter's
  background). 13bf540 ends a styled last row with one plain cell; in recorded takes after it, this
  showed as two flashes of about 0.2 s, each while an opened item grew.
- Unknown: which layer keeps the style. The plugin's drawn tree has no style there (checked with the
  plugin test engine), so it is Claude Code's renderer or WezTerm.
- Failure sequence: open a list item whose paragraph is followed by another paragraph; while it
  grows, the next paragraph's first row shows the underline from column 0 for about 0.2 s.
- Signal: none in the product. In a recorded take: rows whose first run starts at column 0 with
  spaces and is underlined or has a background.
- Promote when: a user reports a stray underline, or the next release film shows it.
- Acceptance: recording the same reply in Terminal.app tells Claude Code from WezTerm; with the
  layer known, no styled row start in a take's growth frames.
