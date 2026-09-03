/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The handbook's how-to guides and tutorials, rendered from their catalogs.
 *
 * Both kinds of page are prose around a step list the browser suite replays,
 * so every menu path, field label and button name a reader is told to use is
 * the one the suite clicked when the page was generated. The renderer never
 * invents a label of its own; the sentences come from `describeStep`.
 *
 * The two differ in which facet of a step they show. A how-to describes the
 * reader's own material and never names an example file or a stretch of one;
 * a tutorial names the example it is a lesson on, tells the reader where to get
 * it, and says what to expect at each step.
 *
 * Each page also carries what search engines and readers use to move on: a
 * related list built from the page's own cross-links and its category, links to
 * the reference pages behind the step kinds it uses, and a schema.org HowTo
 * description of the steps in the page head.
 */

import { compareText, page } from './markdown.mjs';

const GUIDE_SPEC = 'tests/browser/soundscaper-guides.spec.js';
const TUTORIAL_SPEC = 'tests/browser/soundscaper-tutorials.spec.js';

/**
 * Prose links another page by its id, never by a route: `[Normalize](guide:normalize-peaks)`
 * or `[Your first project](tutorial:your-first-project)`. Guide routes carry
 * the category a guide currently sits in, so writing one by hand would rot the
 * moment a guide moved; resolving the marker here also makes an unknown id
 * fail the build instead of shipping a dead link.
 */
const PAGE_LINK = /\((guide|tutorial):([a-z0-9-]+)\)/gu;

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

function assertCatalog({ groups, tutorials = [], describeStep, fixture, exampleUrl }, { examples = false } = {}) {
	if (!Array.isArray(groups) || groups.length === 0) throw new TypeError('At least one guide group is required.');
	for (const group of groups) {
		if (typeof group?.title !== 'string' || !Array.isArray(group.guides) || group.guides.length === 0) {
			throw new TypeError('Every guide group needs a title and at least one guide.');
		}
		if (typeof group.slug !== 'string' || typeof group.description !== 'string') {
			throw new TypeError(`Guide category ${group.title} needs a slug and a description.`);
		}
	}
	if (!Array.isArray(tutorials)) throw new TypeError('The tutorial list must be an array.');
	if (typeof describeStep !== 'function') throw new TypeError('The step describer is required.');
	if (typeof fixture !== 'function') throw new TypeError('The example resolver is required.');
	if (examples && typeof exampleUrl !== 'function') throw new TypeError('Tutorials need the example download resolver.');
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

/** Where a guide is published: its category's directory, then its own id. */
export function guideRoute(guide, groups) {
	const group = groups.find((candidate) => candidate.guides.includes(guide));
	if (!group) throw new RangeError(`Guide ${String(guide?.id)} is not in any guide group.`);
	return `/guides/${group.slug}/${guide.id}/`;
}

export function categoryRoute(group) {
	return `/guides/${group.slug}/`;
}

export function tutorialRoute(tutorial) {
	return `/tutorials/${tutorial.id}/`;
}

function guideLink(guide, groups) {
	return `[${guide.title}](${guideRoute(guide, groups)}) — ${guide.description}`;
}

function tutorialLink(tutorial) {
	return `[${tutorial.title}](${tutorialRoute(tutorial)}) — ${tutorial.description}`;
}

/** Expand every `guide:<id>` and `tutorial:<id>` marker in prose into the page's current route. */
export function resolveGuideLinks(markdown, groups, tutorials = []) {
	const guides = new Map(groups.flatMap((group) => group.guides).map((guide) => [guide.id, guide]));
	const lessons = new Map(tutorials.map((tutorial) => [tutorial.id, tutorial]));
	return markdown.replace(PAGE_LINK, (_, kind, id) => {
		if (kind === 'guide') {
			const guide = guides.get(id);
			if (!guide) throw new RangeError(`Prose links unknown guide ${id}.`);
			return `(${guideRoute(guide, groups)})`;
		}
		const tutorial = lessons.get(id);
		if (!tutorial) throw new RangeError(`Prose links unknown tutorial ${id}.`);
		return `(${tutorialRoute(tutorial)})`;
	});
}

/** The guides a page points readers to: its own cross-links first, then the rest of its group. */
export function relatedGuides(guide, groups) {
	const byId = new Map(groups.flatMap((group) => group.guides).map((entry) => [entry.id, entry]));
	const group = groups.find((candidate) => candidate.guides.includes(guide));
	if (!group) throw new RangeError(`Guide ${String(guide?.id)} is not in any guide group.`);
	const linked = [...guide.tips.join('\n').matchAll(PAGE_LINK)]
		.filter((match) => match[1] === 'guide')
		.map((match) => match[2]);
	const ordered = [];
	for (const id of [...linked, ...group.guides.map((entry) => entry.id)]) {
		const entry = byId.get(id);
		if (!entry) throw new RangeError(`Guide ${guide.id} links to unknown guide ${id}.`);
		if (entry !== guide && !ordered.includes(entry)) ordered.push(entry);
	}
	return ordered;
}

function referencesFor(document) {
	const kinds = new Set(document.steps.map((entry) => entry.kind));
	return REFERENCES.filter((reference) => reference.kinds.some((kind) => kinds.has(kind)));
}

function renderReferences(document) {
	const references = referencesFor(document);
	if (references.length === 0) return [];
	return ['## Reference', '', references.map((reference) => `- [${reference.text}](${reference.route})`).join('\n'), ''];
}

/** A schema.org HowTo for the page head, built from the same steps the page lists. */
export function howToSchema(document, describe) {
	const steps = document.steps
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
		name: document.title,
		description: document.description,
		tool: [{ '@type': 'HowToTool', name: 'Soundscaper' }],
		step: steps,
	};
}

