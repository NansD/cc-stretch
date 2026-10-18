// Records the take of the 0.5.0 film: asks for a short reply with a few stretches, shows the style
// toolbar with /cc-stretch:style, turns bold and italic on and the underline off, picks a highlight
// colour and then tinted, opens a stretch in its tint, saves and closes. Recorded at 80 × 26 cells,
// so the film can draw its text larger. Writes out/releases/0.5.0/take.
//   node film/releases/0.5.0/take.mjs
import { REPO, sleep, startTake } from '../../recorder.mjs';

const OUT = `${REPO}/film/out/releases/0.5.0`;
// The demo session reads the person's own instructions too; these keep the take to the feature.
const APPEND = 'This session is a recorded product demo for a general audience. Write in English only, answer from the question alone without using any tools, and do not end replies with a status block or any closing summary. Answer in two short paragraphs with two stretches in each; no lists, headings or code.';
const QUESTION = 'Why do database indexes make reads faster but writes slower?';
// The fourth swatch, a deep purple, as the screen reports its background.
const PURPLE = 'rgb(75,59,107)';
// The plugin's tinted highlights of the first four places on the dark theme (PALETTES in
// hooks/register.tsx), as the screen reports them.
const TINTS = ['rgb(64,48,2)', 'rgb(44,34,64)', 'rgb(18,38,35)', 'rgb(54,30,22)'];

// Save writes the user's settings, which the session must read for the saved style to show after it.
const take = await startTake({ out: `${OUT}/take`, append: APPEND, cols: 80, rows: 26, sources: 'user,project,local' });
const lines = () => take.text().split('\n');
const toolbarRow = (label) => lines().find((r) => r.startsWith(label)) ?? '';
/** Where `word` sits on the toolbar row that starts with `label`, to click it. */
function onToolbar(label, word) {
	const row = lines().findIndex((r) => r.startsWith(label));
	const col = row < 0 ? -1 : lines()[row].indexOf(word, label.length);
	if (col < 0) throw new Error(`no "${word}" on the ${label.trim()} row:\n${take.text()}`);
	return { row, col, end: col + word.length };
}
/** Clicks a word on the toolbar, then waits for its row to show `shown`, `[word]` unless told otherwise, and the screen to be still. */
async function clickToolbar(name, label, word, shown = new RegExp(`\\[${word}\\]`)) {
	await take.click(name, onToolbar(label, word));
	await take.waitFor(() => shown.test(toolbarRow(label)), 10000, `${word} to show as ${shown}`);
	await take.still();
	await sleep(1300);
}

try {
	await take.ready();
	await take.ask(QUESTION);
	await sleep(1800);

	await take.type('/cc-stretch:style');
	await sleep(700);
	take.send('\r');
	await take.waitFor(() => /^highlight\s+\[no highlight\] colour tinted/m.test(take.text()), 15000, 'the toolbar');
	take.mark('shown');
	await take.still();
	await sleep(1800);

	await clickToolbar('bold', 'marks ', 'bold');
	await clickToolbar('italic', 'marks ', 'italic');
	await clickToolbar('underline', 'marks ', 'underline', /\] underline /);

	await clickToolbar('colour', 'highlight ', 'colour');
	const highlightRow = lines().findIndex((r) => r.startsWith('highlight '));
	const purple = take.screen()[highlightRow]?.find((run) => run.bg === PURPLE);
	if (purple === undefined) throw new Error(`no purple swatch on the highlight row:\n${take.text()}`);
	await take.click('swatch', { row: highlightRow, col: purple.col, end: purple.col + 2 });
	await take.settle(600, 10000);
	await sleep(1500);

	await clickToolbar('tinted', 'highlight ', 'tinted');
	await sleep(600);
	// With the underline off, a closed stretch is found by its tinted highlight: the second stretch in
	// reading order is the first run in another tint than the first one's.
	const tinted = take.screen().flatMap((runs, row) => runs.filter((r) => TINTS.includes(r.bg) && r.text.trim() !== '').map((r) => ({ row, col: r.col, end: r.col + r.text.length, bg: r.bg })));
	const second = tinted.find((r) => r.bg !== tinted[0]?.bg);
	if (second === undefined) throw new Error(`the reply has fewer than two tinted stretches:\n${take.text()}`);
	await take.click('open', second);
	await take.settle(1500, 15000);
	await sleep(2200);

	// While a save runs the row shows "saving"; once the plugin has loaded again, the saved style.
	await take.click('save', onToolbar('marks ', 'save'));
	await take.waitFor(() => /\[bold\]/.test(toolbarRow('marks ')) && !/ save |saving/.test(toolbarRow('marks ')) && /\[tinted\]/.test(toolbarRow('highlight ')), 20000, 'the saved style');
	await take.still(800);
	await sleep(1500);

	await take.click('close', onToolbar('marks ', 'close'));
	await take.waitFor(() => toolbarRow('marks ') === '', 10000, 'the toolbar to close');
	await take.still();
	await sleep(1800);
	take.mark('end');
} finally {
	await take.finish();
}
