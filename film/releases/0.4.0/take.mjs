// Records the take of the 0.4.0 film: opens two stretches of one reply, so the first fades as the
// second takes its colour, then asks for a list and opens and closes stretches of it from the
// keyboard. Writes out/releases/0.4.0/take.
//   node film/releases/0.4.0/take.mjs
import { ALT_DOWN, ALT_UP, REPO, sleep, startTake } from '../../recorder.mjs';

const OUT = `${REPO}/film/out/releases/0.4.0`;
// The demo session reads the person's own instructions too; these keep the take to the feature.
const APPEND = 'This session is a recorded product demo for a general audience. Write in English only, answer from the question alone without using any tools, and do not end replies with a status block or any closing summary. Use a few stretches.';
const COLOURS = "What does Effect give a TypeScript codebase that async/await doesn't?";
const LIST = 'Which four core pieces of Effect should I learn first?';
// The order the plugin hands out letters in: the newest reply's stretches first, in reading order.
const LETTERS = 'asdfghjklqwertyuiopzxcvbnm';

const take = await startTake({ out: `${OUT}/take`, append: APPEND });
const isClosed = (p) => p.text.trim() !== '«';
try {
	await take.ready();
	await take.ask(COLOURS);
	await sleep(1500);
	// Two stretches of the reply, opened one after the other, so the first takes its faded colour:
	// the first on screen, then the first closed one after its «.
	const first = take.pressables().find(isClosed);
	if (first === undefined) throw new Error(`the reply has no stretch:\n${take.text()}`);
	await take.click('open1', first);
	await take.settle(1500, 15000);
	await sleep(1500);
	const closer = take.pressables().find((p) => !isClosed(p));
	const second = closer && take.pressables().find((p) => isClosed(p) && (p.row > closer.row || (p.row === closer.row && p.col > closer.col)));
	if (second === undefined) throw new Error(`no closed stretch after the first one's «:\n${take.text()}`);
	await take.click('open2', second);
	await take.settle(1500, 15000);
	await sleep(2200);

	await take.ask(LIST, '2');
	await sleep(1500);
	// Letters for the list's stretches; the newest reply's second list item's is typed, as a reader
	// choosing would.
	const letters = await take.press('letters', ALT_DOWN);
	const rows = take.text().split('\n');
	const items = letters.filter((l) => /^\s*(?:[-*+]|\d+[.)])\s/.test(rows[l.row] ?? '')).sort((a, b) => LETTERS.indexOf(a.letter) - LETTERS.indexOf(b.letter));
	const pick = items[1] ?? letters[1] ?? letters[0];
	if (pick === undefined) throw new Error(`alt+down put up no letters:\n${take.text()}`);
	await sleep(1400);
	take.mark('typed', pick);
	await take.type(pick.letter);
	await take.settle(1500, 15000);
	await sleep(2000);

	// The newest reply's « takes the first letter: the one the typed letter just opened.
	const [toClose] = (await take.press('letters2', ALT_UP)).sort((a, b) => LETTERS.indexOf(a.letter) - LETTERS.indexOf(b.letter));
	if (toClose === undefined) throw new Error(`alt+up put up no letters:\n${take.text()}`);
	await sleep(1400);
	take.mark('typed2', toClose);
	await take.type(toClose.letter);
	await take.settle(1500, 15000);
	await sleep(1500);
	take.mark('end');
} finally {
	await take.finish();
}
