// The 0.4.0 film, scene by scene, timed from the take's marks: colours, lists, then letters for the
// keyboard. compose.mjs --release=0.4.0 loads it into release.html.
(() => {
	const COPY = {
		kicker: 'What’s new in',
		title: 'cc-stretch 0.4.0',
		features: 'Colours, lists that stay lists, and stretches from the keyboard.',
		colours: 'Every stretch you open gets a colour.',
		another: 'Open another, and it gets the next one.',
		anotherSmall: 'The one you opened before fades.',
		lists: 'Lists stay lists.',
		listsSmall: 'Every item stays in view as a short line. Open only the one you want.',
		beforeBadge: 'Before · 0.3.7',
		afterBadge: 'Now · 0.4.0',
		before: 'One line could hold the whole list',
		after: 'Each item is a short stretch of its own',
		listed: 'Every item stays in view.',
		listedSmall: 'Each one opens on its own.',
		letters: 'No mouse? Option+↓ puts a letter on every stretch.',
		open: 'Type a letter, and that stretch opens in place.',
		close: 'Option+↑ puts letters on each «, to close.',
		install: '/plugin install cc-stretch --marketplace pro-vi/cc-stretch',
		repo: 'github.com/pro-vi/cc-stretch',
	};

	// Two small replies drawn as bars, each clicked once. On the left one short line opens into the
	// whole list; on the right the list is already there as short items, and one opens. A grey bar is
	// text, a light bar over a line is a closed stretch's short form, a yellow bar is words a click
	// added (the colour the first stretch opened takes), and « ends an open stretch.
	const PW = 700, PAD = 44, PITCH = 38, TW = PW - 2 * PAD, INDENT = 30;
	const LEFT = { x: 210, y: 352 }, RIGHT = { x: 1010, y: 352 };
	const INK = '#6b675f', LABEL = '#a39e93', LINK = '#d9d3c7', ADDED = '#e6c66f';
	const bar = (x, y, w, colour, extra = '') => `<i style="position:absolute;left:${x}px;top:${y}px;width:${Math.max(0, w)}px;height:14px;border-radius:7px;background:${colour};${extra}"></i>`;
	const link = (x, y, w) => bar(x, y, w, LINK) + bar(x, y + 20, w, '#f4f1ea', 'height:3px;border-radius:2px;opacity:.85');
	const dot = (x, y) => `<i style="position:absolute;left:${x}px;top:${y + 3}px;width:8px;height:8px;border-radius:4px;background:#8a857b"></i>`;
	const closer = (x, y) => `<b style="position:absolute;left:${x}px;top:${y - 9}px;font:700 26px/1 var(--mono);color:${ADDED}">«</b>`;
	const panel = (at, height, inner, opacity) => `<div style="position:absolute;left:${at.x}px;top:${at.y}px;width:${PW}px;height:${height}px;opacity:${opacity};background:var(--term);border-radius:22px;box-shadow:0 30px 80px rgba(30,20,10,.22);overflow:hidden">${inner}</div>`;
	const row = (i) => PAD + i * PITCH;

	// Before: the list as one stretch's long form, four items of two or three long lines each, as the
	// lines it pours out.
	const POURED = [[0.96, 0.9, 0.42], [0.93, 0.58], [0.9, 0.95, 0.5], [0.88, 0.46]].flatMap((item) => item.map((w, i) => ({ w, isFirst: i === 0 })));
	function before(k, opacity) {
		let inner = bar(PAD, row(0), TW * 0.84, INK) + bar(PAD, row(1), TW * 0.6, INK);
		inner += k > 0 ? bar(PAD, row(2), TW * 0.34, INK) : link(PAD, row(2), TW * 0.34);
		POURED.forEach((line, i) => {
			const grown = clamp(k * POURED.length - i);
			if (grown <= 0) return;
			const y = row(3) + i * PITCH;
			if (line.isFirst) inner += dot(PAD + 4, y);
			inner += bar(PAD + INDENT, y, (TW - INDENT) * line.w * grown, ADDED);
		});
		if (k >= 1) inner += closer(PAD + INDENT + (TW - INDENT) * POURED.at(-1).w + 12, row(3) + (POURED.length - 1) * PITCH);
		return panel(LEFT, lerp(row(3) + PAD - 24, row(3 + POURED.length) + PAD - 24, k), inner, opacity);
	}
	// Now: four short items, each a bold label and its stretch; the second opens into two lines.
	const ITEMS = [[0.17, 0.42], [0.27, 0.36], [0.31, 0.4], [0.24, 0.47]];
	const OPENED = [0.97, 0.52];
	function after(k, opacity) {
		let inner = bar(PAD, row(0), TW * 0.8, INK) + bar(PAD, row(1), TW * 0.52, INK) + bar(PAD, row(2), TW * 0.64, INK);
		ITEMS.forEach(([label, short], i) => {
			const y = row(3 + i) + (i > 1 ? k * OPENED.length * PITCH : 0);
			const x = PAD + INDENT + TW * label + 12;
			inner += dot(PAD + 4, y) + bar(PAD + INDENT, y, TW * label, LABEL);
			if (i !== 1 || k === 0) { inner += link(x, y, TW * short); return; }
			inner += bar(x, y, TW * short, INK);
			OPENED.forEach((w, j) => { inner += bar(PAD + INDENT, y + (j + 1) * PITCH, (TW - INDENT) * w * clamp(k * OPENED.length - j), ADDED); });
			if (k >= 1) inner += closer(PAD + INDENT + (TW - INDENT) * OPENED.at(-1) + 12, y + OPENED.length * PITCH);
		});
		return panel(RIGHT, row(3 + ITEMS.length) + PAD - 24 + k * OPENED.length * PITCH, inner, opacity);
	}
	// Where each click lands, in seconds into the card and pixels of the frame: the left panel's one
	// stretch, then the right's second item. Each side's growth and spotlight follow its click.
	const CLICKS = [
		{ at: 1.6, x: LEFT.x + PAD + TW * 0.17, y: LEFT.y + row(2) + 8 },
		{ at: 4.2, x: RIGHT.x + PAD + INDENT + TW * (ITEMS[1][0] + ITEMS[1][1] / 2) + 12, y: RIGHT.y + row(4) + 8 },
	];
	function listCard(t) {
		const label = (at, text, colour, opacity) => `<div style="position:absolute;left:${at.x}px;top:${at.y + 612}px;width:${PW}px;text-align:center;opacity:${opacity};font:500 32px/1.3 var(--sans);color:${colour}">${text}</div>`;
		const badge = (at, text, style, opacity) => `<div style="position:absolute;left:${at.x}px;top:${at.y - 74}px;width:${PW}px;text-align:center;opacity:${opacity}"><span style="display:inline-block;padding:12px 26px;border-radius:999px;font:600 26px/1 var(--sans);letter-spacing:.14em;text-transform:uppercase;${style}">${text}</span></div>`;
		// Each side is lit while its click plays and the other dims; both are lit at the end.
		const [left, right] = CLICKS.map((c) => c.at);
		const dim = (a, b) => 1 - 0.6 * (ease(span(t, a, a + 0.4)) - ease(span(t, b, b + 0.4)));
		const leftLit = dim(right - 0.9, right + 1.1), rightLit = dim(left - 0.7, left + 1.5);
		return `<div style="position:relative;width:1920px;height:1080px">`
			+ `<div class="big" style="position:absolute;top:104px;left:0;width:100%;max-width:none;font-size:84px">${COPY.lists}</div>`
			+ `<div class="small" style="position:absolute;top:196px;left:0;width:100%;margin:0;opacity:${ease(span(t, 0.4, 0.8))}">${COPY.listsSmall}</div>`
			+ badge(LEFT, COPY.beforeBadge, 'background:#e4dfd4;color:#6f6a61', leftLit) + badge(RIGHT, COPY.afterBadge, 'background:var(--orange);color:#fff', rightLit)
			+ before(ease(span(t, left + 0.05, left + 1.4)), leftLit) + after(ease(span(t, right + 0.05, right + 0.8)), rightLit)
			+ label(LEFT, COPY.before, 'var(--muted)', leftLit) + label(RIGHT, COPY.after, 'var(--ink)', rightLit) + `</div>`;
	}

	window.CUT = {
		scenes(take) {
			const m = take.marks;
			// Each growth starts at the first frame that changed after its press (changed, in kit.js).
			const at = (mark) => ({ row: mark.row, col: mark.col });
			// The camera centres the reply opened by clicks, then the list around the typed letter, then the
			// opened item's « once the screen has scrolled to show it.
			const reply = m.open1.row + 5, list = m.typed.row, opened = m.typed2.row - 2;
			const shot = (len, from, to, caption, rest = {}) => ({ kind: 'take', len, from, to, caption, focus: reply, zoom: 1.3, ...rest });
			return [
				{ kind: 'card', len: 4, html: (t) => `<div class="kicker">${COPY.kicker}</div><div class="big">${COPY.title}</div><div class="small" style="opacity:${ease(span(t, 0.9, 1.4))}">${COPY.features}</div>` },

				shot(2.2, m.replied.t - 0.2, m.open1.t, COPY.colours, { click: at(m.open1) }),
				shot(2.6, changed(m.open1.t), changed(m.open1.t) + 2.6, COPY.colours, { growth: true, zoom: 1.4 }),
				shot(1.1, changed(m.open1.t) + 2.6, m.open2.t, COPY.another, { small: COPY.anotherSmall, zoom: 1.4, click: at(m.open2) }),
				shot(3.0, changed(m.open2.t), changed(m.open2.t) + 3.0, COPY.another, { small: COPY.anotherSmall, growth: true, zoom: 1.4 }),

				{ kind: 'card', len: 7, html: listCard, clicks: CLICKS },
				shot(4.0, m.replied2.t - 0.3, m.letters.t - 0.9, COPY.listed, { small: COPY.listedSmall, focus: list }),

				shot(0.9, m.letters.t - 0.9, m.letters.t, COPY.letters, { focus: list, keys: ['⌥', '↓'] }),
				shot(2.4, changed(m.letters.t), m.typed.t, COPY.letters, { focus: list, zoom: 1.35, keys: [m.typed.letter.toUpperCase()] }),
				shot(3.0, changed(m.typed.t), changed(m.typed.t) + 3.0, COPY.open, { growth: true, focus: opened, zoom: 1.4 }),
				shot(0.9, changed(m.typed.t) + 3.0, m.letters2.t, COPY.close, { focus: opened, zoom: 1.4, keys: ['⌥', '↑'] }),
				shot(1.8, changed(m.letters2.t), m.typed2.t, COPY.close, { focus: opened, zoom: 1.4, keys: [m.typed2.letter.toUpperCase()] }),
				shot(2.2, changed(m.typed2.t), changed(m.typed2.t) + 2.2, COPY.close, { growth: true, focus: opened, zoom: 1.4 }),

				{ kind: 'card', len: 6.5, clawd: true, html: `<div class="big" style="margin-top:120px">${COPY.title}</div><div class="mono">${COPY.install}</div><div class="small">${COPY.repo}</div>` },
			];
		},
	};
})();
