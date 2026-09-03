/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The handbook's guide pages, rendered from the guide catalog.
 *
 * A guide page is prose around the same step list the browser suite replays,
 * so every menu path, field label and button name a reader is told to use is
 * the one the suite clicked when the page was generated. The renderer never
 * invents a label of its own; the sentences come from `describeStep`.
 *
 * Each page also carries what search engines and readers use to move on: a
 * related-guides list built from the guide's group and its own cross-links,
 * links to the reference pages behind the steps it uses, and a schema.org
 * HowTo description of the steps in the page head.
 */

import { compareText, page } from './markdown.mjs';

const REPLAY_SPEC = 'tests/browser/soundscaper-guides.spec.js';

/**
 * Prose links another guide by its id, never by a route: `[Normalize](guide:normalize-peaks)`.
 * Routes carry the category a guide currently sits in, so writing one by hand
 * would rot the moment a guide moved between categories; resolving the marker
 * here also makes an unknown id fail the build instead of shipping a dead link.
 */
const GUIDE_LINK = /\(guide:([a-z0-9-]+)\)/gu;

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
		kinds: ['menu', 'mix-render', 'analyze', 'track-menu'],
		route: '/reference/generated/commands/',
		text: 'Every menu command and its keyboard shortcut is in the commands and shortcuts reference.',
	}),
]);

function assertGuideInputs({ groups, describeStep, fixtureFile }) {
	if (!Array.isArray(groups) || groups.length === 0) throw new TypeError('At least one guide group is required.');
	for (const group of groups) {
		if (typeof group?.title !== 'string' || !Array.isArray(group.guides) || group.guides.length === 0) {
			throw new TypeError('Every guide group needs a title and at least one guide.');
		}
		if (typeof group.slug !== 'string' || typeof group.description !== 'string') {
			throw new TypeError(`Guide category ${group.title} needs a slug and a description.`);
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

/** Where a guide is published: its category's directory, then its own id. */
export function guideRoute(guide, groups) {
	const group = groups.find((candidate) => candidate.guides.includes(guide));
	if (!group) throw new RangeError(`Guide ${String(guide?.id)} is not in any guide group.`);
	return `/guides/${group.slug}/${guide.id}/`;
}

export function categoryRoute(group) {
	return `/guides/${group.slug}/`;
}

function guideLink(guide, groups) {
	return `[${guide.title}](${guideRoute(guide, groups)}) — ${guide.description}`;
}

/** Expand every `guide:<id>` marker in prose into the guide's current route. */
export function resolveGuideLinks(markdown, groups) {
	const byId = new Map(groups.flatMap((group) => group.guides).map((guide) => [guide.id, guide]));
	return markdown.replace(GUIDE_LINK, (_, id) => {
		const guide = byId.get(id);
		if (!guide) throw new RangeError(`Prose links unknown guide ${id}.`);
		return `(${guideRoute(guide, groups)})`;
	});
}

/** The guides a page points readers to: its own cross-links first, then the rest of its group. */
export function relatedGuides(guide, groups) {
	const byId = new Map(groups.flatMap((group) => group.guides).map((entry) => [entry.id, entry]));
	const group = groups.find((candidate) => candidate.guides.includes(guide));
	if (!group) throw new RangeError(`Guide ${String(guide?.id)} is not in any guide group.`);
	GUIDE_LINK.lastIndex = 0;
	const linked = [...guide.tips.join('\n').matchAll(GUIDE_LINK)].map((match) => match[1]);
	const ordered = [];
	for (const id of [...linked, ...group.guides.map((entry) => entry.id)]) {
		const entry = byId.get(id);
		if (!entry) throw new RangeError(`Guide ${guide.id} links to unknown guide ${id}.`);
		if (entry !== guide && !ordered.includes(entry)) ordered.push(entry);
	}
	return ordered;
}

function referencesFor(guide) {
	const kinds = new Set(guide.steps.map((entry) => entry.kind));
	return REFERENCES.filter((reference) => reference.kinds.some((kind) => kinds.has(kind)));
}

/** A schema.org HowTo for the page head, built from the same steps the page lists. */
export function howToSchema(guide, describe) {
	const steps = guide.steps
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
		name: guide.title,
		description: guide.description,
		tool: [{ '@type': 'HowToTool', name: 'Soundscaper' }],
		step: steps,
	};
}

function renderGuide(guide, order, describe, groups) {
	const related = relatedGuides(guide, groups);
	const references = referencesFor(guide);
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
		...(references.length > 0
			? ['## Reference', '', references.map((reference) => `- [${reference.text}](${reference.route})`).join('\n'), '']
			: []),
		'## About this guide',
		'',
		`Every step on this page is replayed against each build of Soundscaper by the browser suite (\`${REPLAY_SPEC}\`). If a menu entry, field or button stops matching, the build fails until the guide is corrected, so the steps you read are the steps the editor accepts.`,
	].join('\n'), groups);
	return page({
		title: guide.title,
		description: guide.description,
		order,
		body,
		head: [{
			tag: 'script',
			attrs: { type: 'application/ld+json' },
			content: JSON.stringify(howToSchema(guide, describe)),
		}],
	});
}

/** A category's own page: what it covers, and every guide in it. */
function renderCategory(group, order, groups) {
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
	return page({
		title: group.title,
		description: group.description,
		order,
		// The sidebar already names the category as the group's own label, so the
		// page inside it is listed as the overview it is.
		label: 'Overview',
		body,
	});
}

function renderIndex(groups) {
	const sections = groups.map((group) => [
		`## [${group.title}](${categoryRoute(group)})`,
		'',
		group.description,
		'',
		group.guides.map((guide) => `- ${guideLink(guide, groups)}`).join('\n'),
	].join('\n'));
	const body = [
		'Each guide takes one common task — the kind Audacity users search for — and walks through it in Soundscaper, step by step, with the exact menu entries and dialog fields to use. Every guide ends with what you should see and a few tips for when the result is not what you wanted.',
		'',
		'The guides use short example recordings you can stand in for with your own files. Nothing in them needs the desktop app; the browser editor does everything shown.',
		'',
		...sections.flatMap((section) => [section, '']),
		'## How the guides stay correct',
		'',
		`The steps are data that two tools share: the generator that writes these pages and the browser suite (\`${REPLAY_SPEC}\`) that clicks through every guide against each build. A guide that no longer matches the editor fails the build rather than going stale.`,
	].join('\n');
	return page({
		title: 'Guides',
		description: 'Step-by-step guides for the tasks people most often bring to an audio editor.',
		order: 0,
		body,
	});
}

/** Render the guide index and one page per guide, keyed by file name. */
export function renderGuidePages({ groups, describeStep, fixtureFile }) {
	assertGuideInputs({ groups, describeStep, fixtureFile });
	const describe = (entry) => describeStep(entry, { fixtureFile });
	const documents = new Map([['index.md', renderIndex(groups)]]);
	for (const group of groups) {
		// The category page sorts above its guides, which are numbered from one
		// in the order the catalog lists them.
		documents.set(`${group.slug}/index.md`, renderCategory(group, 0, groups));
		for (const [position, guide] of group.guides.entries()) {
			const name = `${group.slug}/${guide.id}.md`;
			if (documents.has(name)) throw new RangeError(`Duplicate guide page ${name}.`);
			documents.set(name, renderGuide(guide, position + 1, describe, groups));
		}
	}
	return new Map([...documents].sort(([left], [right]) => compareText(left, right)));
}