function schemaHead(document, describe) {
	return [{ tag: 'script', attrs: { type: 'application/ld+json' }, content: JSON.stringify(howToSchema(document, describe)) }];
}

function renderGuide(guide, order, describe, groups, tutorials) {
	const related = relatedGuides(guide, groups);
	const group = groups.find((candidate) => candidate.guides.includes(guide));
	const body = resolveGuideLinks([
		guide.intro,
		'',
		':::note[Coming from Audacity?]',
		`This is Audacity's **${guide.audacity}**. The names below are Soundscaper's own, which sometimes differ.`,
		':::',
		'',
		'## Steps',
		'',
		guide.steps.map((entry, index) => renderStep(entry, index, describe)).join('\n'),
		'',
		'## Tips',
		'',
		guide.tips.map((tip) => `- ${tip}`).join('\n'),
		'',
		'## Related guides',
		'',
		`More [${group.title.toLowerCase()}](${categoryRoute(group)}) guides:`,
		'',
		related.map((entry) => `- ${guideLink(entry, groups)}`).join('\n'),
		'',
		...renderReferences(guide),
		'## About this guide',
		'',
		`The procedure on this page — every menu entry, dialog, field and button, and the result it produces — is replayed against each build of Soundscaper by the browser suite (\`${GUIDE_SPEC}\`). If any of it stops matching the editor, the build fails until the guide is corrected. The values suggested are starting points that the editor is proven to accept; whether they suit your recording is for your ears to decide.`,
	].join('\n'), groups, tutorials);
	return page({ title: guide.title, description: guide.description, order, body, head: schemaHead(guide, describe) });
}

/** The example recordings a tutorial imports, each once, in the order it first uses them. */
export function tutorialExamples(tutorial) {
	const ids = [];
	for (const entry of tutorial.steps) {
		if (entry.kind === 'import' && !ids.includes(entry.fixture)) ids.push(entry.fixture);
	}
	return ids;
}

function renderTutorial(tutorial, order, describe, groups, tutorials, fixture, exampleUrl) {
	const examples = tutorialExamples(tutorial);
	const others = tutorials.filter((other) => other !== tutorial);
	const body = resolveGuideLinks([
		tutorial.intro,
		'',
		':::tip[What you will need]',
		examples.map((id) => `- Download [\`${fixture(id).file}\`](${exampleUrl(id)}) — ${fixture(id).description}.`).join('\n'),
		'',
		'Every step below works on these files exactly as they are, so what you see should match what the tutorial says. Soundscaper runs in the browser; nothing needs installing.',
		':::',
		'',
		'## What you will learn',
		'',
		tutorial.learn.map((item) => `- ${item}`).join('\n'),
		'',
		'## Steps',
		'',
		tutorial.steps.map((entry, index) => renderStep(entry, index, describe)).join('\n'),
		'',
		'## Where next',
		'',
		tutorial.next.map((item) => `- ${item}`).join('\n'),
		'',
		...(others.length > 0 ? ['## Other tutorials', '', others.map(tutorialLink).join('\n'), ''] : []),
		...renderReferences(tutorial),
		'## About this tutorial',
		'',
		`This tutorial is replayed, step for step and on these very files, against each build of Soundscaper by the browser suite (\`${TUTORIAL_SPEC}\`). If a step stops working, the build fails until the tutorial is corrected, so what you read is what the editor does.`,
	].join('\n'), groups, tutorials);
	return page({ title: tutorial.title, description: tutorial.description, order, body, head: schemaHead(tutorial, describe) });
}

