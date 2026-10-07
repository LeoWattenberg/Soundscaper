/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { GUIDE_FIXTURES } from '../handbook/guides/fixtures.mjs';
import { SOUNDSCAPER_GUIDE_GROUPS, SOUNDSCAPER_GUIDES } from '../handbook/guides/soundscaper.mjs';
import { describeStep, open, trackMenu, validateGuide } from '../handbook/guides/steps.mjs';
import { renderGuidePages } from '../scripts/lib/docs-reference/guides.mjs';

const workflows = [
	{ id: 'split-stereo-to-centered-mono', command: '**Track channels → Split stereo to centered mono**', clips: 2, tracks: 3 },
	{ id: 'combine-mono-tracks-into-stereo', command: '**Track channels → Make stereo track**', clips: 1, tracks: 2 },
	{ id: 'duplicate-a-whole-track', command: '**Tracks → Duplicate track**', clips: 4, tracks: 3 },
	{ id: 'remove-a-track', command: '**Tracks → Remove tracks**', clips: 1, tracks: 2 },
];

for (const { id, command, clips, tracks } of workflows) {
	test(`the ${id} guide is discoverable and checks the resulting tracks and clips`, () => {
		const guide = SOUNDSCAPER_GUIDES.find((entry) => entry.id === id);
		assert.ok(guide, `missing track workflow: ${id}`);
		const pages = renderGuidePages({ groups: SOUNDSCAPER_GUIDE_GROUPS, describeStep, fixture: (fixtureId) => GUIDE_FIXTURES[fixtureId] });
		const page = pages.get(`tracks-and-export/${id}.md`);
		const route = `/guides/tracks-and-export/${id}/`;
		assert.ok(page.includes(command));
		assert.ok(pages.get('tracks-and-export/index.md').includes(`](${route})`));
		assert.ok(pages.get('index.md').includes(`](${route})`));
		assert.equal(guide.steps.at(-1).clips, clips);
		assert.equal(guide.steps.at(-1).tracks, tracks);
		assert.doesNotMatch(page, /guide-[a-z-]+\.wav|quarter point|halfway point/u);
	});
}

test('a track-menu step identifies the intended recording independently of import order', () => {
	const entry = trackMenu(['Track channels', 'Make stereo track'], { fixture: 'quiet-take', which: 'the left-channel recording' });
	assert.equal(entry.fixture, 'quiet-take');
	const howto = describeStep(entry, { facet: 'howto', fixture: (id) => GUIDE_FIXTURES[id] });
	assert.match(howto, /the left-channel recording/u);
	assert.doesNotMatch(howto, /guide-quiet-take/u);
	assert.match(describeStep(entry, { facet: 'tutorial', fixture: (id) => GUIDE_FIXTURES[id] }), /guide-quiet-take\.wav/u);
});

test('a targeted track menu requires a reader-facing phrase and a known fixture', () => {
	assert.throws(() => trackMenu(['Track channels'], { fixture: 'quiet-take' }), /`which` phrase/u);
	assert.throws(() => trackMenu(['Track channels'], { fixture: 4, which: 'the recording' }), /fixture/u);
	const guide = { ...SOUNDSCAPER_GUIDES[0], steps: [open(), trackMenu(['Track channels'], { fixture: 'missing-take', which: 'the recording' })] };
	assert.throws(() => validateGuide(guide, GUIDE_FIXTURES), /unknown.*fixture/u);
});

test('whole-track duplication selects one of two clips and verifies that both were copied', () => {
	const guide = SOUNDSCAPER_GUIDES.find((entry) => entry.id === 'duplicate-a-whole-track');
	assert.ok(guide);
	assert.equal(guide.steps.find((entry) => entry.kind === 'check').clips, 2);
	assert.equal(guide.steps.find((entry) => entry.kind === 'select-clips').fixtures.length, 1);
	assert.match(guide.intro, /whole track/u);
});

test('stereo assembly addresses the left mono track and explains which partner is used', () => {
	const guide = SOUNDSCAPER_GUIDES.find((entry) => entry.id === 'combine-mono-tracks-into-stereo');
	assert.ok(guide);
	assert.equal(guide.steps.find((entry) => entry.kind === 'track-menu').fixture, 'quiet-take');
	assert.match(guide.intro, /left channel/u);
	assert.match(guide.intro, /first compatible mono track below/u);
	assert.match(guide.intro, /one stereo clip/u);
});
