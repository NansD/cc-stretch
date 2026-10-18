// Checks a package of cc-stretch end to end in a live Claude Code session: the package is loaded with
// --plugin-dir in a WezTerm pane and driven with `wezterm cli`, and every screen change is recorded
// with its escapes. Each step waits for what it expects to see and records pass or fail with what it
// saw. finish() writes frames.jsonl and report.json into `out`, which render.mjs turns into a video.
// As of Claude Code 2.1.302 a save writes the person's user settings, so they are kept at the start
// and put back by finish().
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { claudePath, keepSettings, openPane, sleep } from '../recorder.mjs';
import { parseScreen, plainRows, PRIVATE } from '../screen.mjs';

export { sleep };
/** The first highlight swatch, and the light text drawn on it. */
export const DEEP = 'rgb(38,79,120)', LIGHT_TEXT = 'rgb(242,242,242)';
/** The dark theme's tinted highlights by place, as PALETTES in hooks/register.tsx makes them. */
export const TINTS = ['rgb(64,48,2)', 'rgb(44,34,64)', 'rgb(18,38,35)', 'rgb(54,30,22)'];
// The dark theme's suggestion colour as of Claude Code 2.1.302, which a hyperlink is underlined in.
const LINK_FG = 'rgb(153,204,255)';
const COLS = 100, ROWS = 30;
// The session reads the person's own instructions too; these keep it to the question.
const APPEND = 'This session is a recorded product test. Write in English only, answer from the question alone without using any tools, and do not end replies with a status block or any closing summary.';
// The installed cc-stretch is turned off for the session only, so the package under test is the one loaded.
const ONLY_PACKAGE = JSON.stringify({ enabledPlugins: { 'cc-stretch@cc-stretch': false } });

