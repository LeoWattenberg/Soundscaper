/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { GUIDE_FIXTURES } from '../handbook/guides/fixtures.mjs';
import { SOUNDSCAPER_GUIDE_GROUPS, SOUNDSCAPER_GUIDES } from '../handbook/guides/soundscaper.mjs';
import { describeStep, editingPreference, selectClips } from '../handbook/guides/steps.mjs';
import { renderGuidePages } from '../scripts/lib/docs-reference/guides.mjs';

const workflows = [
	{ id: 'join-split-clips', command: '**Edit → Audio clips → Join selected clips**', clips: 1 },
	{ id: 'delete-a-passage-and-leave-a-gap', command: '**Edit → Delete → Delete and leave gap**', clips: 2 },
	{ id: 'align-a-recording-to-zero', command: '**Tracks → Align content → Align start to zero**', clips: 1 },
];

for (const { id, command, clips } of workflows) {
	test(`the ${id} guide publishes a replayable editing workflow and its outcome`, () => {
		const guide = SOUNDSCAPER_GUIDES.find((entry) => entry.id === id);
		assert.ok(guide, `missing editing workflow: ${id}`);
		const pages = renderGuidePages({
			groups: SOUNDSCAPER_GUIDE_GROUPS,
			describeStep,
			fixture: (fixtureId) => GUIDE_FIXTURES[fixtureId],
		});
		const route = `/guides/editing/${id}/`;
		const page = pages.get(`editing/${id}.md`);
		assert.ok(page, 'the workflow needs a published how-to page');
		assert.ok(page.includes(command), 'the page must name the command the replay drives');
		assert.ok(pages.get('editing/index.md').includes(`](${route})`), 'readers can find it in the category');
		assert.ok(pages.get('index.md').includes(`](${route})`), 'readers can find it in the full index');
		assert.equal(guide.steps.at(-1).kind, 'check', 'the replay must verify the resulting edit');
		assert.equal(guide.steps.at(-1).clips, clips);
		assert.doesNotMatch(page, /guide-[a-z-]+\.wav|quarter point|halfway point/u, 'a how-to uses the reader’s recording');
	});
}

test('joining split clips selects both pieces of the same imported recording', () => {
	const guide = SOUNDSCAPER_GUIDES.find((entry) => entry.id === 'join-split-clips');
	const selection = guide.steps.find((entry) => entry.kind === 'select-clips');
	assert.ok(selection, 'joining needs an explicit clip selection');
	assert.deepEqual(selection.fixtures, ['music-loop', 'music-loop']);
	assert.deepEqual(selection.which, ['the first piece', 'the second piece']);
});

test('keyboard clip selection tells readers how to select the separate pieces', () => {
	const entry = selectClips(['music-loop', 'music-loop'], { which: ['the first piece', 'the second piece'], keyboard: true });
	assert.match(describeStep(entry, { fixture: (id) => GUIDE_FIXTURES[id], facet: 'howto' }), /focus the first piece.*\*\*Enter\*\*.*focus the second piece.*\*\*Shift\+Enter\*\*/u);
	assert.throws(() => selectClips(['music-loop'], { which: ['the clip'], keyboard: 'yes' }), TypeError);
});

test('joining disables automatic split fades through the documented Editing preference', () => {
	const entry = editingPreference({ label: 'Apply 2 ms fades to new clips', checked: false });
	assert.match(describeStep(entry, { fixture: () => null, facet: 'howto' }), /\*\*Edit → Preferences\*\*.*\*\*Editing\*\*.*turn off \*\*Apply 2 ms fades to new clips\*\*/u);
	assert.throws(() => editingPreference({ label: 'Fades', checked: 'no' }), TypeError);
	assert.throws(() => editingPreference({ label: '', checked: false }), TypeError);
	const guide = SOUNDSCAPER_GUIDES.find((entry) => entry.id === 'join-split-clips');
	const preference = guide.steps.findIndex((entry) => entry.kind === 'editing-preference');
	const split = guide.steps.findIndex((entry) => entry.kind === 'menu' && entry.path.at(-1) === 'Split');
	assert.ok(preference > 0 && preference < split, 'disable fades before splitting');
});
