// Checks a save pressed while a reply streams, in a live session: the save reloads the plugin
// mid-stream, and no screen after it may show the markup of a long form that spans several lines.
//   node film/e2e/stream-save.mjs <package> <outDir>
import { parseScreen, plainRows, turnsDone } from '../screen.mjs';
import { sleep, startCheck } from './live.mjs';

const [PLUGIN, OUT] = process.argv.slice(2);
const QUESTION = 'Write one stretch whose short form is exactly: Here are forty fruits. Its long form is that sentence, then a bulleted list of forty fruit names, one per line, each line starting with - and the word fruit, like - fruit apple. After the stretch, on its own line, write: That is all.';
const REPLY = /^⏺.*Here are forty fruits/;

const live = startCheck({ plugin: PLUGIN, out: OUT });
const { closedStretches, press, report, rowText, rows, step, submit, text, waitFor } = live;
/** Rows that show what only the long form holds: a list line, or a stretch's braces. */
const leaks = (screenText) => screenText.split('\n').filter((x) => /^\s*[-•*]\s+fruit\b/i.test(x) || /\}\}|\{\{/.test(x));
const textOf = (frame) => plainRows(parseScreen(frame.screen)).join('\n');

let error;
try {
	live.open();
	await step('shown', 'The toolbar shown, bold tried, save offered', async () => {
		if (!(await live.ready())) return false;
		await submit('Say hello in three words.');
		if (!(await waitFor(() => turnsDone(text()) > 0, 240000))) return false;
		await sleep(1000);
		await submit('/cc-stretch:style');
		if (!(await waitFor(() => /^marks\s/.test(rowText('marks ') ?? ''), 15000))) return false;
		// In these runs (Claude Code 2.1.302) a press sent the moment the toolbar first drew was sometimes
		// dropped, so wait, and press again if so.
		await sleep(1500);
		for (let i = 0; i < 3 && !/\[bold\]/.test(rowText('marks ') ?? ''); i++) {
			await press('marks ', 'bold');
			await waitFor(() => /\[bold\]/.test(rowText('marks ') ?? ''), 4000);
		}
	}, () => /\[bold\].*save/.test(rowText('marks ') ?? ''));

	await step('save-mid-stream', 'Save pressed while the reply streams: the plugin reloads mid-stream', async () => {
		await submit(QUESTION);
		report.doneBefore = turnsDone(text());
		if (!(await waitFor(() => rows().some((x) => REPLY.test(x)) && turnsDone(text()) === report.doneBefore, 240000))) return false;
		report.pressedAt = live.now();
		return press('marks ', 'save');
	}, () => turnsDone(text()) > report.doneBefore, 300000);
	report.savedOptions = live.savedOptions();
	const after = report.pressedAt === undefined ? [] : live.frames.filter((f) => f.t >= report.pressedAt);
	report.savedWhileStreaming = after.some((f) => turnsDone(textOf(f)) === report.doneBefore);

	const leaked = after.map((f) => ({ t: f.t, rows: leaks(textOf(f)) })).filter((f) => f.rows.length > 0);
	report.leakedFrames = leaked.length;
	report.firstLeak = leaked[0] ?? null;
	await step('no-leak', 'No screen after the save shows a list line or braces of the long form', () => true,
		() => leaked.length === 0 && leaks(text()).length === 0 && rows().some((x) => REPLY.test(x)) && rows().some((x) => /^\s*That is all\.?\s*$/.test(x)));

	await step('opens', 'The finished reply opens its stretch into the list', async () => {
		const s = closedStretches(REPLY).find((x) => /forty/.test(x.text)) ?? closedStretches(REPLY)[0];
		if (!s) return false;
		await live.click(s.row, s.col + 1);
	}, () => rows().some((x) => /^\s*[-•*]\s+fruit\b/i.test(x)));
} catch (caught) {
	error = caught;
} finally {
	await live.finish(error);
}