/** Begins a check of the package at `plugin`; open() starts each session. */
export function startCheck({ plugin, out, append = APPEND }) {
	mkdirSync(out, { recursive: true });
	const claude = claudePath();
	const report = { plugin, claude: execFileSync(claude, ['--version'], { encoding: 'utf8' }).trim(), started: new Date().toISOString(), size: { cols: COLS, rows: ROWS } };
	const putSettingsBack = keepSettings();
	const steps = [];
	const frames = [];
	const pointerModes = [];
	const t0 = Date.now();
	const now = () => (Date.now() - t0) / 1000;
	let pane;
	let sessions = 0;

	/** Starts a session in a new pane, in fullscreen unless told otherwise. */
	function open({ fullscreen = true } = {}) {
		const debugFile = `${out}/debug-${sessions++}.log`;
		pane = openPane({
			cols: COLS, rows: ROWS, t0, frames, debugFile,
			command: ['env', '-u', 'CLAUDE_CODE_CHILD_SESSION', `CLAUDE_CODE_NO_FLICKER=${fullscreen ? 1 : 0}`,
				claude, '--debug-file', debugFile, '--plugin-dir', plugin, '--settings', ONLY_PACKAGE, '--model', 'opus', '--append-system-prompt', append],
		});
	}
	async function close() {
		const closing = pane;
		pane = undefined;
		await closing?.close();
	}

	const screen = () => parseScreen(pane?.last() ?? '');
	const rows = () => plainRows(screen());
	const text = () => rows().join('\n');
	const send = (keys) => pane.send(keys);
	const mouse = (button, row, col, isUp = false) => {
		const pixels = pane.mouse(button, row, col, isUp);
		if (pointerModes.at(-1)?.pixels !== pixels) pointerModes.push({ t: now(), pixels });
	};
	async function click(row, col) {
		mouse(0, row, col);
		await sleep(90);
		mouse(0, row, col, true);
	}
	async function type(words) {
		for (const ch of words) {
			send(ch);
			await sleep(14);
		}
	}
	/** Types `words` and sends them. */
	async function submit(words) {
		await type(words);
		await sleep(500);
		send('\r');
	}
	/** Whether `test` holds within `ms`. */
	async function waitFor(test, ms) {
		const end = Date.now() + ms;
		while (Date.now() < end) {
			if (test()) return true;
			await sleep(150);
		}
		return test();
	}
	/** Whether the empty composer shows within 90 s, and a moment for the session to take keys. */
	async function ready() {
		if (!(await waitFor(() => /─\n❯/.test(text()), 90000))) return false;
		await sleep(1500);
		return true;
	}

	/** A toolbar row's text, or undefined while it is not drawn. */
	const rowText = (label) => rows().find((r) => r.startsWith(label));
	const rowIndex = (label) => rows().findIndex((r) => r.startsWith(label));
	/** The rows of the reply whose first row matches `start`, up to the line that ends its turn. */
	function replyRange(start) {
		const r = rows();
		const from = r.findIndex((x) => start.test(x));
		const end = r.findIndex((x, i) => i > from && / · done /.test(x));
		return [from, end < 0 ? r.length : end];
	}
	/** The closed stretches drawn in that reply: pressable runs that are not hyperlinks and not a «. */
	function closedStretches(start = /^⏺/) {
		const [from, end] = replyRange(start);
		return screen().flatMap((runs, row) => (row >= from && row < end ? runs : [])
			.filter((x) => x.link === null && x.text.trim() !== '' && x.text.trim() !== '«' && (x.underline || x.bg === DEEP || TINTS.includes(x.bg)) && x.fg !== LINK_FG)
			.map((x) => ({ ...x, row })));
	}
	/** Clicks `word` on the toolbar row that starts with `label`; false when it is not there. */
	async function press(label, word) {
		const r = rowIndex(label);
		const c = r < 0 ? -1 : rows()[r].indexOf(word, label.length);
		if (c < 0) return false;
		await click(r, c + Math.floor(word.length / 2));
		return true;
	}

	/** Runs `act`, then waits up to `ms` for `check`, and records the step with what the screen shows. */
	async function step(name, caption, act, check, ms = 15000) {
		const at = now();
		let acted;
		try {
			acted = (await act()) !== false;
		} catch {
			acted = false;
		}
		const pass = acted && (await waitFor(check, ms));
		await sleep(700);
		const seen = { toolbar: ['marks ', 'highlight '].map(rowText).filter(Boolean), stretches: closedStretches().slice(0, 4), answer: rows().filter((r) => /⎿/.test(r)).slice(-1) };
		steps.push({ name, caption, pass, t: at, settled: now(), seen });
		writeFileSync(`${out}/${String(steps.length).padStart(2, '0')}-${name}.txt`, `${rows().map((r) => (PRIVATE.test(r) ? '' : r)).join('\n')}\n`);
		console.log(`${pass ? 'PASS' : 'FAIL'} ${name}: ${caption}`);
		return pass;
	}

	/** The options a save wrote for a --plugin-dir session, as of Claude Code 2.1.302. */
	function savedOptions() {
		try {
			return JSON.parse(readFileSync(`${homedir()}/.claude/settings.json`, 'utf8')).pluginConfigs?.['cc-stretch@inline']?.options ?? null;
		} catch {
			return null;
		}
	}

	/**
	 * Closes the session, puts the settings back, and writes the frames and the report; `error` failed the
	 * run. The process exits 1 when the run failed or any step did.
	 */
	async function finish(error) {
		if (error !== undefined) report.error = String(error?.stack ?? error);
		await close().catch(() => {});
		putSettingsBack();
		Object.assign(report, { pointerModes, steps, passed: steps.filter((s) => s.pass).length, total: steps.length });
		writeFileSync(`${out}/frames.jsonl`, frames.map((f) => JSON.stringify(f)).join('\n'));
		writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
		console.log(`${report.passed}/${report.total} steps passed`);
		if (error !== undefined || report.passed < report.total) process.exitCode = 1;
	}

	return { report, frames, now, open, close, screen, rows, text, send, mouse, click, type, submit, waitFor, ready, rowText, rowIndex, replyRange, closedStretches, press, step, savedOptions, finish };
}
