// What every film page shares: the frame's geometry and easing, the recorded take's frames, the
// terminal drawn cell by cell from them, the camera on it, Clawd, and the cards. A film page loads
// this before its own script; compose.mjs injects window.TAKE before the first frame.
const W = 1920, H = 1080, COLS = 100, ROWS = 30, CELL_W = 14.4, CELL_H = 33;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const ease = (k) => (k < .5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);
const lerp = (a, b, k) => a + (b - a) * k;
const span = (t, a, b) => clamp((t - a) / (b - a));
const $ = (id) => document.getElementById(id);

function frameAt(takeT) {
	const f = window.TAKE.frames;
	let lo = 0, hi = f.length - 1;
	while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (f[mid].t <= takeT) lo = mid; else hi = mid - 1; }
	return f[lo];
}

/**
 * A recorded growth shows each distinct screen it captured for the same share of the first
 * GROWTH seconds, whatever the gaps between captures were, then plays the rest of the take.
 */
const GROWTH = 1.1;
function evenFrame(seg, local) {
	seg.steps ??= window.TAKE.frames.filter((f) => f.t >= seg.from && f.t <= seg.from + 1.8);
	if (seg.steps.length === 0 || local >= GROWTH) return frameAt(Math.max(seg.from + 1.8, lerp(seg.from, seg.to, local / (seg.b - seg.a))));
	return seg.steps[Math.min(seg.steps.length - 1, Math.floor((local / GROWTH) * seg.steps.length))];
}

// --- drawing helpers -------------------------------------------------------------------------
// The block elements as rectangles of a cell: [x, y, width, height] in fractions of the cell.
const UL = [0, 0, .5, .5], UR = [.5, 0, .5, .5], LL = [0, .5, .5, .5], LR = [.5, .5, .5, .5];
const QUADS = {
	'█': [[0, 0, 1, 1]], '▀': [[0, 0, 1, .5]], '▄': [[0, .5, 1, .5]], '▌': [[0, 0, .5, 1]], '▐': [[.5, 0, .5, 1]],
	'▘': [UL], '▝': [UR], '▖': [LL], '▗': [LR], '▚': [UL, LR], '▞': [UR, LL],
	'▛': [UL, UR, LL], '▜': [UL, UR, LR], '▙': [UL, LL, LR], '▟': [UR, LL, LR],
};
let shownFrame = null;
function drawRows(frame) {
	if (frame === shownFrame) return;
	shownFrame = frame;
	const host = $('rows');
	host.innerHTML = '';
	frame.rows.forEach((runs, r) => {
		const row = document.createElement('div');
		row.className = 'row';
		row.style.top = `${r * CELL_H}px`;
		for (const run of runs) {
			// Block characters are cell shapes, as a terminal draws them, not glyphs a font leaves gaps around.
			if ([...run.text].some((ch) => QUADS[ch] !== undefined)) {
				let col = run.col;
				for (const ch of run.text) {
					const quads = QUADS[ch];
					if (quads !== undefined) {
						for (const [qx, qy, qw, qh] of quads) {
							const b = document.createElement('i');
							b.style.cssText = `position:absolute;left:${(col + qx) * CELL_W}px;top:${qy * CELL_H}px;width:${qw * CELL_W + 1.2}px;height:${qh * CELL_H + 1.2}px;background:${run.fg ?? 'var(--term-fg)'}`;
							row.appendChild(b);
						}
					} else if (ch !== ' ') {
						const g = document.createElement('span');
						g.textContent = ch;
						g.style.left = `${col * CELL_W}px`;
						g.style.color = run.fg ?? 'var(--term-fg)';
						row.appendChild(g);
					}
					col += 1;
				}
				continue;
			}
			const s = document.createElement('span');
			s.textContent = run.text;
			s.style.left = `${run.col * CELL_W}px`;
			let fg = run.fg ?? 'var(--term-fg)', bg = run.bg;
			if (run.inverse) [fg, bg] = [bg ?? 'var(--term)', run.fg ?? 'var(--term-fg)'];
			s.style.color = fg;
			if (bg) s.style.background = bg;
			if (run.bold) s.style.fontWeight = '700';
			if (run.dim) s.style.opacity = '.55';
			if (run.italic) s.style.fontStyle = 'italic';
			if (run.underline) s.style.textDecoration = 'underline';
			row.appendChild(s);
		}
		host.appendChild(row);
	});
}
const TERM_W = COLS * CELL_W + 36, TERM_H = ROWS * CELL_H + 46 + 32;
function placeTerm(zoom, focusRow, lift = 0) {
	const fit = Math.min((W - 160) / TERM_W, (H - 230) / TERM_H);
	const s = fit * zoom;
	const cx = W / 2, cy = 190 + (H - 190) / 2 + lift;
	const fy = 46 + 14 + focusRow * CELL_H;
	const x = cx - (TERM_W / 2) * s;
	const y = zoom > 1 ? cy - fy * s : cy - (TERM_H / 2) * s;
	$('term-wrap').style.transform = `translate(${x}px, ${y}px) scale(${s})`;
	return { x, y, s };
}
function cellToScreen(cam, row, col) {
	return { x: cam.x + (18 + (col + 0.5) * CELL_W) * cam.s, y: cam.y + (46 + 14 + (row + 0.6) * CELL_H) * cam.s };
}

