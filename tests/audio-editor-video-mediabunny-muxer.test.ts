/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createVideoMediabunnyMuxer,
	type VideoMediabunnyMuxRequest,
} from '../src/common/editor/video-mediabunny-muxer.ts';

test('MP4 and WebM sessions receive their dedicated video/audio profiles and exact metadata', async () => {
	for (const profile of [
		{ format: 'mp4', videoCodec: 'h264', audioCodec: 'aac' },
		{ format: 'webm', videoCodec: 'vp9', audioCodec: 'opus' },
	] as const) {
		const record = sessionRecord();
		const muxer = createVideoMediabunnyMuxer({
			format: profile.format,
			videoCodec: profile.videoCodec,
			width: 4,
			height: 2,
			frameRate: { num: 30_000, den: 1_001 },
			frameCount: 1,
			audio: {
				codec: profile.audioCodec,
				sampleRate: 48_000,
				channelCount: 2,
				bitrate: 192_000,
			},
		}, { createSession: record.create });
		const metadata = (profile.format === 'mp4'
			? { decoderConfig: { codec: 'avc1.4d001f', description: Uint8Array.of(1, 2, 3) } }
			: { decoderConfig: { codec: 'vp09.00.10.08' } }) as EncodedVideoChunkMetadata;

		await muxer.start();
		await muxer.addVideoChunk(encodedChunk(), metadata);
		await muxer.addAudioPcm({
			data: new Uint8Array(960 * 2 * Float32Array.BYTES_PER_ELEMENT),
			frameCount: 960,
			timestamp: 0,
		});
		const result = await muxer.finalize();

		assert.equal(record.request?.format, profile.format);
		assert.equal(record.request?.videoCodec, profile.videoCodec);
		assert.equal(record.request?.audio?.codec, profile.audioCodec);
		assert.equal(record.video[0]?.metadata, metadata, 'decoder config is not reconstructed or discarded');
		assert.deepEqual(record.video[0]?.packet, {
			data: Uint8Array.of(9, 8, 7),
			type: 'key',
			timestamp: 0,
			duration: 0.033333,
			sequenceNumber: 0,
		});
		assert.equal(record.closedVideo, 1);
		assert.equal(record.closedAudio, 1);
		assert.equal(result.videoByteLength, 3);
		assert.equal(result.audioFrameCount, 960);
		assert.equal(result.decoderConfigObserved, true);
		assert.deepEqual([...result.bytes], [4, 5, 6]);
	}
});

test('the first MP4 packet must be a key frame carrying the browser decoder configuration', async () => {
	const record = sessionRecord();
	const request = {
		format: 'mp4',
		videoCodec: 'h264',
		width: 4,
		height: 2,
		frameRate: { num: 30, den: 1 },
		frameCount: 1,
	} as const;
	const withoutConfig = createVideoMediabunnyMuxer(request, { createSession: record.create });
	await withoutConfig.start();
	await assert.rejects(withoutConfig.addVideoChunk(encodedChunk()), /decoder configuration/u);
	await withoutConfig.cancel();
	assert.equal(record.canceled, 1);

	const deltaRecord = sessionRecord();
	const delta = createVideoMediabunnyMuxer(request, { createSession: deltaRecord.create });
	await delta.start();
	await assert.rejects(delta.addVideoChunk(encodedChunk('delta'), {
		decoderConfig: { codec: 'avc1.4d001f', description: Uint8Array.of(1) },
	}), /first.*key frame/u);
});

test('a browser chunk without duration uses the exact rational frame interval', async () => {
	const record = sessionRecord();
	const muxer = createVideoMediabunnyMuxer({
		format: 'webm',
		videoCodec: 'vp9',
		width: 4,
		height: 2,
		frameRate: { num: 30_000, den: 1_001 },
		frameCount: 1,
	}, { createSession: record.create });

	await muxer.start();
	await muxer.addVideoChunk({ ...encodedChunk(), duration: null });
	await muxer.finalize();

	const packet = record.video[0]?.packet as Readonly<{ duration?: unknown }> | undefined;
	assert.equal(packet?.duration, 0.033367);
});

function encodedChunk(type: 'key' | 'delta' = 'key') {
	return Object.freeze({
		byteLength: 3,
		type,
		timestamp: 0,
		duration: 33_333,
		copyTo(target: Uint8Array) { target.set([9, 8, 7]); },
	});
}

function sessionRecord() {
	const record = {
		request: null as VideoMediabunnyMuxRequest | null,
		video: [] as Readonly<{ packet: unknown; metadata?: EncodedVideoChunkMetadata }>[],
		audio: [] as unknown[],
		closedVideo: 0,
		closedAudio: 0,
		canceled: 0,
		create(request: VideoMediabunnyMuxRequest) {
			record.request = request;
			return {
				async start() {},
				async addVideo(packet: unknown, metadata?: EncodedVideoChunkMetadata) {
					(record.video as { packet: unknown; metadata?: EncodedVideoChunkMetadata }[]).push({
						packet,
						...(metadata ? { metadata } : {}),
					});
				},
				async addAudio(chunk: unknown) { (record.audio as unknown[]).push(chunk); },
				closeVideo() { record.closedVideo += 1; },
				closeAudio() { record.closedAudio += 1; },
				async finalize() { return Uint8Array.of(4, 5, 6).buffer; },
				async cancel() { record.canceled += 1; },
			};
		},
	};
	return record;
}
