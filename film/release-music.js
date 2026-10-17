// A release film's soundtrack, played on the instruments in instruments.js: the tonic held under the
// title, the electric piano walking the progression from the first take to the end card with a bell
// pair on any card between, a soft tick at every click, a brown switch at every key the take pressed
// (a chord's keys a moment apart, and a bell as a typed letter opens or closes its stretch), and on
// the end card the tonic again with Clawd's two-note chirp.
// window.renderMusic({ total, cards, takes, clicks, keys }) resolves a 16-bit stereo WAV as base64.
window.renderMusic = ({ total, cards, takes, clicks, keys }) => window.playFilm(total, ({ bell, pad, brownSwitch, TONIC, walk, clickTicks, held, bellPair, chirp }) => {
	const title = cards[0], end = cards.at(-1);
	pad(title[0], title[1] + 0.4, [TONIC], 0.032);
	held(title[0] + 0.2, 3.5);
	bell(title[0] + 0.6, 86, 0.05);

	walk(takes[0][0], end[0]);
	for (const [a] of cards.slice(1, -1)) bellPair(a);
	clickTicks(clicks);
	for (const { at, count } of keys) {
		for (let i = 0; i < count; i++) brownSwitch(at + i * 0.035, i === 0 ? 0.5 : 0.38);
		if (count === 1) bell(at + 0.06, 88, 0.035);
	}

	pad(end[0], total, [TONIC], 0.035);
	held(end[0] + 0.15, 4);
	bell(end[0] + 0.4, 86, 0.05);
	chirp(end[0] + 1.2);
});
