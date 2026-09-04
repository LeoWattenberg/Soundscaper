/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { GUIDE_EXAMPLE_BASE_URL, exampleAudio, exampleUrl } from '../handbook/guides/example-audio.mjs';
import { GUIDE_FIXTURES } from '../handbook/guides/fixtures.mjs';
import { SOUNDSCAPER_GUIDE_GROUPS, SOUNDSCAPER_GUIDES } from '../handbook/guides/soundscaper.mjs';
import {
	STEP_KINDS,
	check,
	cursor,
	describeStep,
	dragClip,
	effect,
	importAudio,
	menu,
	open,
	selectClips,
	selectRange,
	validateGuide,
	validateTutorial,
} from '../handbook/guides/steps.mjs';
import { SOUNDSCAPER_TUTORIALS } from '../handbook/guides/tutorials.mjs';
import {
	categoryRoute,
	guideRoute,
	howToSchema,
	plainText,
	relatedGuides,
	renderGuidePages,
	renderTutorialPages,
	resolveGuideLinks,
	tutorialExamples,
	tutorialRoute,
} from '../scripts/lib/docs-reference/guides.mjs';
import { AUDACITY_PINNED_BUILTIN_EFFECT_REGISTRATIONS } from '../src/common/editor/audacity-pinned-ui-inventory.js';

const fixture = (id) => GUIDE_FIXTURES[id];
const howto = (entry) => describeStep(entry, { fixture, facet: 'howto' });
const tutorial = (entry) => describeStep(entry, { fixture, facet: 'tutorial' });
const inputs = { groups: SOUNDSCAPER_GUIDE_GROUPS, tutorials: SOUNDSCAPER_TUTORIALS, describeStep, fixture, exampleUrl };
const renderGuides = () => renderGuidePages(inputs);
const renderTutorials = () => renderTutorialPages(inputs);
const pageFor = (pages, guide) => pages.get(`${guideRoute(guide, SOUNDSCAPER_GUIDE_GROUPS).split('/')[2]}/${guide.id}.md`);

/** The words that only a canned exercise would use: an example file, or a stretch of one. */
const EXERCISE_WORDS = /guide-[a-z0-9-]+\.(?:wav|aup3)|\d+% mark|quarter point|halfway point|three-quarter point|from the start to|halfway through|a quarter of the way through|three quarters of the way through|seconds? to the right/u;

test('every guide and tutorial validates, has a unique id, and only imports known example files', () => {
	const ids = new Set();
	for (const guide of SOUNDSCAPER_GUIDES) {
		validateGuide(guide, GUIDE_FIXTURES);
		assert.ok(!ids.has(guide.id), `duplicate guide id ${guide.id}`);
		ids.add(guide.id);
	}
	for (const lesson of SOUNDSCAPER_TUTORIALS) {
		validateTutorial(lesson, GUIDE_FIXTURES);
		assert.ok(!ids.has(lesson.id), `duplicate id ${lesson.id}`);
		ids.add(lesson.id);
	}
	assert.ok(SOUNDSCAPER_GUIDES.length >= 20, 'the catalog covers the common Audacity tasks');
	assert.ok(SOUNDSCAPER_TUTORIALS.length >= 3, 'a newcomer has more than one lesson to start with');
	assert.equal(SOUNDSCAPER_GUIDE_GROUPS.flatMap((group) => group.guides).length, SOUNDSCAPER_GUIDES.length);
});

