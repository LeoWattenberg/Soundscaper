/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { GUIDE_FIXTURES } from '../handbook/guides/fixtures.mjs';
import { describeStep, validateGuide } from '../handbook/guides/steps.mjs';
import { EDITING_WORKFLOW_GUIDES, TRACK_WORKFLOW_GUIDES } from '../handbook/guides/soundscaper/editing-and-track-workflows.mjs';

const workflows = [
	...EDITING_WORKFLOW_GUIDES,
	...TRACK_WORKFLOW_GUIDES,
];

for (const guide of workflows) {
	test(`${guide.id} has a replayable recipe and an observable outcome`, () => {
		assert.doesNotThrow(() => validateGuide(guide, GUIDE_FIXTURES));
		assert.equal(guide.steps[0].kind, 'open');
		assert.equal(guide.steps.at(-1).kind, 'check');
		assert.ok(guide.tips.length >= 2);
		const prose = guide.steps.map((entry) => describeStep(entry, { fixture: (id) => GUIDE_FIXTURES[id] })).join('\n');
		assert.match(prose, /\*\*/u);
		assert.doesNotMatch(prose, /guide-[a-z-]+\.wav|quarter point|halfway point/u);
	});
}

test('lifting a selected passage leaves the source edges and creates a second track', () => {
	const guide = workflows.find(({ id }) => id === 'lift-a-passage-to-a-new-track');
	assert.ok(guide);
	assert.deepEqual(guide.steps.find(({ kind }) => kind === 'select-range'), { kind: 'select-range', from: 0.25, to: 0.75, where: 'the passage you want to move onto its own track', why: null, see: null });
	assert.deepEqual(guide.steps.at(-1).clips, 3);
	assert.equal(guide.steps.at(-1).tracks, null, 'the browser verifier checks clip-bearing tracks without counting the default empty track');
});

test('silent-pause splitting uses the gapped take and checks all four phrases', () => {
	const guide = workflows.find(({ id }) => id === 'split-clips-at-silent-pauses');
	assert.ok(guide);
	assert.ok(guide.steps.some((entry) => entry.kind === 'import' && entry.fixture === 'gapped-take'));
	assert.equal(guide.steps.at(-1).clips, 4);
	assert.ok(guide.steps.some((entry) => entry.kind === 'menu' && entry.path.join('/') === 'Edit/Audio clips/Split clips at silences'));
	assert.equal(guide.audacity, 'Edit → Audio Clips → Detach at Silences (Audacity 3)');
});

test('the ungrouping recipe groups selected pieces first and keeps them separate afterward', () => {
	const guide = workflows.find(({ id }) => id === 'ungroup-linked-clips');
	assert.ok(guide);
	const paths = guide.steps.filter(({ kind }) => kind === 'menu').map(({ path }) => path.join('/'));
	assert.ok(paths.indexOf('Edit/Audio clips/Group clips') < paths.indexOf('Edit/Audio clips/Ungroup clips'));
	assert.equal(guide.steps.at(-1).clips, 2);
});

test('playhead alignment checks the precise moved start', () => {
	const guide = workflows.find(({ id }) => id === 'align-a-track-to-the-playhead');
	assert.ok(guide);
	assert.ok(guide.steps.some((entry) => entry.kind === 'menu' && entry.path.join('/') === 'Tracks/Align content/Align start to playhead'));
	assert.deepEqual(guide.steps.at(-1).startsAt, { fixture: 'music-loop', seconds: 2 });
});

test('track recipes use catalog commands and meaningful state checks', () => {
	const sort = workflows.find(({ id }) => id === 'sort-tracks-by-name');
	const move = workflows.find(({ id }) => id === 'move-a-track-to-the-top');
	const view = workflows.find(({ id }) => id === 'view-a-track-as-a-spectrogram');
	assert.ok(sort && move && view);
	assert.ok(sort.steps.some((entry) => entry.kind === 'menu' && entry.path.join('/') === 'Tracks/Sort tracks/Sort by name'));
	assert.ok(move.steps.some((entry) => entry.kind === 'track-menu' && entry.path.join('/') === 'Move track/Move track to top'));
	assert.ok(move.tips.some((tip) => tip.includes('**Move track → Move track down**')));
	assert.ok(view.steps.some((entry) => entry.kind === 'track-menu' && entry.path.join('/') === 'Track visualization/Spectrogram'));
});
