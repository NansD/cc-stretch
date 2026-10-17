// Records a take of Claude Code: opens a WezTerm pane sized for the film, starts a real session in
// it, and saves every change of the screen, colours and links included, with the second it
// happened. A take script drives the session through the returned handle and calls finish(), which
// writes frames.jsonl and marks.json into `out`. Needs WezTerm and a signed-in `claude`.
import { execFile, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { lettersOn, linksOn, parseScreen, plainRows, pressablesOn } from './screen.mjs';

const run = promisify(execFile);
export const REPO = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
export const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const wez = (...args) => execFileSync('wezterm', ['cli', ...args], { encoding: 'utf8' }).trim();

/** The pane's size, which film/kit.js draws: COLS and ROWS there. */
const COLS = 100, ROWS = 30;

/** The keys a terminal sends for alt+down and alt+up. */
export const ALT_DOWN = '\x1b[1;3B', ALT_UP = '\x1b[1;3A';

/**
 * Starts a session with this repo's plugin and begins recording. `append` is added to the
 * system prompt, to keep a demo session to the feature.
 */
export async function startTake({ out, append }) {
	const claude = execFileSync('zsh', ['-lc', 'command -v claude'], { encoding: 'utf8' }).trim();
	mkdirSync(out, { recursive: true });
	const base = wez('spawn', '--cwd', REPO, '--', 'zsh', '-f');
	const lower = wez('split-pane', '--pane-id', base, '--bottom', '--cells', String(ROWS), '--', 'zsh', '-f');
	const pane = wez('split-pane', '--pane-id', lower, '--right', '--cells', String(COLS), '--cwd', REPO, '--',
		'env', '-u', 'CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_CODE_NO_FLICKER=1',
		claude, '--plugin-dir', REPO, '--setting-sources', 'project,local', '--model', 'opus', '--append-system-prompt', append);

	// As of Claude Code 2.1.302 the session asks the terminal for pointer positions in pixels, so a click
	// is sent at its cell's middle pixel, from the pane's size.
	const size = JSON.parse(execFileSync('wezterm', ['cli', 'list', '--format', 'json'], { encoding: 'utf8' })).find((p) => String(p.pane_id) === pane)?.size;
	if (size === undefined) throw new Error(`pane ${pane} is not in wezterm cli list`);
	const cellPx = (row, col) => [Math.round((col + 0.5) * size.pixel_width / size.cols), Math.round((row + 0.5) * size.pixel_height / size.rows)];

	const t0 = Date.now();
	const now = () => (Date.now() - t0) / 1000;
	const frames = [];
	let last = '';
	let isRecording = true;
	const recorder = (async () => {
		while (isRecording) {
			const { stdout } = await run('wezterm', ['cli', 'get-text', '--pane-id', pane, '--escapes'], { maxBuffer: 1 << 24 });
			if (stdout !== last) {
				frames.push({ t: now(), screen: stdout });
				last = stdout;
			}
		}
	})();

	const screen = () => parseScreen(last);
	const text = () => plainRows(screen()).join('\n');
	const marks = {};
	const mark = (name, extra = {}) => {
		marks[name] = { t: now(), ...extra };
		console.log('mark', name, JSON.stringify(marks[name]));
	};
	const send = (keys) => wez('send-text', '--pane-id', pane, '--no-paste', keys);

	async function waitFor(test, ms, what) {
		const end = Date.now() + ms;
		while (Date.now() < end) {
			if (test(text())) return;
			await sleep(100);
		}
		throw new Error(`timed out waiting for ${what}`);
	}

	/**
	 * Waits until the screen has changed since `since` (seconds into the take) and then not changed
	 * for `quiet` ms: what the last action started is done and nothing moves.
	 */
	async function settle(quiet, ms, since = now()) {
		const end = Date.now() + ms;
		while (Date.now() < end) {
			const lastChange = frames.at(-1)?.t ?? 0;
			if (lastChange > since && Date.now() - (t0 + lastChange * 1000) > quiet) return;
			await sleep(100);
		}
		throw new Error('the screen never settled');
	}

	async function type(words) {
		for (const ch of words) {
			send(ch);
			await sleep(45 + Math.random() * 55);
		}
	}

	/** Clicks the middle of a phrase, as a mouse would: press and release over its middle cell. */
	async function click(name, found) {
		const row = found.row, col = Math.floor((found.col + found.end) / 2);
		const [x, y] = cellPx(row, col);
		mark(name, { row, col, link: found.link });
		send(`\x1b[<0;${x};${y}M`);
		await sleep(70);
		send(`\x1b[<0;${x};${y}m`);
	}

	/** Presses `keys` and marks it as `name`, with the letters the press put on screen once it settles. */
	async function press(name, keys) {
		mark(name);
		send(keys);
		await settle(800, 10000);
		marks[name].letters = lettersOn(screen());
		console.log('letters', name, JSON.stringify(marks[name].letters));
		return marks[name].letters;
	}

	// As of Claude Code 2.1.302 each finished turn ends with a line such as `✻ Baked for 15s · done 12:09 AM`.
	const turnsDone = () => (text().match(/ · done /g) ?? []).length;

	/**
	 * Answers the question whether to trust the folder if it shows, and waits for an empty prompt.
	 * The launch take's script answered it; no recorded take shows it, so its wording is unchecked.
	 */
	async function ready() {
		// The folder-trust question also draws a `❯`; wait until either it or the composer is whole.
		await waitFor((t) => /Enter to confirm/.test(t) || /─\n❯/.test(t), 60000, 'the first screen');
		// The question takes keys only a moment after it draws, so answer until it is gone.
		for (let tries = 0; /Enter to confirm/.test(text()) && tries < 10; tries++) {
			await sleep(1000);
			send('\x1b[B');
			await sleep(300);
			send('\r');
			await sleep(1500);
		}
		await waitFor((t) => /─\n❯/.test(t) && !/Enter to confirm/.test(t), 60000, 'the prompt');
		await sleep(1500);
		mark('ready');
	}

	/** Types `question`, sends it and waits for the reply, marking `asked<suffix>` and `replied<suffix>`. */
	async function ask(question, suffix = '') {
		await type(question);
		await sleep(600);
		mark(`asked${suffix}`);
		const before = turnsDone();
		send('\r');
		await waitFor(() => turnsDone() > before, 240000, `the reply to "${question}"`);
		await sleep(800);
		mark(`replied${suffix}`);
	}

	async function finish() {
		isRecording = false;
		await recorder;
		writeFileSync(`${out}/frames.jsonl`, frames.map((f) => JSON.stringify(f)).join('\n'));
		writeFileSync(`${out}/marks.json`, JSON.stringify(marks, null, 2));
		for (const id of [pane, lower, base]) {
			try { wez('kill-pane', '--pane-id', id); } catch {}
		}
		console.log('frames', frames.length, 'seconds', frames.at(-1)?.t);
	}

	return {
		mark, type, click, press, settle, ready, ask, finish, text,
		links: (pattern) => linksOn(screen(), pattern), pressables: () => pressablesOn(screen()),
	};
}