test('a step that touches example material must say what a reader uses instead', () => {
	assert.throws(() => importAudio('music-loop'), /`what` phrase/u);
	assert.throws(() => selectRange(0, 0.5), /`where` phrase/u);
	assert.throws(() => cursor(0.5), /`where` phrase/u);
	assert.throws(() => selectClips(['music-loop']), /`which` phrase/u);
	assert.throws(() => selectClips(['music-loop', 'second-loop'], { which: ['one'] }), /one `which` phrase per clip/u);
	assert.throws(() => dragClip(1), /`where` phrase/u);
	assert.throws(() => check({ moved: 'music-loop' }), /`that` phrase/u);
	assert.throws(() => effect({ group: 'Volume and compression', name: 'Auto Duck', settings: [{ label: 'Control track', option: 'guide-second-loop' }] }), /with `as`/u);
	assert.throws(() => menu(['Select', 'Select all'], { where: 'anywhere' }), /does not take `where`/u);
	assert.doesNotThrow(() => check({ clips: 2 }));
});

test('step constructors refuse malformed input', () => {
	assert.throws(() => selectRange(0.5, 0.2, { where: 'x' }), RangeError);
	assert.throws(() => selectRange(0, 2, { where: 'x' }), RangeError);
	assert.throws(() => menu([]), TypeError);
	assert.throws(() => effect({ group: 'Fading', name: 'Fade In', direct: true, settings: [{ label: 'x', value: '1' }] }), RangeError);
	assert.throws(() => effect({ group: 'Fading', name: 'Fade In', settings: [{ label: 'x' }] }), TypeError);
	assert.throws(() => check({}), TypeError);
	assert.throws(() => importAudio('', { what: 'x' }), TypeError);
	assert.throws(() => validateGuide({
		id: 'Bad Id', title: 't', description: 'd', audacity: 'a', intro: 'i', steps: [open()], tips: [],
	}, GUIDE_FIXTURES), RangeError);
	assert.throws(() => validateGuide({
		id: 'no-open', title: 't', description: 'd', audacity: 'a', intro: 'i', steps: [menu(['Select', 'Select all'])], tips: [],
	}, GUIDE_FIXTURES), RangeError);
	assert.throws(() => validateGuide({
		id: 'bad-fixture', title: 't', description: 'd', audacity: 'a', intro: 'i', steps: [open(), importAudio('missing', { what: 'x' })], tips: [],
	}, GUIDE_FIXTURES), RangeError);
	assert.throws(() => validateTutorial({
		id: 'no-example', title: 't', description: 'd', intro: 'i', steps: [open()], learn: ['a'], next: ['b'],
	}, GUIDE_FIXTURES), /example recording/u);
	assert.throws(() => describeStep(open(), { fixture, facet: 'poem' }), RangeError);
});

test('the how-to facet describes the reader\'s material and the tutorial facet names the example', () => {
	const described = new Set();
	for (const document of [...SOUNDSCAPER_GUIDES, ...SOUNDSCAPER_TUTORIALS]) {
		for (const entry of document.steps) {
			assert.ok(howto(entry).length > 0 && tutorial(entry).length > 0);
			described.add(entry.kind);
		}
	}
	for (const kind of STEP_KINDS) {
		if (kind !== 'note') assert.ok(described.has(kind), `no guide exercises the ${kind} step`);
	}
	const bring = importAudio('noisy-take', { what: 'the recording you want to clean up' });
	assert.match(howto(bring), /pick the recording you want to clean up\./u);
	assert.match(tutorial(bring), /pick `guide-noisy-take\.wav` — a short take whose first half second is room noise/u);
	assert.doesNotMatch(howto(bring), EXERCISE_WORDS);

	const range = selectRange(0, 0.15, { where: 'a stretch that contains only the noise' });
	assert.equal(howto(range), 'Drag in the ruler above the clip to select a stretch that contains only the noise.');
	assert.match(tutorial(range), /from the start to the 15% mark, to select a stretch that contains only the noise/u);

	const clips = selectClips(['music-loop', 'second-loop'], { which: ['the music clip', 'the voice clip'] });
	assert.match(howto(clips), /^Click the name bar of the music clip, then hold Shift and click the name bar of the voice clip, so both are selected\.$/u);
	assert.match(tutorial(clips), /`guide-music-loop\.wav`.*`guide-second-loop\.wav`/u);

	const duck = effect({ group: 'Volume and compression', name: 'Auto Duck', settings: [{ label: 'Control track', option: 'guide-second-loop', as: 'the voice track' }] });
	assert.match(howto(duck), /choose the voice track for \*\*Control track\*\*/u);
	assert.match(tutorial(duck), /choose \*\*guide-second-loop\*\* for \*\*Control track\*\*/u);

	const moved = check({ moved: 'music-loop' }, { that: 'The clip now begins where you dropped it.' });
	assert.equal(howto(moved), 'The clip now begins where you dropped it.');
	assert.match(tutorial(moved), /starting later than 0 s/u);
	assert.match(howto(check({ clips: 2, clip: 'Mix' })), /2 clips and a clip named \*\*Mix\*\*/u);
	assert.match(howto(menu(['Select', 'Select all'])), /\*\*Select → Select all\*\*/u);
	assert.throws(() => howto({ kind: 'unknown' }), RangeError);
});

