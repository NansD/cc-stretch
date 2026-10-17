// Records the launch film's take: asks Claude Code a question, clicks the stretch links it finds on
// screen, then asks a second. Writes out/take/frames.jsonl and out/take/marks.json beside this file.
// Needs WezTerm and a signed-in `claude`. It finds stretches by the OSC 8 links the plugin drew when
// the launch film was made; the plugin no longer draws those in the terminal, so against the current
// plugin it finds none. releases/0.4.0/take.mjs finds underlined phrases instead.
//   node film/take.mjs
import { REPO, sleep, startTake } from './recorder.mjs';

const QUESTIONS = ["What's a monad, really?", 'Which parts did I skip?'];
// The demo session reads the person's own instructions too; these keep the take to the feature.
const APPEND = 'This session is a recorded product demo for a general audience. Write in English only, and do not end replies with a status block or any closing summary. Use a few stretches. Make the long form of your first stretch add words before and between the words of its short form, not only after them, and put one more stretch inside that long form.';

const take = await startTake({ out: `${REPO}/film/out/take`, append: APPEND });
try {
	await take.ready();
	await take.ask(QUESTIONS[0]);
	await sleep(1500);

	const outer = take.links(/cc-stretch\.invalid\/open\//)[0];
	if (outer === undefined) throw new Error(`the reply has no stretch:\n${take.text()}`);
	await take.click('open', outer);
	await take.settle(1500, 15000);
	await sleep(1800);

	const nested = take.links(/cc-stretch\.invalid\/open\/.*%E2%80%BA/)[0];
	if (nested !== undefined) {
		await take.click('nest', nested);
		await take.settle(1500, 15000);
		await sleep(2200);
	}

	const closer = take.links(new RegExp(outer.link.replace('/open/', '/close/').replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$'))[0];
	if (closer !== undefined) {
		await take.click('close', closer);
		await take.settle(1500, 15000);
		await sleep(1500);
	}

	await take.ask(QUESTIONS[1], '2');
	await sleep(2500);
	take.mark('end');
} finally {
	await take.finish();
}
