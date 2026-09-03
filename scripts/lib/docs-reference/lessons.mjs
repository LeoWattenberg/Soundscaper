/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The handbook's lesson pages, rendered from the lesson catalog.
 *
 * A lesson page is prose around the same step list the browser suite replays,
 * so every menu path, field label and button name a reader is told to use is
 * the one the suite clicked when the page was generated. The renderer never
 * invents a label of its own; the sentences come from `describeStep`.
 */

import { compareText, page } from './markdown.mjs';

const REPLAY_SPEC = 'tests/browser/soundscaper-lessons.spec.js';

function assertLessonInputs({ groups, describeStep, fixtureFile }) {
	if (!Array.isArray(groups) || groups.length === 0) throw new TypeError('At least one lesson group is required.');
	for (const group of groups) {
		if (typeof group?.title !== 'string' || !Array.isArray(group.lessons) || group.lessons.length === 0) {
			throw new TypeError('Every lesson group needs a title and at least one lesson.');
		}
	}
	if (typeof describeStep !== 'function') throw new TypeError('The step describer is required.');
	if (typeof fixtureFile !== 'function') throw new TypeError('The fixture file resolver is required.');
}

function renderStep(entry, index, describe) {
	const lines = [`${String(index + 1)}. ${describe(entry)}${entry.why ? ` ${entry.why}` : ''}`];
	if (entry.see) lines.push(`   *You should see:* ${entry.see}`);
	return lines.join('\n');
}

function renderLesson(lesson, order, describe) {
	const body = [
		lesson.intro,
		'',
		':::note[Coming from Audacity?]',
		`This is Audacity's **${lesson.audacity}**. The names below are Soundscaper's own, which sometimes differ.`,
		':::',
		'',
		'## Steps',
		'',
		lesson.steps.map((entry, index) => renderStep(entry, index, describe)).join('\n'),
		'',
		'## Tips',
		'',
		lesson.tips.map((tip) => `- ${tip}`).join('\n'),
		'',
		'## About this lesson',
		'',
		`Every step on this page is replayed against each build of Soundscaper by the browser suite (\`${REPLAY_SPEC}\`). If a menu entry, field or button stops matching, the build fails until the lesson is corrected, so the steps you read are the steps the editor accepts.`,
	].join('\n');
	return page({ title: lesson.title, description: lesson.description, order, body });
}

function renderIndex(groups) {
	const sections = groups.map((group) => [
		`## ${group.title}`,
		'',
		group.lessons.map((lesson) => `- [${lesson.title}](/lessons/${lesson.id}/) — ${lesson.description}`).join('\n'),
	].join('\n'));
	const body = [
		'Each lesson takes one common task — the kind Audacity users search for — and walks through it in Soundscaper, step by step, with the exact menu entries and dialog fields to use. Every lesson ends with what you should see and a few tips for when the result is not what you wanted.',
		'',
		'The lessons use short example recordings you can stand in for with your own files. Nothing in them needs the desktop app; the browser editor does everything shown.',
		'',
		...sections.flatMap((section) => [section, '']),
		'## How the lessons stay correct',
		'',
		`The steps are data that two tools share: the generator that writes these pages and the browser suite (\`${REPLAY_SPEC}\`) that clicks through every lesson against each build. A lesson that no longer matches the editor fails the build rather than going stale.`,
	].join('\n');
	return page({
		title: 'Lessons',
		description: 'Step-by-step lessons for the tasks people most often bring to an audio editor.',
		order: 0,
		body,
	});
}

/** Render the lesson index and one page per lesson, keyed by file name. */
export function renderLessonPages({ groups, describeStep, fixtureFile }) {
	assertLessonInputs({ groups, describeStep, fixtureFile });
	const describe = (entry) => describeStep(entry, { fixtureFile });
	const documents = new Map([['index.md', renderIndex(groups)]]);
	let order = 0;
	for (const group of groups) {
		for (const lesson of group.lessons) {
			order += 1;
			const name = `${lesson.id}.md`;
			if (documents.has(name)) throw new RangeError(`Duplicate lesson page ${name}.`);
			documents.set(name, renderLesson(lesson, order, describe));
		}
	}
	return new Map([...documents].sort(([left], [right]) => compareText(left, right)));
}
