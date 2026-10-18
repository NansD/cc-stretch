// Checks the /cc-stretch:style toolbar in a live session: marks, a colour highlight, dim on it, reset,
// save, close, reopen, an opened stretch, a selection over a link, Claude Code's own collapse, and the
// main screen's message.
//   node film/e2e/style.mjs <package> <outDir>
import { linksOn } from '../screen.mjs';
import { DEEP, LIGHT_TEXT, sleep, startCheck } from './live.mjs';

const [PLUGIN, OUT] = process.argv.slice(2);
const DEEP_HEX = '#264f78';
// The light text moved 40% toward DEEP, as dim draws it on that highlight.
const DIM_ON_DEEP = 'rgb(160,177,193)';
const QUESTION = 'In one short paragraph with two stretches, why does a build cache miss? Cite https://docs.github.com/actions/caching in that paragraph.';

const live = startCheck({ plugin: PLUGIN, out: OUT });
const { click, closedStretches, press, report, rowIndex, rowText, rows, screen, send, step, submit, text, type, waitFor } = live;
/** Picks colour, then the deep swatch. */
async function pickDeep() {
	await press('highlight ', 'colour');
	await waitFor(() => /\[colour\]/.test(rowText('highlight ') ?? ''), 8000);
	const r = rowIndex('highlight ');
	const swatch = screen()[r]?.find((x) => x.bg === DEEP);
	if (!swatch) return false;
	await click(r, swatch.col);
}
const runCommand = () => submit('/cc-stretch:style');

let error;
try {
	live.open();
	await step('reply', 'A reply with two closed stretches, drawn underlined: no style saved', async () => {
		if (!(await live.ready())) return false;
		await submit(QUESTION);
	}, () => / · done /.test(text()) && closedStretches().length > 0 && closedStretches().every((s) => s.underline && !s.bold && s.bg === null), 300000);

	await step('menu', 'Typing /cc-stretch lists /cc-stretch:style', () => type('/cc-stretch'), () => /\/cc-stretch:style\s+\(cc-stretch\) Try how closed stretches look/.test(text()));
	for (let i = 0; i < '/cc-stretch'.length; i++) send('\x7f');
	await sleep(600);

	await step('shown', 'The toolbar: five marks and close; no highlight, colour, tinted; nothing to reset or save', runCommand,
		() => /^marks\s+bold italic \[underline\] strikethrough dim close\s/.test(rowText('marks ') ?? '') && /^highlight\s+\[no highlight\] colour tinted\s*$/.test(rowText('highlight ') ?? '') && !/inverse|reset|save/.test(rowText('marks ') ?? '') && rowText('text ') === undefined);

	await step('bold', 'Bold: every closed stretch turns bold, and reset and save appear', () => press('marks ', 'bold'),
		() => /\[bold\].*reset save close/.test(rowText('marks ') ?? '') && closedStretches().length > 0 && closedStretches().every((s) => s.bold));

	await step('highlight', 'Colour, then a deep swatch: the stretches take it, their text turned light', pickDeep,
		() => closedStretches().length > 0 && closedStretches().every((s) => s.bg === DEEP && s.fg === LIGHT_TEXT));

	await step('dim-on-highlight', 'Dim on a highlight: the light text moves toward the highlight, never the grey', () => press('marks ', 'dim'),
		() => /\[dim\]/.test(rowText('marks ') ?? '') && closedStretches().length > 0 && closedStretches().every((s) => s.bg === DEEP && s.fg === DIM_ON_DEEP && !s.dim));

	await step('reset', 'Reset: back to the saved style, underlined only; reset and save go', () => press('marks ', 'reset'),
		() => !/reset|save/.test(rowText('marks ') ?? '') && closedStretches().length > 0 && closedStretches().every((s) => s.underline && !s.bold && s.bg === null));

	await step('try-again', 'Bold and the deep highlight again, to save', async () => {
		await press('marks ', 'bold');
		await waitFor(() => /\[bold\]/.test(rowText('marks ') ?? ''), 8000);
		await pickDeep();
	}, () => /save/.test(rowText('marks ') ?? '') && closedStretches().every((s) => s.bold && s.bg === DEEP));

	await step('save', 'Save: written to the settings; the plugin reloads, the toolbar shows it as saved', () => press('marks ', 'save'),
		() => {
			const saved = live.savedOptions();
			return saved?.marks === 'bold,underline' && saved?.highlight === DEEP_HEX && /\[bold\] italic \[underline\]/.test(rowText('marks ') ?? '') && !/save/.test(rowText('marks ') ?? '') && closedStretches().every((s) => s.bold && s.bg === DEEP);
		}, 25000);
	report.savedOptions = live.savedOptions();

	await step('try-italic', 'Italic, tried and not saved', () => press('marks ', 'italic'),
		() => /\[italic\].*save/.test(rowText('marks ') ?? '') && closedStretches().every((s) => s.italic));

	await step('close', 'Close: the toolbar goes, the unsaved italic goes, the saved style stays', () => press('marks ', 'close'),
		() => rowText('marks ') === undefined && closedStretches().length > 0 && closedStretches().every((s) => s.bold && s.bg === DEEP && !s.italic));

	await step('reopen', 'Reopened: the toolbar shows the saved style', runCommand,
		() => /\[bold\] italic \[underline\]/.test(rowText('marks ') ?? '') && /◆◆/.test(rowText('highlight ') ?? ''));

	await step('open', 'A stretch opened: its words and its « are tinted, never highlighted', async () => {
		const s = closedStretches()[0];
		if (!s) return false;
		await click(s.row, s.col + 1);
	}, () => {
		const closer = screen().flatMap((runs) => runs).find((x) => x.text.trim() === '«');
		return closer !== undefined && closer.bg === null && closer.fg !== null;
	});

	await step('select', 'A drag across the link selects it, drawn inverse; the link stays a link', async () => {
		const [from, end] = live.replyRange(/^⏺/);
		const link = linksOn(screen(), /docs\.github\.com/).find((l) => l.row >= from && l.row < end);
		if (!link) return false;
		live.mouse(0, link.row, link.col);
		await sleep(120);
		for (let i = 1; i <= 4; i++) {
			live.mouse(32, link.row, link.col + i * 8);
			await sleep(90);
		}
		live.mouse(0, link.row, link.col + 32, true);
	}, () => screen().some((runs) => runs.some((x) => x.inverse && x.link?.includes('docs.github.com'))));

	await step('collapse', 'Claude Code’s own [-] collapses the panel', () => press('marks ', '[-]'),
		() => rowText('marks ') === undefined && /plugin panel hidden/.test(text()));

	await step('expand', 'Showing the panel again brings the toolbar back, still in the saved style', async () => {
		const r = rows().findIndex((x) => /plugin panel hidden/.test(x));
		if (r < 0) return false;
		await click(r, rows()[r].indexOf('plugin panel hidden') + 4);
	}, () => /\[bold\] italic \[underline\]/.test(rowText('marks ') ?? ''));
	await live.close();

	// On the main screen stretches are drawn open (as of Claude Code 2.1.302 a printed reply cannot
	// change there), so the command says why no toolbar shows.
	live.open({ fullscreen: false });
	await step('main-screen', 'On the main screen the command says the toolbar is drawn in fullscreen', async () => {
		if (!(await waitFor(() => /❯/.test(text()), 90000))) return false;
		await sleep(2000);
		await runCommand();
	}, () => /drawn in fullscreen/.test(text()), 20000);
} catch (caught) {
	error = caught;
} finally {
	await live.finish(error);
}
