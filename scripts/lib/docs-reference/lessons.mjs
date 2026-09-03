/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The handbook's lesson pages, rendered from the lesson catalog.
 *
 * A lesson page is prose around the same step list the browser suite replays,
 * so every menu path, field label and button name a reader is told to use is
 * the one the suite clicked when the page was generated. The renderer never
 * invents a label of its own; the sentences come from `describeStep`.
 *
 * Each page also carries what search engines and readers use to move on: a
 * related-lessons list built from the lesson's group and its own cross-links,
 * links to the reference pages behind the steps it uses, and a schema.org
 * HowTo description of the steps in the page head.
 */

import { compareText, page } from './markdown.mjs';

const REPLAY_SPEC = 'tests/browser/soundscaper-lessons.spec.js';
const LESSON_LINK = /\(\/lessons\/([a-z0-9-]+)\/\)/gu;

/** The reference page each step kind leans on, in the order the section lists them. */
const REFERENCES = Object.freeze([
	Object.freeze({
		kinds: ['effect', 'rack-effect', 'noise-profile'],
		route: '/reference/generated/audio-effects/#parameters',
		text: 'Every parameter of the effects used here, with its default and range, is in the audio effects reference.',
	}),
	Object.freeze({
		kinds: ['nyquist'],
		route: '/reference/generated/nyquist-plugins/',
		text: 'The bundled Nyquist plug-ins and their controls are listed in the Nyquist plug-ins reference.',
	}),
	Object.freeze({
		kinds: ['export'],
		route: '/reference/generated/formats/',
		text: 'The export formats, their containers and channel limits are in the export formats reference.',
	}),
	Object.freeze({
		kinds: ['export-project', 'open-project-file', 'open-audacity-project', 'save'],
		route: '/reference/generated/project-files/',
		text: 'Project file suffixes and label file formats are in the project and label files reference.',
	}),
	Object.freeze({
		kinds: ['menu', 'analyze', 'track-menu'],
		route: '/reference/generated/commands/',
		text: 'Every menu command and its keyboard shortcut is in the commands and shortcuts reference.',
	}),
]);

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

/** Markdown reduced to the words a search result or a screen reader would speak. */
export function plainText(markdown) {
	return markdown
		.replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
		.replaceAll('**', '')
		.replaceAll('`', '');
}

function renderStep(entry, index, describe) {
	const lines = [`${String(index + 1)}. ${describe(entry)}${entry.why ? ` ${entry.why}` : ''}`];
	if (entry.see) lines.push(`   *You should see:* ${entry.see}`);
	return lines.join('\n');
}

function lessonLink(lesson) {
	return `[${lesson.title}](/lessons/${lesson.id}/) — ${lesson.description}`;
}

/** The lessons a page points readers to: its own cross-links first, then the rest of its group. */
export function relatedLessons(lesson, groups) {
	const byId = new Map(groups.flatMap((group) => group.lessons).map((entry) => [entry.id, entry]));
	const group = groups.find((candidate) => candidate.lessons.includes(lesson));
	if (!group) throw new RangeError(`Lesson ${String(lesson?.id)} is not in any lesson group.`);
	const linked = [...lesson.tips.join('\n').matchAll(LESSON_LINK)].map((match) => match[1]);
	const ordered = [];
	for (const id of [...linked, ...group.lessons.map((entry) => entry.id)]) {
		const entry = byId.get(id);
		if (!entry) throw new RangeError(`Lesson ${lesson.id} links to unknown lesson ${id}.`);
		if (entry !== lesson && !ordered.includes(entry)) ordered.push(entry);
	}
	return ordered;
}

function referencesFor(lesson) {
	const kinds = new Set(lesson.steps.map((entry) => entry.kind));
	return REFERENCES.filter((reference) => reference.kinds.some((kind) => kinds.has(kind)));
}

/** A schema.org HowTo for the page head, built from the same steps the page lists. */
export function howToSchema(lesson, describe) {
	const steps = lesson.steps
		.filter((entry) => entry.kind !== 'note')
		.map((entry, index) => ({
			'@type': 'HowToStep',
			position: index + 1,
			name: plainText(describe(entry)),
			text: plainText([describe(entry), entry.why, entry.see].filter(Boolean).join(' ')),
		}));
	return {
		'@context': 'https://schema.org',
		'@type': 'HowTo',
		name: lesson.title,
		description: lesson.description,
		tool: [{ '@type': 'HowToTool', name: 'Soundscaper' }],
		step: steps,
	};
}

function renderLesson(lesson, order, describe, groups) {
	const related = relatedLessons(lesson, groups);
	const references = referencesFor(lesson);
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
		'## Related lessons',
		'',
		related.map((entry) => `- ${lessonLink(entry)}`).join('\n'),
		'',
		...(references.length > 0
			? ['## Reference', '', references.map((reference) => `- [${reference.text}](${reference.route})`).join('\n'), '']
			: []),
		'## About this lesson',
		'',
		`Every step on this page is replayed against each build of Soundscaper by the browser suite (\`${REPLAY_SPEC}\`). If a menu entry, field or button stops matching, the build fails until the lesson is corrected, so the steps you read are the steps the editor accepts.`,
	].join('\n');
	return page({
		title: lesson.title,
		description: lesson.description,
		order,
		body,
		head: [{
			tag: 'script',
			attrs: { type: 'application/ld+json' },
			content: JSON.stringify(howToSchema(lesson, describe)),
		}],
	});
}

function renderIndex(groups) {
	const sections = groups.map((group) => [
		`## ${group.title}`,
		'',
		group.lessons.map((lesson) => `- ${lessonLink(lesson)}`).join('\n'),
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
			documents.set(name, renderLesson(lesson, order, describe, groups));
		}
	}
	return new Map([...documents].sort(([left], [right]) => compareText(left, right)));
}
