// Renders a check's recording into check.mp4 beside it: each recorded screen drawn cell by cell as the
// terminal drew it, held until the next one (long waits shortened), under a caption naming the step
// under way and whether its check passed. Rows that report the account's usage are blanked.
//   node film/e2e/render.mjs <outDir>
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { LEAK, parseScreen, PRIVATE } from '../screen.mjs';

const [DIR] = process.argv.slice(2);
const frames = readFileSync(`${DIR}/frames.jsonl`, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const report = JSON.parse(readFileSync(`${DIR}/report.json`, 'utf8'));
const { cols, rows } = report.size;
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// A row holding a user-variable sequence that landed in the cells as text is blanked too: what the
// variable carries is not known.
const isPrivate = (row) => PRIVATE.test(row) || LEAK.test(row);

function rowsHtml(screen) {
	return parseScreen(screen).map((runs, r) => {
		if (isPrivate(runs.map((x) => x.text).join(''))) return '';
		const spans = runs.map((run) => {
			let fg = run.fg ?? '#e8e5de', bg = run.bg;
			if (run.inverse) [fg, bg] = [bg ?? '#191816', run.fg ?? '#e8e5de'];
			const css = [`left:${run.col * 0.6}em`, `color:${fg}`];
			if (bg) css.push(`background:${bg}`);
			if (run.bold) css.push('font-weight:700');
			if (run.dim) css.push('opacity:.55');
			if (run.italic) css.push('font-style:italic');
			if (run.underline) css.push('text-decoration:underline', 'text-underline-offset:.18em');
			return `<span style="${css.join(';')}">${esc(run.text)}</span>`;
		}).join('');
		return `<div class="row" style="top:${r * 1.4}em">${spans}</div>`;
	}).join('');
}
/** The step a moment belongs to: the last one started at or before it. */
const stepAt = (t) => [...report.steps].reverse().find((s) => s.t <= t + 0.05);

const page = (screen, s, t) => `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&family=Inter:wght@500;600&display=block">
<style>
html,body{margin:0;background:#121110;width:1280px;height:960px;overflow:hidden}
.cap{height:104px;box-sizing:border-box;padding:22px 34px;font:600 26px/1.3 Inter,sans-serif;color:#e8e5de;display:flex;gap:18px;align-items:center}
.cap .n{font:600 18px/1 Inter;color:#8d877d;min-width:64px}
.cap .v{font:600 16px/1 Inter;padding:6px 10px;border-radius:6px}
.pass{background:#1e4d2b;color:#cfe8d5}.wait{background:#2a2724;color:#8d877d}.fail{background:#5f2a2a;color:#f2d0d0}
.term{position:relative;margin:0 34px;background:#191816;border-radius:10px;height:${rows * 1.4}em;font:400 20px/1 'JetBrains Mono',monospace;padding:12px 0;width:${cols * 0.6}em;box-sizing:content-box}
.row{position:absolute;left:14px;right:0;height:1.4em;margin-top:12px;white-space:pre}
.row span{position:absolute;top:.15em}
</style></head><body>
<div class="cap">${s ? `<span class="n">${String(report.steps.indexOf(s) + 1).padStart(2, '0')}/${report.steps.length}</span><span>${esc(s.caption)}</span>${t >= s.settled ? `<span class="v ${s.pass ? 'pass' : 'fail'}">${s.pass ? 'PASS' : 'FAIL'}</span>` : '<span class="v wait">checking</span>'}` : `<span class="n">00</span><span>Claude Code ${esc(report.claude)} starts with the package loaded</span>`}</div>
<div class="term">${rowsHtml(screen)}</div></body></html>`;

const work = `${DIR}/render`;
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
const browser = await chromium.launch();
const tab = await browser.newPage({ viewport: { width: 1280, height: 960 } });
const list = [];
for (let i = 0; i < frames.length; i++) {
	const f = frames[i];
	const next = frames[i + 1]?.t ?? f.t + 3;
	// Waits for the model or a reload are shortened; a redraw keeps its own pace.
	// While the model writes the first reply only its spinner moves, so those screens pass quickly.
	const isWaiting = stepAt(f.t)?.name === 'reply' && !/ · done /.test(f.screen);
	const hold = Math.min(Math.max(next - f.t, 1 / 30), isWaiting ? 0.25 : 2.2);
	await tab.setContent(page(f.screen, stepAt(f.t), f.t), { waitUntil: 'load' });
	if (i === 0) await tab.evaluate(() => document.fonts.ready);
	const file = `${work}/${String(i).padStart(5, '0')}.png`;
	await tab.screenshot({ path: file });
	list.push(`file '${file}'\nduration ${hold.toFixed(3)}`);
}
list.push(`file '${work}/${String(frames.length - 1).padStart(5, '0')}.png'`);
await browser.close();
writeFileSync(`${work}/list.txt`, `${list.join('\n')}\n`);
const out = `${DIR}/check.mp4`;
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', `${work}/list.txt`, '-vf', 'fps=30,format=yuv420p', '-c:v', 'libx264', '-crf', '20', out]);
console.log('wrote', out, 'from', frames.length, 'screens');
