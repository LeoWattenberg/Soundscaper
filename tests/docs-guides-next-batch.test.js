/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { GUIDE_FIXTURES } from '../handbook/guides/fixtures.mjs';
import { SOUNDSCAPER_GUIDE_GROUPS, SOUNDSCAPER_GUIDES } from '../handbook/guides/soundscaper.mjs';
import { describeStep } from '../handbook/guides/steps.mjs';
import { renderGuidePages } from '../scripts/lib/docs-reference/guides.mjs';

const ids = [
	'lift-a-passage-to-a-new-track', 'split-clips-at-silent-pauses', 'ungroup-linked-clips',
	'align-a-track-to-the-playhead', 'sort-tracks-by-name', 'move-a-track-to-the-top', 'view-a-track-as-a-spectrogram',
	'generate-a-rhythm-track', 'generate-a-risset-drum', 'generate-a-plucked-tone', 'measure-rms-level',
	'label-sounds-separated-by-silence', 'export-clips-as-an-archive', 'export-an-aiff',
	'remove-a-narrow-frequency-band', 'restore-clipped-peaks', 'compress-long-pauses',
	'normalize-to-an-rms-target', 'boost-a-selected-frequency-band', 'invert-polarity-for-cancellation',
];

const pages = renderGuidePages({ groups: SOUNDSCAPER_GUIDE_GROUPS, describeStep, fixture: (id) => GUIDE_FIXTURES[id] });
for (const id of ids) {
	test(`the new ${id} workflow is discoverable and describes the reader's material`, () => {
		const matches = SOUNDSCAPER_GUIDES.filter((guide) => guide.id === id);
		assert.equal(matches.length, 1);
		const group = SOUNDSCAPER_GUIDE_GROUPS.find(({ guides }) => guides.includes(matches[0]));
		const route = `/guides/${group.slug}/${id}/`;
		const page = pages.get(`${group.slug}/${id}.md`);
		assert.ok(page);
		assert.ok(pages.get('index.md').includes(`](${route})`));
		assert.ok(pages.get(`${group.slug}/index.md`).includes(`](${route})`));
		assert.doesNotMatch(page, /guide-[a-z-]+\.wav|music-loop|second-loop|this example/u);
	});
}
