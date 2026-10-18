// The 0.5.0 film, scene by scene, timed from the take's marks: the style toolbar, its marks, a
// highlight, tinted, save and close, between title and end cards where Clawd hops, lands, and is
// stretched like the stretches it stands for. compose.mjs --release=0.5.0 loads it into release.html.
(() => {
	const COPY = {
		kicker: 'What’s new in',
		title: 'cc-stretch 0.5.0',
		features: 'Style your stretches, live.',
		toolbar: '/cc-stretch:style puts a toolbar above the prompt.',
		toolbarSmall: 'Every reply restyles as you click.',
		marks: 'Turn on the marks you like.',
		marksSmall: 'Bold, italic, underline, strikethrough or dim.',
		highlight: 'Or give them a highlight.',
		highlightSmall: 'Nine deep colours, with the text turned light to read on them.',
		tintedCard: 'Or tinted:',
		tintedCardSmall: 'each stretch in a colour of its own.',
		tinted: 'Tinted: each stretch in the colour it opens in.',
		tintedSmall: 'Open one, and its words take that colour.',
		save: 'Save keeps your style.',
		saveSmall: 'Close puts the toolbar away.',
		install: '/plugin install cc-stretch --marketplace pro-vi/cc-stretch',
		then: 'then /cc-stretch:style',
		repo: 'github.com/pro-vi/cc-stretch',
	};
	// The colours the tinted highlight is made from, at full strength: Claude Code 2.1.300's warning,
	// autoAccept, planMode and claude, as BASE in hooks/register.tsx holds them.
	const TINTS = ['#ffc107', '#af87ff', '#48968c', '#d77757'];
	const PX = 16;

	/** Clawd standing with its feet on `ground`, centred on `cx`, lifted, squashed or stretched. */
	const clawd = (cx, ground, { lift = 0, sx = 1, sy = 1, pose = 'idle', colour } = {}) =>
		clawdSvg({ pose, colour, px: PX, x: cx - 7 * PX, y: ground - 8 * PX - lift, sx, sy });
	const blink = (t) => (t % 2.7 > 2.55 ? 'blink' : 'idle');
	/** A card's frame, and one line of it placed `top` pixels down, centred across the frame. */
	const stage = (...parts) => `<div style="position:relative;width:${W}px;height:${H}px">${parts.join('')}</div>`;
	const line = (cls, top, html, style = '') => `<div class="${cls}" style="position:absolute;top:${top}px;left:0;width:100%;${style}">${html}</div>`;

	// The title: Clawd drops onto the stage and squashes, hops twice, is pulled wide like a stretch
	// opening, and is let go, ringing back to its shape as the title settles under it.
	const FALL = 0.55, HOPS = 0.9, HOP = 0.55;
	const TITLE_PULL = { from: 2.05, full: 2.75, go: 2.85, sx: 3.1, sy: 0.66, freq: 2.3, damping: 3.6 };
	function titleCard(t) {
		let body;
		if (t < FALL) body = { lift: 620 * (1 - (t / FALL) ** 2), sy: 1.25, sx: 0.85 };
		else if (t < HOPS) body = keepArea(spring(t - FALL, 0.62, 1, 3.2, 7));
		else if (t < TITLE_PULL.from) body = hop(t - HOPS, HOP, 90);
		else body = pulled(t, TITLE_PULL);
		const wide = clamp((body.sx - 1) / (TITLE_PULL.sx - 1));
		return stage(
			line('kicker', 310, COPY.kicker, `margin:0;opacity:${ease(span(t, 0.2, 0.7))}`),
			clawd(W / 2, 590, { ...body, pose: t > 3.6 ? blink(t) : 'idle' }),
			line('big', 655, COPY.title, `max-width:none;opacity:${ease(span(t, TITLE_PULL.from + 0.2, TITLE_PULL.go))};letter-spacing:${(-0.015 + 0.12 * wide).toFixed(3)}em`),
			line('small', 790, COPY.features, `margin:0;opacity:${ease(span(t, 3.4, 3.9))}`),
		);
	}

	// Four Clawds in the four colours tinted hands out, hopping one after another as places do.
	function tintedCard(t) {
		return stage(
			line('big', 210, COPY.tintedCard, 'max-width:none'),
			line('small', 330, COPY.tintedCardSmall, 'margin:0'),
			...TINTS.map((colour, i) => clawd(W / 2 + (i - 1.5) * 300, 600, { ...hop(t - 0.25 - i * 0.16, 0.62, 70), colour, pose: blink(t + i) })),
		);
	}

	// The header's own Clawd, in the first shot of the take: two hops, then pulled wide and let go, as
	// the title's Clawd was. In the terminal's pixels, before the camera scales it.
	const HEAD_HOP = { start: 0.2, period: 0.4 };
	const HEAD_PULL = { from: 1.0, full: 1.5, go: 1.55, sx: 2.3, sy: 0.7, freq: 2.6, damping: 4.5 };
	const headerClawd = (t) => (t < HEAD_PULL.from ? hop(t - HEAD_HOP.start, HEAD_HOP.period, 26, 0.35) : pulled(t, HEAD_PULL));

	// The end: Clawd hops on the install line, then stretches tall and is let go.
	const END_HOP = { start: 0.35, period: 0.56 };
	const TALL = { from: 2.6, full: 3.15, go: 3.25, sx: 0.72, sy: 1.9, freq: 2.5, damping: 4 };
	function endCard(t) {
		const body = t < TALL.from ? hop(t - END_HOP.start, END_HOP.period, 80) : pulled(t, TALL);
		return stage(
			clawd(W / 2, 360, { ...body, pose: t > TALL.go + 0.8 ? blink(t) : 'idle' }),
			line('big', 430, COPY.title, 'max-width:none'),
			line('', 585, `<div class="mono" style="margin:0">${COPY.install}</div>`, 'display:flex;justify-content:center'),
			line('small', 680, COPY.then, 'margin:0;font-family:var(--mono)'),
			line('small', 760, COPY.repo, 'margin:0'),
		);
	}

	window.CUT = {
		scenes(take) {
			const m = take.marks;
			// The camera frames the reply and the toolbar under it: centred a row below halfway between
			// the reply's opened stretch and the toolbar's marks row, so the toolbar clears the frame's foot.
			const FRAME = { focus: Math.round((m.open.row + m.bold.row) / 2) + 1, zoom: 1.55 };
			// A stretch of the take shown at `speed` times as fast as it was recorded.
			const shot = (from, to, [caption, small], rest = {}, speed = 1) => ({ kind: 'take', len: (to - from) / speed, from, to, caption, small, ...FRAME, ...rest });
			// A stretch of the take that ends as `mark`'s click lands.
			const pressing = (from, mark, words, speed = 1.2) => shot(from, mark.t, words, { click: { row: mark.row, col: mark.col } }, speed);
			const after = (mark) => changed(mark.t);
			// How long a result is held once a press has drawn it, and a stretch's growth once it opens.
			const HOLD = 1.4, GROW = 2.6;
			const TOOLBAR = [COPY.toolbar, COPY.toolbarSmall], MARKS = [COPY.marks, COPY.marksSmall], HIGHLIGHT = [COPY.highlight, COPY.highlightSmall];
			const TINTED = [COPY.tinted, COPY.tintedSmall], SAVE = [COPY.save, COPY.saveSmall];
			return [
				{ kind: 'card', len: 5, html: titleCard, thuds: [FALL, ...landings(HOPS, HOP, 2)], boings: [TITLE_PULL.go] },

				// The whole screen first, the header's Clawd hopping, then the camera pushes in as the command is typed.
				shot(m.replied.t - 0.2, m.replied.t + 1.6, TOOLBAR, { zoom: 1, logo: headerClawd, thuds: landings(HEAD_HOP.start, HEAD_HOP.period, 2), boings: [HEAD_PULL.go] }, 0.75),
				shot(m.replied.t + 1.6, m.shown.t + 1.0, TOOLBAR, {}, 1.15),

				pressing(m.shown.t + 1.0, m.bold, MARKS),
				pressing(after(m.bold), m.italic, MARKS),
				pressing(after(m.italic), m.underline, MARKS),
				shot(after(m.underline), after(m.underline) + HOLD, MARKS),

				pressing(after(m.underline) + HOLD, m.colour, HIGHLIGHT),
				pressing(after(m.colour), m.swatch, HIGHLIGHT),
				shot(after(m.swatch), after(m.swatch) + HOLD, HIGHLIGHT),

				{ kind: 'card', len: 2.5, html: tintedCard },

				pressing(after(m.swatch) + HOLD, m.tinted, TINTED),
				pressing(after(m.tinted), m.open, TINTED, 1),
				shot(after(m.open), after(m.open) + GROW, TINTED, { growth: true, zoom: 1.7 }),

				pressing(after(m.open) + GROW, m.save, SAVE, 1.3),
				pressing(after(m.save), m.close, SAVE, 1.3),
				shot(after(m.close), after(m.close) + 1.2, SAVE),

				{ kind: 'card', len: 6.5, html: endCard, thuds: landings(END_HOP.start, END_HOP.period, 4), boings: [TALL.go] },
			];
		},
	};
})();