/** A category's own page: what it covers, and every guide in it. */
function renderCategory(group, groups) {
	const body = [
		group.description,
		'',
		'## Guides in this category',
		'',
		group.guides.map((guide) => `- ${guideLink(guide, groups)}`).join('\n'),
		'',
		'## Other categories',
		'',
		groups.filter((other) => other !== group)
			.map((other) => `- [${other.title}](${categoryRoute(other)}) — ${other.description}`)
			.join('\n'),
	].join('\n');
	// The sidebar already names the category as the group's own label, so the
	// page inside it is listed as the overview it is.
	return page({ title: group.title, description: group.description, order: 0, label: 'Overview', body });
}

function renderGuideIndex(groups, tutorials) {
	const sections = groups.map((group) => [
		`## [${group.title}](${categoryRoute(group)})`,
		'',
		group.description,
		'',
		group.guides.map((guide) => `- ${guideLink(guide, groups)}`).join('\n'),
	].join('\n'));
	const body = [
		'Each guide takes one task — the kind Audacity users search for — and shows how to do it in Soundscaper on your own recording, with the exact menu entries and dialog fields to use. A guide assumes you have material to work on and know roughly what you want; if you would rather be walked through an example first, start with the [tutorials](/tutorials/).',
		'',
		...sections.flatMap((section) => [section, '']),
		'## How the guides stay correct',
		'',
		`The steps are data that two tools share: the generator that writes these pages and the browser suite (\`${GUIDE_SPEC}\`) that clicks through every guide against each build. A guide that no longer matches the editor fails the build rather than going stale.`,
	].join('\n');
	return page({
		title: 'How-to guides',
		description: 'Task-by-task instructions for the things people most often bring to an audio editor.',
		order: 0,
		body: resolveGuideLinks(body, groups, tutorials),
	});
}

function renderTutorialIndex(tutorials, groups) {
	const body = [
		'A tutorial is a lesson: it takes you through a complete piece of work on an example recording the handbook provides, step by step, and tells you what you should see along the way. Start here if you have not used Soundscaper before. When you know your way around and have a recording of your own, the [how-to guides](/guides/) cover the same operations and many more, one task at a time.',
		'',
		tutorials.map((tutorial) => `- ${tutorialLink(tutorial)}`).join('\n'),
		'',
		'## How the tutorials stay correct',
		'',
		`Each tutorial is replayed on its example files, step for step, against each build of Soundscaper by the browser suite (\`${TUTORIAL_SPEC}\`). A step that stops working fails the build rather than going stale.`,
	].join('\n');
	return page({
		title: 'Tutorials',
		description: 'Lessons that take a newcomer through complete pieces of work on example recordings.',
		order: 0,
		label: 'Overview',
		body: resolveGuideLinks(body, groups, tutorials),
	});
}

/** Render the guide index, one page per category, and one page per guide, keyed by file name. */
export function renderGuidePages({ groups, tutorials = [], describeStep, fixture }) {
	assertCatalog({ groups, tutorials, describeStep, fixture });
	const describe = (entry) => describeStep(entry, { fixture, facet: 'howto' });
	const documents = new Map([['index.md', renderGuideIndex(groups, tutorials)]]);
	for (const group of groups) {
		// The category page sorts above its guides, which are numbered from one
		// in the order the catalog lists them.
		documents.set(`${group.slug}/index.md`, renderCategory(group, groups));
		for (const [position, guide] of group.guides.entries()) {
			const name = `${group.slug}/${guide.id}.md`;
			if (documents.has(name)) throw new RangeError(`Duplicate guide page ${name}.`);
			documents.set(name, renderGuide(guide, position + 1, describe, groups, tutorials));
		}
	}
	return new Map([...documents].sort(([left], [right]) => compareText(left, right)));
}

/** Render the tutorial index and one page per tutorial, keyed by file name. */
export function renderTutorialPages({ tutorials, groups, describeStep, fixture, exampleUrl }) {
	assertCatalog({ groups, tutorials, describeStep, fixture, exampleUrl }, { examples: true });
	if (tutorials.length === 0) throw new TypeError('At least one tutorial is required.');
	const describe = (entry) => describeStep(entry, { fixture, facet: 'tutorial' });
	const documents = new Map([['index.md', renderTutorialIndex(tutorials, groups)]]);
	for (const [position, tutorial] of tutorials.entries()) {
		const name = `${tutorial.id}.md`;
		if (documents.has(name)) throw new RangeError(`Duplicate tutorial page ${name}.`);
		documents.set(name, renderTutorial(tutorial, position + 1, describe, groups, tutorials, fixture, exampleUrl));
	}
	return new Map([...documents].sort(([left], [right]) => compareText(left, right)));
}