test('no how-to page names an example file or a stretch of one, and every tutorial does', () => {
	const guidePages = renderGuides();
	for (const guide of SOUNDSCAPER_GUIDES) {
		const page = pageFor(guidePages, guide);
		assert.doesNotMatch(page, EXERCISE_WORDS, `${guide.id} reads as an exercise`);
	}
	const tutorialPages = renderTutorials();
	for (const lesson of SOUNDSCAPER_TUTORIALS) {
		const page = tutorialPages.get(`${lesson.id}.md`);
		assert.ok(page, `missing page for ${lesson.id}`);
		for (const id of tutorialExamples(lesson)) {
			assert.ok(page.includes(`[\`${GUIDE_FIXTURES[id].file}\`](${exampleUrl(id)})`), `${lesson.id} does not hand out ${id}`);
		}
		assert.match(page, /:::tip\[What you will need\]/u);
		assert.match(page, /## What you will learn\n\n- /u);
		assert.match(page, /## Where next\n\n- /u);
		assert.match(page, /tests\/browser\/soundscaper-tutorials\.spec\.js/u);
		assert.doesNotMatch(page, /\]\((?:guide|tutorial):/u, `${lesson.id} left an unresolved link`);
	}
	assert.match(GUIDE_EXAMPLE_BASE_URL, /^https:\/\/assets\.soundscaper\.org\//u);
});

test('the example recordings are the same bytes every time and describe themselves truthfully', () => {
	for (const [id, entry] of Object.entries(GUIDE_FIXTURES)) {
		const bytes = exampleAudio(id);
		assert.equal(bytes.subarray(0, 4).toString(), 'RIFF');
		assert.equal(bytes.readUInt16LE(22), entry.channels, `${id} channel count`);
		assert.equal(bytes.readUInt32LE(24), 48_000, `${id} sample rate`);
		assert.equal(bytes.length, 44 + entry.seconds * 48_000 * entry.channels * 2, `${id} length`);
		assert.equal(exampleAudio(id), bytes, 'the example is cached, not resynthesised');
	}
	assert.throws(() => exampleAudio('nope'), RangeError);
});

test('guide pages carry the generated banner, the Audacity aside, and every step in order', () => {
	const pages = renderGuides();
	// Every guide, one overview per category, and the index above them all.
	assert.equal(pages.size, SOUNDSCAPER_GUIDES.length + SOUNDSCAPER_GUIDE_GROUPS.length + 1);
	const index = pages.get('index.md');
	assert.match(index, /title: "How-to guides"/u);
	assert.match(index, /\]\(\/tutorials\/\)/u, 'the guide index points newcomers at the tutorials');
	for (const guide of SOUNDSCAPER_GUIDES) {
		const page = pageFor(pages, guide);
		assert.ok(page, `missing page for ${guide.id}`);
		assert.match(page, /<!-- Generated by `node scripts\/docs-reference\.mjs`\. Do not edit\. -->/u);
		assert.match(page, new RegExp(`title: ${JSON.stringify(guide.title).replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}`, 'u'));
		assert.match(page, /:::note\[Coming from Audacity\?\]/u);
		assert.match(page, /## Steps\n\n1\. Open Soundscaper\./u);
		assert.match(page, new RegExp(`\n${String(guide.steps.length)}\\. `, 'u'));
		assert.match(page, /## Tips\n\n- /u);
		assert.match(page, /tests\/browser\/soundscaper-guides\.spec\.js/u);
		assert.match(index, new RegExp(`\\[${guide.title.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}\\]\\(${guideRoute(guide, SOUNDSCAPER_GUIDE_GROUPS)}\\)`, 'u'));
	}
	assert.throws(() => renderGuidePages({ ...inputs, groups: [] }), TypeError);
	assert.throws(() => renderTutorialPages({ ...inputs, tutorials: [] }), TypeError);
});

test('the DC offset guide names Audacity’s own effect rather than Normalize', () => {
	// Audacity 4 registers Remove DC offset as a builtin of its own, extracted from
	// Normalize, so the aside must not send readers to Normalize's checkbox instead.
	assert.ok(AUDACITY_PINNED_BUILTIN_EFFECT_REGISTRATIONS.includes('RemoveDCOffsetEffect'));
	const guide = SOUNDSCAPER_GUIDES.find((entry) => entry.id === 'fix-dc-offset');
	assert.ok(guide, 'the fix-dc-offset guide is missing');
	assert.match(guide.audacity, /→ Remove DC offset$/u);
	assert.doesNotMatch(guide.audacity, /Normalize/u);
});

test('guide pages link to related guides, their reference pages, and carry a HowTo schema', () => {
	const pages = renderGuides();
	for (const guide of SOUNDSCAPER_GUIDES) {
		const page = pageFor(pages, guide);
		const related = relatedGuides(guide, SOUNDSCAPER_GUIDE_GROUPS);
		assert.ok(related.length > 0, `${guide.id} has no related guides`);
		assert.ok(!related.includes(guide), 'a guide never lists itself');
		for (const entry of related) assert.ok(page.includes(`](${guideRoute(entry, SOUNDSCAPER_GUIDE_GROUPS)})`), `${guide.id} links ${entry.id}`);
		assert.match(page, /## Related guides\n\nMore \[[^\]]+\]\(\/guides\/[a-z-]+\/\) guides:\n\n- \[/u);
		const referenced = ['menu', 'effect', 'export', 'nyquist', 'save', 'analyze', 'track-menu', 'rack-effect', 'noise-profile', 'export-project', 'open-project-file', 'open-audacity-project'];
		assert.equal(page.includes('## Reference\n\n- ['), guide.steps.some((entry) => referenced.includes(entry.kind)), `${guide.id} reference section`);
		if (guide.steps.some((entry) => entry.kind === 'effect')) assert.match(page, /audio-effects\/#parameters/u);
		if (guide.steps.some((entry) => entry.kind === 'export')) assert.match(page, /generated\/formats\//u);
		assert.ok(page.includes('\nhead:\n  - tag: script\n    attrs:\n      type: "application/ld+json"\n    content: "'), `${guide.id} declares the HowTo head entry`);
		const schema = howToSchema(guide, howto);
		assert.equal(schema['@type'], 'HowTo');
		assert.equal(schema.step.length, guide.steps.filter((entry) => entry.kind !== 'note').length);
		assert.ok(page.includes(JSON.stringify(JSON.stringify(schema))), 'the page head carries the schema verbatim');
	}
	// Cross-links in tips come first, ahead of the rest of the group.
	const amplify = SOUNDSCAPER_GUIDES.find((guide) => guide.id === 'make-a-recording-louder');
	assert.equal(relatedGuides(amplify, SOUNDSCAPER_GUIDE_GROUPS)[0].id, 'normalize-peaks');
	assert.equal(plainText('Choose **File → Import audio** and pick `x.wav`; see [Normalize](guide:normalize-peaks).'), 'Choose File → Import audio and pick x.wav; see Normalize.');
	const broken = { ...amplify, tips: ['[x](guide:does-not-exist)'] };
	assert.throws(() => relatedGuides(broken, [{ title: 'Broken', guides: [broken] }]), /unknown guide does-not-exist/u);
	assert.throws(() => relatedGuides(broken, SOUNDSCAPER_GUIDE_GROUPS), /not in any guide group/u);
});

test('guides are published under their category, tutorials beside them, and every route is one the catalogs produced', () => {
	const pages = renderGuides();
	const tutorialPages = renderTutorials();
	const index = pages.get('index.md');
	for (const group of SOUNDSCAPER_GUIDE_GROUPS) {
		const overview = pages.get(`${group.slug}/index.md`);
		assert.ok(overview, `missing overview for ${group.slug}`);
		assert.match(overview, /\n {2}label: "Overview"\n/u);
		assert.match(overview, new RegExp(`title: ${JSON.stringify(group.title)}`, 'u'));
		assert.match(index, new RegExp(`## \\[${group.title}\\]\\(${categoryRoute(group)}\\)`, 'u'));
		for (const guide of group.guides) {
			assert.equal(guideRoute(guide, SOUNDSCAPER_GUIDE_GROUPS), `/guides/${group.slug}/${guide.id}/`);
			assert.ok(pages.has(`${group.slug}/${guide.id}.md`), `${guide.id} is not under ${group.slug}`);
			assert.ok(overview.includes(`](/guides/${group.slug}/${guide.id}/)`), `${group.slug} overview omits ${guide.id}`);
		}
		for (const other of SOUNDSCAPER_GUIDE_GROUPS) {
			if (other !== group) assert.ok(overview.includes(`](${categoryRoute(other)})`), `${group.slug} omits ${other.slug}`);
		}
	}
	const routes = new Set(SOUNDSCAPER_GUIDES.map((guide) => guideRoute(guide, SOUNDSCAPER_GUIDE_GROUPS)));
	for (const group of SOUNDSCAPER_GUIDE_GROUPS) routes.add(categoryRoute(group));
	for (const lesson of SOUNDSCAPER_TUTORIALS) routes.add(tutorialRoute(lesson));
	routes.add('/guides/');
	routes.add('/tutorials/');
	for (const [name, content] of [...pages, ...tutorialPages]) {
		for (const [, route] of content.matchAll(/\]\((\/(?:guides|tutorials)\/[^)]*)\)/gu)) {
			assert.ok(routes.has(route), `${name} links unpublished route ${route}`);
		}
		assert.doesNotMatch(content, /\]\((?:guide|tutorial):/u, `${name} left an unresolved link`);
	}
	const tutorialIndex = tutorialPages.get('index.md');
	for (const lesson of SOUNDSCAPER_TUTORIALS) assert.ok(tutorialIndex.includes(`](${tutorialRoute(lesson)})`), `tutorial index omits ${lesson.id}`);
	assert.equal(resolveGuideLinks('see [x](guide:normalize-peaks)', SOUNDSCAPER_GUIDE_GROUPS), 'see [x](/guides/volume/normalize-peaks/)');
	assert.equal(resolveGuideLinks('[t](tutorial:your-first-project)', SOUNDSCAPER_GUIDE_GROUPS, SOUNDSCAPER_TUTORIALS), '[t](/tutorials/your-first-project/)');
	assert.throws(() => resolveGuideLinks('[x](guide:nope)', SOUNDSCAPER_GUIDE_GROUPS), /unknown guide nope/u);
	assert.throws(() => resolveGuideLinks('[x](tutorial:nope)', SOUNDSCAPER_GUIDE_GROUPS, SOUNDSCAPER_TUTORIALS), /unknown tutorial nope/u);
});
