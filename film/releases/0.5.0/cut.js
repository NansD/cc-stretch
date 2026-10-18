// The 0.5.0 film, scene by scene, timed from the take's marks: the style toolbar, its marks, a
// highlight, tinted, save and close, between title and end cards where a click stretches Clawd.
// compose.mjs --release=0.5.0 loads it into release.html.
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
		thanks: 'Thanks to @gitsacha and @leftos for their pull requests.',
	};
	// The colours the tinted highlight is made from, at full strength: Claude Code 2.1.300's warning,
	// autoAccept, planMode and claude, as BASE in hooks/register.tsx holds them.
	const TINTS = ['#ffc107', '#af87ff', '#48968c', '#d77757'];
	// Clawd's size, a sprite pixel to PX screen pixels, and where the cards stand it across the frame.
	const PX = 16, CX = W / 2;

	/** Clawd standing with its feet on `ground`, centred on `cx`, lifted, squashed or stretched. */
	const clawd = (cx, ground, { lift = 0, sx = 1, sy = 1, pose = 'idle', colour } = {}) =>
		clawdSvg({ pose, colour, px: PX, x: cx - 7 * PX, y: ground - 8 * PX - lift, sx, sy });
	const blink = (t) => (t % 2.7 > 2.55 ? 'blink' : 'idle');
	/**
	 * A pull on Clawd that a click starts at `from`, stretching it to (sx, sy) in 0.35 s, as a click opens
	 * a stretch; a second click 1.2 s after the first lets it go.
	 */
	const clickPull = (from, sx, sy) => ({ from, full: from + 0.35, go: from + 1.2, sx, sy });
	/** A card's two clicks on a Clawd standing at (CX, `ground`), and the boing as the second lets it go. */
	const cues = (ground, pull) => ({ clicks: [pull.from, pull.go].map((at) => ({ at, x: CX, y: ground - 4 * PX })), boings: [pull.go] });
	/** A card's frame, and one line of it placed `top` pixels down, centred across the frame. */
	const stage = (...parts) => `<div style="position:relative;width:${W}px;height:${H}px">${parts.join('')}</div>`;
	const line = (cls, top, html, style = '') => `<div class="${cls}" style="position:absolute;top:${top}px;left:0;width:100%;${style}">${html}</div>`;

	// The title: Clawd drops onto the stage and squashes as it lands. A click stretches it wide and the
	// title opens out under it; a second click lets it go.
	const FALL = 0.55, TITLE_GROUND = 590;
	const TITLE_PULL = clickPull(1.7, 1.7, 0.82);
	function titleCard(t) {
		let body;
		if (t < FALL) body = { lift: 620 * (1 - (t / FALL) ** 2), sy: 1.25, sx: 0.85 };
		else if (t < TITLE_PULL.from) body = keepArea(spring(t - FALL, 0.62, 1, 3.2, 7));
		else body = pulled(t, TITLE_PULL);
		const wide = clamp((body.sx - 1) / (TITLE_PULL.sx - 1));
		return stage(
			line('kicker', 310, COPY.kicker, `margin:0;opacity:${ease(span(t, 0.2, 0.7))}`),
			clawd(CX, TITLE_GROUND, body),
			line('big', 655, COPY.title, `max-width:none;opacity:${ease(span(t, TITLE_PULL.from, TITLE_PULL.full + 0.3))};letter-spacing:${(-0.015 + 0.08 * wide).toFixed(3)}em`),
			line('small', 790, COPY.features, `margin:0;opacity:${ease(span(t, TITLE_PULL.go + 0.5, TITLE_PULL.go + 1))}`),
		);
	}

	// Four Clawds in the four colours tinted hands out, hopping one after another as places do.
	function tintedCard(t) {
		return stage(
			line('big', 210, COPY.tintedCard, 'max-width:none'),
			line('small', 330, COPY.tintedCardSmall, 'margin:0'),
			...TINTS.map((colour, i) => clawd(CX + (i - 1.5) * 300, 600, { ...hop(t - 0.25 - i * 0.16, 0.62, 70), colour, pose: blink(t + i) })),
		);
	}

	// The end: a click stretches Clawd wide above the install line, sideways as a stretch grows along its
	// line, and a second lets it go; it blinks once it has rung back to its shape. The last line thanks
	// the authors of the pull requests this release merged.
	const END_GROUND = 360;
	const END_PULL = clickPull(1.5, 1.5, 0.88);
	function endCard(t) {
		return stage(
			clawd(CX, END_GROUND, { ...pulled(t, END_PULL), pose: t > END_PULL.go + 0.8 ? blink(t) : 'idle' }),
			line('big', 430, COPY.title, 'max-width:none'),
			line('', 585, `<div class="mono" style="margin:0">${COPY.install}</div>`, 'display:flex;justify-content:center'),
			line('small', 680, COPY.then, 'margin:0;font-family:var(--mono)'),
			line('small', 760, COPY.repo, 'margin:0'),
			line('small', 860, COPY.thanks, 'margin:0'),
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
				{ kind: 'card', len: 5, html: titleCard, thuds: [FALL], ...cues(TITLE_GROUND, TITLE_PULL) },

				// The whole screen first, then the camera pushes in as the command is typed.
				shot(m.replied.t - 0.2, m.replied.t + 1.0, TOOLBAR, { zoom: 1 }),
				shot(m.replied.t + 1.0, m.shown.t + 1.0, TOOLBAR, {}, 1.15),

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

				{ kind: 'card', len: 5.5, html: endCard, ...cues(END_GROUND, END_PULL) },
			];
		},
	};
})();
