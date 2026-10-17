// The film's soundtrack, synthesized offline in the compositor page so every sound lands on its
// frame: a soft FM electric piano over one continuous pad per section, a music-box note for each
// word that pops into Nelson's sentence, quiet keys and clicks at the take's own typing and
// clicks, and a chiptune turn for the parody.
// window.renderMusic({ total, clicks, typing, tTerm, tEnd, tTitle, pops, sections }) resolves a 16-bit
// stereo WAV as base64, played on the instruments in instruments.js.
window.renderMusic = ({ total, clicks, typing, tTerm, tEnd, tTitle, pops, sections }) => window.playFilm(total, ({ ctx, master, BEAT, ep, bell, pad, tick, square, CHORDS, TONIC, walk, clickTicks, held, bellPair, chirp }) => {
	const { turn, nelson, quote, never } = sections;
	const parodyAt = tTitle + 5 + 1.55;

	// 0-5 s, the opening: a pad and a light, slightly too busy piano, like the reply on screen.
	pad(0, turn + 0.2, CHORDS.slice(0, 2), 0.022);
	for (let i = 0; i < 16; i++) ep(0.2 + i * BEAT / 2, CHORDS[Math.floor(i / 8)][(i * 3) % 5] + 12, 0.05 + 0.002 * i, 0.9);
	// The archive: almost nothing.
	pad(turn, nelson + 0.4, [[50, 57, 62]], 0.03);
	ep(turn + 0.2, 74, 0.07, 2.5);
	// 1967: a held drone, and a music-box note for every word that pops into a gap.
	pad(nelson, never + 0.4, [[38, 50, 57]], 0.025);
	const BOX = [74, 76, 78, 81, 83, 86, 88, 90];
	(pops ?? []).forEach((t, i) => bell(t, BOX[i % BOX.length], 0.05));
	for (let t = quote + 0.1, i = 0; t < quote + 1.7; t += 0.18, i++) bell(t, BOX[BOX.length - 1 - (i % BOX.length)], 0.03);
	// It never caught on; then Clawd arrives with a two-note chirp.
	pad(never, tTerm + 0.4, [CHORDS[2]], 0.03);
	chirp(never + 1.4);
	// The take: the electric piano walks the progression, one gentle chord per bar.
	walk(tTerm, tEnd);
	for (const [a, b] of typing) for (let t = a; t < b; t += 0.09 + Math.random() * 0.04) tick(t, 1600 + Math.random() * 300, 0.18);
	clickTicks(clicks);
	// The number: the progression holds on its fourth chord.
	pad(tEnd, tTitle + 0.4, [CHORDS[3]], 0.03);
	bellPair(tEnd);
	// The launch card: the tonic, held, and one bell.
	pad(tTitle, parodyAt, [TONIC], 0.035);
	held(tTitle + 0.15, 4);
	bell(tTitle + 0.4, 86, 0.05);
	// The parody: the tape stops, then an eight-bit victory lap.
	const stop = ctx.createOscillator(), stopGain = ctx.createGain();
	stop.type = 'triangle'; stop.frequency.setValueAtTime(220, parodyAt - 0.2); stop.frequency.exponentialRampToValueAtTime(40, parodyAt + 0.15);
	stopGain.gain.setValueAtTime(0.12, parodyAt - 0.2); stopGain.gain.linearRampToValueAtTime(0, parodyAt + 0.15);
	stop.connect(stopGain).connect(master); stop.start(parodyAt - 0.2); stop.stop(parodyAt + 0.2);
	const LEAD = [72, 76, 79, 84, 79, 76, 79, 84, 86, 84, 79, 76, 74, 76, 79, 72];
	const BASS = [48, 48, 55, 55, 53, 53, 55, 55];
	for (let i = 0; parodyAt + 0.25 + i * 0.15 < total - 0.6; i++) {
		const at = parodyAt + 0.25 + i * 0.15;
		square(at, LEAD[i % LEAD.length], 0.14);
		if (i % 2 === 0) square(at, BASS[(i / 2) % BASS.length] - 12, 0.28, 0.05, 'triangle');
	}
});
