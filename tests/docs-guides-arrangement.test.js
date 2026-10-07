/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { GUIDE_FIXTURES } from '../handbook/guides/fixtures.mjs';
import { SOUNDSCAPER_GUIDE_GROUPS, SOUNDSCAPER_GUIDES } from '../handbook/guides/soundscaper.mjs';
import { describeStep } from '../handbook/guides/steps.mjs';
import { renderGuidePages } from '../scripts/lib/docs-reference/guides.mjs';

const workflows = [
	{ id: 'split-a-passage-into-its-own-clip', command: '**Edit → Audio clips → Split**', clips: 3 },
	{ id: 'insert-a-copied-passage', command: '**Edit → Paste → Insert**', clips: 3 },
	{ id: 'align-track-starts-together', command: '**Tracks → Align content → Align together**', clips: 2 },
	{ id: 'move-clips-as-a-group', command: '**Edit → Audio clips → Group clips**', clips: 2 },
];

for (const { id, command, clips } of workflows) {
	test(`the ${id} guide publishes its command, checks its outcome and is discoverable`, () => {
		const guide = SOUNDSCAPER_GUIDES.find((entry) => entry.id === id);
		assert.ok(guide, `missing arrangement workflow: ${id}`);
		const pages = renderGuidePages({
			groups: SOUNDSCAPER_GUIDE_GROUPS,
			describeStep,
			fixture: (fixtureId) => GUIDE_FIXTURES[fixtureId],
		});
		const page = pages.get(`editing/${id}.md`);
		const route = `/guides/editing/${id}/`;
		assert.ok(page.includes(command), 'publish the menu path the replay drives');
		assert.ok(pages.get('editing/index.md').includes(`](${route})`));
		assert.ok(pages.get('index.md').includes(`](${route})`));
		assert.equal(guide.steps.at(-1).kind, 'check');
		assert.equal(guide.steps.at(-1).clips, clips);
		assert.doesNotMatch(page, /guide-[a-z-]+\.wav|quarter point|halfway point/u);
	});
}

test('inserting copies before positioning the cursor and never uses overlap paste', () => {
	const guide = SOUNDSCAPER_GUIDES.find((entry) => entry.id === 'insert-a-copied-passage');
	assert.ok(guide);
	const copy = guide.steps.findIndex((entry) => entry.kind === 'menu' && entry.path.at(-1) === 'Copy');
	const cursor = guide.steps.findIndex((entry) => entry.kind === 'cursor');
	const paste = guide.steps.findIndex((entry) => entry.kind === 'menu' && entry.path.join('/') === 'Edit/Paste/Insert');
	assert.ok(copy > 0 && cursor > copy && paste > cursor);
	assert.match(guide.intro, /later.*right/u);
});

test('together alignment documents the average start and checks both recordings', () => {
	const guide = SOUNDSCAPER_GUIDES.find((entry) => entry.id === 'align-track-starts-together');
	assert.ok(guide);
	assert.match(guide.intro, /average/u);
	assert.deepEqual(guide.steps.filter((entry) => entry.kind === 'check' && entry.startsAt).map((entry) => entry.startsAt.fixture), ['music-loop', 'second-loop']);
});

test('grouped movement checks that both recordings moved by the same amount', () => {
	const guide = SOUNDSCAPER_GUIDES.find((entry) => entry.id === 'move-clips-as-a-group');
	assert.ok(guide);
	const group = guide.steps.findIndex((entry) => entry.kind === 'menu' && entry.path.at(-1) === 'Group clips');
	const drag = guide.steps.findIndex((entry) => entry.kind === 'drag-clip');
	assert.ok(group > 0 && drag > group);
	assert.deepEqual(guide.steps.filter((entry) => entry.kind === 'check' && entry.startsAt).map((entry) => entry.startsAt.fixture), ['music-loop', 'second-loop']);
});