const SPRITE = {
	idle: ['..XXXXXXXXXX..', '..XXKXXXXKXX..', '..XXKXXXXKXX..', 'XXXXXXXXXXXXXX', '..XXXXXXXXXX..', '..XXXXXXXXXX..', '..X.X....X.X..', '..X.X....X.X..'],
	walk: ['..XXXXXXXXXX..', '..XXKXXXXKXX..', '..XXKXXXXKXX..', 'XXXXXXXXXXXXXX', '..XXXXXXXXXX..', '..XXXXXXXXXX..', '...X.X..X.X...', '...X.X..X.X...'],
	blink: ['..XXXXXXXXXX..', '..XXXXXXXXXX..', '..XXKXXXXKXX..', 'XXXXXXXXXXXXXX', '..XXXXXXXXXX..', '..XXXXXXXXXX..', '..X.X....X.X..', '..X.X....X.X..'],
	wave: ['..XXXXXXXXXX.X', '..XXKXXXXKXX.X', '..XXKXXXXKXXXX', 'XXXXXXXXXXXX..', '..XXXXXXXXXX..', '..XXXXXXXXXX..', '..X.X....X.X..', '..X.X....X.X..'],
	sweat: ['..XXXXXXXXXX.B', '..XXKXXXXKXX..', '..XXKXXXXKXX..', 'XXXXXXXXXXXXXX', '..XXXXXXXXXX..', '..XXXXXXXXXX..', '..X.X....X.X..', '..X.X....X.X..'],
};
function drawClawd(c) {
	const el = $('clawd');
	if (!c) { el.style.opacity = 0; return; }
	const ctx = el.getContext('2d');
	ctx.clearRect(0, 0, 14, 8);
	SPRITE[c.pose].forEach((line, y) => [...line].forEach((p, x) => {
		if (p === '.') return;
		ctx.fillStyle = p === 'K' ? '#1f1e1b' : p === 'B' ? '#6cb4ee' : '#d97757';
		ctx.fillRect(x, y, 1, 1);
	}));
	el.style.opacity = c.alpha ?? 1;
	el.style.width = `${14 * c.px}px`;
	el.style.height = `${8 * c.px}px`;
	el.style.transform = `translate(${c.x}px, ${c.y}px) scaleX(${c.flip ? -1 : 1}) rotate(${c.rot ?? 0}deg)`;
}
function bubble(text, x, y, alpha) {
	const b = $('bubble');
	b.textContent = text;
	b.style.opacity = alpha;
	b.style.transform = `translate(${x}px, ${y}px)`;
}
function show(id, alpha) { $(id).style.opacity = alpha; }
function card(html, cls = '') {
	const c = $('card');
	if (c.dataset.html !== html) { c.dataset.html = html; c.innerHTML = html; }
	c.className = `layer ${cls}`;
}

const loads = [];
function setImage(target, src) {
	const img = typeof target === 'string' ? $(target) : target;
	if (img.getAttribute('src') === src) return;
	img.setAttribute('src', src);
	loads.push(img.decode().catch(() => {}));
}

/** When a press shows in the take: the first frame after take second `t`, less 0.15 s. */
const changed = (t) => (window.TAKE.frames.find((f) => f.t > t)?.t ?? t) - 0.15;

/** The pointer travels to each click, given in the frame's pixels, and a ring spreads where it lands. */
function pointTo(clicks, t) {
	const next = clicks.find((c) => t <= c.at + 0.35);
	const prev = [...clicks].reverse().find((c) => t > c.at + 0.35);
	if (!next || t <= next.at - 1.3) {
		$('pointer').style.opacity = 0;
		$('ring').style.opacity = 0;
		return;
	}
	const from = prev ?? { x: W - 260, y: H - 120 };
	const k = ease(span(t, next.at - 1.1, next.at - 0.1));
	$('pointer').style.opacity = 1;
	$('pointer').style.transform = `translate(${lerp(from.x, next.x, k) - 6}px, ${lerp(from.y, next.y, k) - 4}px)`;
	const r = span(t, next.at, next.at + 0.35);
	$('ring').style.opacity = r > 0 && r < 1 ? 1 - r : 0;
	$('ring').style.transform = `translate(${next.x}px, ${next.y}px) scale(${0.4 + r})`;
}

/** Resolves once the frame's images have decoded, its fonts loaded, and the page painted it twice. */
async function endFrame() {
	await Promise.all(loads);
	await document.fonts.ready;
	await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
}
