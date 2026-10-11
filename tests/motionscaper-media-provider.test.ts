/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { BufferSource, EncodedPacketSink, Input, ALL_FORMATS } from 'mediabunny';
import { motionRetainedVideoFixture, MOTION_RETAINED_VIDEO_FIXTURES, type MotionRetainedVideoFixture } from './browser/helpers/motionscaper-tracking-source.ts';
import { motionWavFixture } from './helpers/motion-media-fixture.ts';
import { prepareMotionMedia } from '../src/common/editor/motion-media-import.ts';
import { createMotionMediaProvider } from '../src/common/editor/motion-media-provider.ts';

test('retained PCM provider decodes exact bounded native windows across packet boundaries and reuses one source', async () => {
	const bytes = motionWavFixture(2); const imported = await prepareMotionMedia(new Blob([bytes]), { id: 'stereo', name: 'Stereo.wav' });
	if (imported.asset.kind !== 'audio') throw new Error('Audio fixture expected.');
	let loads = 0; const provider = createMotionMediaProvider({ loadAsset: () => { loads++; return Promise.resolve(bytes); } });
	try {
		assert.deepEqual(await provider.describe(imported.asset), { sampleRate: 48000, channels: 2, sampleCount: 4800 });
		for (const startSample of [2030, 0, 4750]) {
			const sampleCount = Math.min(64, 4800 - startSample);
			const result = await provider.read({ asset: imported.asset, startSample, sampleCount });
			assert.equal(result.length, sampleCount * 2);
			for (let index = 0; index < sampleCount; index++) {
				assert.equal(result[index * 2], ((startSample + index) % 127 - 63) / 128);
				assert.equal(result[index * 2 + 1], -((startSample + index) % 127 - 63) / 128 || 0);
			}
		}
		assert.equal(loads, 1);
		await assert.rejects(provider.read({ asset: imported.asset, startSample: 0, sampleCount: 4097 }), /window/u);
		await assert.rejects(provider.read({ asset: imported.asset, startSample: 4790, sampleCount: 11 }), /range/u);
	} finally { provider.dispose(); }
	await assert.rejects(provider.describe(imported.asset), /disposed/u);
});

test('retained media provider refuses altered bodies and cancels queued reads without publishing samples', async () => {
	const bytes = motionWavFixture(); const imported = await prepareMotionMedia(new Blob([bytes]), { id: 'audio', name: 'Audio.wav' });
	if (imported.asset.kind !== 'audio') throw new Error('Audio fixture expected.');
	const altered = new Uint8Array(bytes); altered[45] ^= 1;
	const corrupted = createMotionMediaProvider({ loadAsset: () => Promise.resolve(altered) });
	try { await assert.rejects(corrupted.describe(imported.asset), /digest/u); } finally { corrupted.dispose(); }
	const provider = createMotionMediaProvider({ loadAsset: () => new Promise<Uint8Array>(() => undefined) });
	const cancelled = new AbortController();
	const reading = provider.describe(imported.asset, cancelled.signal); cancelled.abort();
	await assert.rejects(reading, { name: 'AbortError' });
	const pending = provider.describe(imported.asset); provider.dispose(); await assert.rejects(pending, /disposed|abort/iu);
});

for (const name of Object.keys(MOTION_RETAINED_VIDEO_FIXTURES) as MotionRetainedVideoFixture[]) test(`retained ${name} codec fixture has authenticated bytes, native tracks and exact packet timing`, async () => {
	const metadata = MOTION_RETAINED_VIDEO_FIXTURES[name]; const bytes = motionRetainedVideoFixture(name);
	assert.equal(bytes.byteLength, metadata.byteLength); assert.equal(createHash('sha256').update(bytes).digest('hex'), metadata.sha256);
	const input = new Input({ source: new BufferSource(bytes), formats: ALL_FORMATS });
	try {
		const video = await input.getPrimaryVideoTrack(); assert.ok(video);
		assert.deepEqual([video.codec, video.displayWidth, video.displayHeight], [metadata.codec, metadata.width, metadata.height]);
		const timestamps: number[] = [];
		for await (const packet of new EncodedPacketSink(video).packets()) {
			assert.ok(packet.data.byteLength > 0); timestamps.push(packet.timestamp);
			// WebM's packet default duration retains nanoseconds; block PTS uses milliseconds.
			const expected = 1 / metadata.frameRate;
			assert.ok(Math.abs(packet.duration - expected) < 1e-9);
		}
		assert.equal(timestamps.length, metadata.frameCount);
		timestamps.forEach((timestamp, index) => assert.ok(Math.abs(timestamp - (metadata.format === 'webm'
			? Math.round(index * 1000 / metadata.frameRate) / 1000 : index / metadata.frameRate)) < 1e-9));
		const audio = await input.getPrimaryAudioTrack();
		if (metadata.audio) {
			assert.ok(audio); assert.deepEqual([audio.codec, audio.sampleRate, audio.numberOfChannels], ['opus', 48000, 2]);
			assert.equal((await audio.computePacketStats()).packetCount, metadata.audio.packetCount);
			assert.ok(await input.computeDuration() >= 1 && await input.computeDuration() < 1.04);
			assert.equal(metadata.audio.authoredSamples, 48000); assert.equal(metadata.audio.decodedSamples, 48648);
		} else { assert.equal(audio, null); assert.ok(Math.abs(await input.computeDuration() - metadata.frameCount / metadata.frameRate) < 1e-9); }
	} finally { input.dispose(); }
	bytes[0] ^= 1; assert.notEqual(createHash('sha256').update(bytes).digest('hex'), metadata.sha256);
	assert.equal(createHash('sha256').update(motionRetainedVideoFixture(name)).digest('hex'), metadata.sha256);
});
