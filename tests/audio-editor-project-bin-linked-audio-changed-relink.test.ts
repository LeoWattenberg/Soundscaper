/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	audioFile,
	changedAudioFile,
	createHarness,
	FIRST_LOCATOR,
} from './helpers/project-bin-audio-relink-harness.ts';

test('linked-audio relink classification distinguishes exact and changed content', async () => {
	const fixture = createHarness({ missing: false });

	assert.equal(
		await fixture.service.classifyLinkedAudioRelink('bin-audio', audioFile()),
		'exact-content',
	);
	assert.equal(
		await fixture.service.classifyLinkedAudioRelink('bin-audio', changedAudioFile()),
		'changed-content',
	);
	const sameSizeChanged = new File(
		[new Uint8Array(audioFile().size).fill(1)],
		'other.wav',
		{ type: 'audio/wav' },
	);
	assert.equal(sameSizeChanged.size, audioFile().size);
	assert.equal(
		await fixture.service.classifyLinkedAudioRelink('bin-audio', sameSizeChanged),
		'changed-content',
	);
	assert.deepEqual(fixture.order, ['binding', 'binding', 'binding']);
});

test('changed-content linked-audio relink requires explicit confirmation before side effects', async () => {
	const fixture = createHarness({ missing: false });

	await assert.rejects(
		fixture.service.relinkLinkedAudio('bin-audio', changedAudioFile(), FIRST_LOCATOR),
		/changed content.*requires explicit confirmation/iu,
	);

	assert.deepEqual(fixture.order, ['binding', 'release']);
	assert.deepEqual(fixture.releases, [{ kind: 'audio', ...FIRST_LOCATOR }]);
	assert.equal(fixture.publishCount, 0);
});

test('authorized changed-content linked-audio relink probes before quiescence and publishes its admission', async () => {
	const fixture = createHarness({ missing: false });
	const file = changedAudioFile();
	const projectBefore = JSON.stringify(fixture.project);

	assert.equal(await fixture.service.relinkLinkedAudio('bin-audio', file, FIRST_LOCATOR, {
		allowChangedContent: true,
	}), 'audio-source');

	assert.deepEqual(fixture.order, [
		'binding', 'probe', 'timeline', 'preview', 'retire', 'relink',
		'invalidate', 'metadata', 'activate', 'publish',
	]);
	assert.equal(fixture.relinks[0]?.options.admission, 'changed-content');
	assert.equal(fixture.relinks[0]?.options.expectedSnapshot, file);
	assert.deepEqual(fixture.releases, []);
	assert.equal(fixture.publishCount, 1);
	assert.equal(JSON.stringify(fixture.project), projectBefore);
});

test('failed changed-content audio probing releases the candidate before runtime side effects', async () => {
	const fixture = createHarness({
		missing: false,
		admitCandidate: async () => {
			throw new Error('The selected linked audio original does not match the source channel count.');
		},
	});

	await assert.rejects(
		fixture.service.relinkLinkedAudio('bin-audio', changedAudioFile(), FIRST_LOCATOR, {
			allowChangedContent: true,
		}),
		/channel count/iu,
	);

	assert.deepEqual(fixture.order, ['binding', 'probe', 'release']);
	assert.deepEqual(fixture.releases, [{ kind: 'audio', ...FIRST_LOCATOR }]);
	assert.equal(fixture.publishCount, 0);
});

test('linked-audio classification requires the exact UI project target', async () => {
	const fixture = createHarness({ missing: false });
	await assert.rejects(
		fixture.rawService.classifyLinkedAudioRelink('bin-audio', audioFile(), {
			projectId: 'project-duplicate',
			projectRevision: fixture.target.projectRevision,
		}),
		/project target changed/iu,
	);
	assert.deepEqual(fixture.order, []);
});
