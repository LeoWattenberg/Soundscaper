/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { GUIDE_FIXTURES } from '../handbook/guides/fixtures.mjs';
import { SOUNDSCAPER_GUIDE_GROUPS, SOUNDSCAPER_GUIDES } from '../handbook/guides/soundscaper.mjs';
import { describeStep } from '../handbook/guides/steps.mjs';
import { renderGuidePages } from '../scripts/lib/docs-reference/guides.mjs';

const workflows = [
	['generate-white-noise', 'tracks-and-export', 'generate', 'Noise'],
	['generate-a-frequency-sweep', 'tracks-and-export', 'generate', 'Chirp'],
	['generate-dtmf-tones', 'tracks-and-export', 'generate', 'DTMF tones'],
	['generate-morse-code', 'tracks-and-export', 'generate', 'Morse code'],
	['export-a-flac', 'tracks-and-export', 'export', 'FLAC'],
	['export-an-ogg-vorbis-file', 'tracks-and-export', 'export', 'Ogg Vorbis'],
	['swap-stereo-channels', 'tracks-and-export', 'track-menu', 'Swap stereo channels'],
	['cut-a-passage-and-leave-a-gap', 'editing', 'menu', 'Cut and leave gap'],
];

for (const [id, category, kind, label] of workflows) {
	test(`${id} is a discoverable guide with a replayed menu workflow`, () => {
		const guide = SOUNDSCAPER_GUIDES.find((entry) => entry.id === id);
		assert.ok(guide, `Missing guide ${id}`);
		assert.ok(guide.steps.some((entry) => entry.kind === kind && [entry.name, entry.format, entry.path?.at(-1)].includes(label)));
		const pages = renderGuidePages({ groups: SOUNDSCAPER_GUIDE_GROUPS, describeStep, fixture: (fixtureId) => GUIDE_FIXTURES[fixtureId] });
		const path = `/${category}/${id}/`;
		assert.ok(pages.get('index.md').includes(path));
		assert.ok(pages.get(`${category}/index.md`).includes(path));
		assert.doesNotMatch(pages.get(`${category}/${id}.md`), /guide-[a-z-]+\.wav|halfway point|quarter point/u);
	});
}

test('Morse output length is derived from the message rather than a duration input', () => {
	const guide = SOUNDSCAPER_GUIDES.find((entry) => entry.id === 'generate-morse-code');
	assert.ok(guide);
	const fields = guide.steps.find((entry) => entry.kind === 'generate').fields;
	assert.ok(fields.some((field) => field.field === 'text'));
	assert.ok(fields.some((field) => field.field === 'wordsPerMinute'));
	assert.ok(fields.every((field) => field.field !== 'durationSeconds'));
});

test('cutting with a gap preserves the later audio position and keeps a clipboard copy', () => {
	const guide = SOUNDSCAPER_GUIDES.find((entry) => entry.id === 'cut-a-passage-and-leave-a-gap');
	assert.ok(guide);
	assert.equal(guide.steps.find((entry) => entry.kind === 'check').clips, 2);
	assert.match(guide.intro, /clipboard/u);
	assert.match(guide.intro, /time/u);
});
