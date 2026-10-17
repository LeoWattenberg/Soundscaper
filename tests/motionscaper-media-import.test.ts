/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { prepareMotionMedia } from '../src/common/editor/motion-media-import.ts';

import { motionWavFixture as wav } from './helpers/motion-media-fixture.ts';

test('Motionscaper imports retained audio from actual content with exact native duration and digest', async () => {
	const bytes = wav(); const body = new Blob([bytes], { type: 'video/mp4' });
	const imported = await prepareMotionMedia(body, { id: 'sound', name: 'Sound.wav' });
	assert.equal(imported.asset.kind, 'audio');
	assert.equal(imported.asset.sha256, createHash('sha256').update(bytes).digest('hex'));
	if (imported.asset.kind !== 'audio') return;
	assert.deepEqual(imported.asset.duration, { num: 1, den: 10 });
	assert.equal(imported.asset.sampleRate, 48000); assert.equal(imported.asset.channels, 1);
	assert.deepEqual(new Uint8Array(await imported.body.arrayBuffer()), bytes);
});

test('Motionscaper media admission refuses excessive files, undecodable data and undeclared multichannel layouts', async () => {
	const huge = new Blob([new Uint8Array(64 * 1024 * 1024 + 1)]);
	await assert.rejects(prepareMotionMedia(huge, { id: 'huge', name: 'Huge' }), /64 MiB/u);
	await assert.rejects(prepareMotionMedia(new Blob(['not media']), { id: 'bad', name: 'Bad' }));
	await assert.rejects(prepareMotionMedia(new Blob([wav(3)]), { id: 'surround', name: 'Surround' }), /mono or stereo/u);
	const controller = new AbortController(); controller.abort();
	await assert.rejects(prepareMotionMedia(new Blob([wav()]), { id: 'cancelled', name: 'Cancelled', signal: controller.signal }), { name: 'AbortError' });
});
