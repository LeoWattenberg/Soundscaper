/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { videoTimingProbeMedia } from './browser/fixtures/video-timing-probe-media.js';
import { videoSourceGeometryMedia } from './browser/fixtures/video-source-geometry-media.js';
import {
	encodeVideoTimingAsset,
	decodeVideoTimingAsset,
} from '../src/common/editor/video-timing-asset.ts';
import {
	createContainerVideoTimingProbe,
	demuxVideoTiming,
	VideoTimingDemuxError,
} from '../src/common/editor/video-timing-demux.ts';
import { demuxMatroskaVideoTiming } from '../src/common/editor/video-timing-demux-matroska.ts';
import { createVideoTimingDemuxReader } from '../src/common/editor/video-timing-demux-reader.ts';
import { probeVideoTiming } from '../src/common/editor/video-timing-probe.ts';
import { normalizeVideoSourceCharacteristics } from '../src/common/editor/video-source-characteristics.ts';

const CFR = videoTimingProbeMedia.find(({ id }) => id === 'cfr-25fps-mp4-v1')!;
const VFR = videoTimingProbeMedia.find(({ id }) => id === 'vfr-irregular-webm-v1')!;

function blobFor(fixture: Readonly<{
	readonly file: Readonly<{ readonly buffer: Uint8Array; readonly mimeType: string }>;
}>): Blob {
	return new Blob([Uint8Array.from(fixture.file.buffer)], { type: fixture.file.mimeType });
}

test('the container demuxer reads the pinned CFR MP4 timing exactly', async () => {
	// These are the values the FFmpeg probe reports for the same file, because
	// both read the same integers out of the sample tables. The persisted timing
	// body must therefore hash to the same pinned digest whichever backend ran.
	const result = await demuxVideoTiming(blobFor(CFR));
	assert.equal(result.timescale, CFR.timescale);
	assert.deepEqual([...result.presentationTicks], [...CFR.presentationTicks]);
	assert.equal(result.finalFrameDurationTicks, CFR.finalFrameDurationTicks);
	assert.deepEqual({ ...result.nominalRate }, { ...CFR.nominalRate },
		'a constant-rate track has one coded rate, and 12800/512 is exactly 25/1');
	assert.deepEqual(result.characteristics, {
		backend: 'container',
		codedWidth: 32,
		codedHeight: 24,
		rotationDegrees: null,
		pixelAspectRatio: { num: 1, den: 1 },
		fieldOrder: null,
		hasAlpha: false,
		videoCodec: 'h264',
		colour: { primaries: null, transfer: null, matrix: null, range: null },
		audioStreams: null,
		extractedAudioStreamIndex: null,
		startTimecode: null,
	});

	const asset = encodeVideoTimingAsset(result);
	assert.equal(createHash('sha256').update(asset).digest('hex'), CFR.timingSha256);
	assert.equal(decodeVideoTimingAsset(asset).frameCount, CFR.presentationTicks.length);
});

test('the container demuxer reads the pinned irregular WebM timing exactly', async () => {
	// The blocks were written live, so the segment and its clusters declare no
	// size at all and the walk has to scan forward through them.
	const result = await demuxVideoTiming(blobFor(VFR));
	assert.equal(result.timescale, VFR.timescale);
	assert.deepEqual([...result.presentationTicks], [...VFR.presentationTicks]);
	assert.equal(result.finalFrameDurationTicks, VFR.finalFrameDurationTicks);

	const asset = encodeVideoTimingAsset(result);
	assert.equal(createHash('sha256').update(asset).digest('hex'), VFR.timingSha256,
		'the persisted timing body is the evidence, and it must not depend on the backend');

	// Variable-rate media has no coded rate to recover. The exact average across
	// the occupied presentation span is the browser-native nominal answer.
	assert.deepEqual({ ...result.nominalRate }, { ...VFR.nominalRate });
	assert.deepEqual(result.characteristics, {
		backend: 'container',
		codedWidth: 32,
		codedHeight: 24,
		rotationDegrees: null,
		pixelAspectRatio: { num: 1, den: 1 },
		fieldOrder: null,
		hasAlpha: true,
		videoCodec: 'vp8',
		colour: { primaries: null, transfer: null, matrix: null, range: null },
		audioStreams: null,
		extractedAudioStreamIndex: null,
		startTimecode: null,
	});
});

test('Matroska BlockDuration belongs to its enclosing block group and never leaks to simple blocks', async () => {
	const explicitLast = await demuxMatroskaVideoTiming(createVideoTimingDemuxReader(new Blob([
		matroskaTimingFixture([
			block(0, 'simple'),
			block(10, 'group', 7),
		]),
	])));
	assert.equal(explicitLast?.finalFrameDurationTicks, 7n,
		'a duration written after Block still belongs to that BlockGroup');

	const followedBySimpleBlocks = await demuxMatroskaVideoTiming(createVideoTimingDemuxReader(new Blob([
		matroskaTimingFixture([
			block(0, 'group', 7),
			block(10, 'simple'),
			block(20, 'simple'),
		]),
	])));
	assert.equal(followedBySimpleBlocks?.finalFrameDurationTicks, 10n,
		'a later SimpleBlock derives its own duration instead of inheriting the group duration');
});

test('the container demuxer reports coded geometry separately from rotation and sample aspect', async () => {
	for (const fixture of videoSourceGeometryMedia) {
		const result = await demuxVideoTiming(blobFor(fixture));
		const characteristics = normalizeVideoSourceCharacteristics(result.characteristics);
		assert.deepEqual({
			codedWidth: characteristics.codedWidth,
			codedHeight: characteristics.codedHeight,
			rotationDegrees: characteristics.rotationDegrees,
			pixelAspectRatio: characteristics.pixelAspectRatio,
			videoCodec: characteristics.videoCodec,
		}, {
			codedWidth: fixture.coded.width,
			codedHeight: fixture.coded.height,
			rotationDegrees: fixture.rotationDegrees,
			pixelAspectRatio: fixture.pixelAspectRatio,
			videoCodec: 'h264',
		}, fixture.id);
	}
});

test('the container demuxer refuses what it cannot read exactly', async () => {
	await assert.rejects(demuxVideoTiming(new Blob([new Uint8Array(64)])), VideoTimingDemuxError);
	await assert.rejects(
		demuxVideoTiming(new Blob([Uint8Array.from(CFR.file.buffer).subarray(0, 512)])),
		(error: unknown) => error instanceof Error,
		'a truncated index must fail rather than persist partial timing',
	);
	await assert.rejects(
		demuxVideoTiming(blobFor(CFR), { signal: AbortSignal.abort() }),
		(error: unknown) => (error as Error).name === 'AbortError',
	);
});

test('the container port alone resolves exact timing instead of conforming', async () => {
	// This is the state a desktop build is in: no decoder, so every codec-backed
	// probe refuses. Before the demuxer that left ingest with nothing to do but
	// conform the source to a constant rate — through an encoder it also lacks.
	const refusing = Object.freeze({
		id: 'ffmpeg',
		probe: () => Promise.reject(new Error('Desktop video operations are not admitted.')),
	});
	for (const fixture of [CFR, VFR]) {
		const decision = exactTiming(await probeVideoTiming(blobFor(fixture), {
			probes: [refusing, createContainerVideoTimingProbe()],
		}));
		assert.equal(decision.backend, 'container');
		assert.deepEqual(
			[...decision.timing.presentationTicks], [...fixture.presentationTicks],
		);
		assert.equal(decision.timing.finalFrameDurationTicks, fixture.finalFrameDurationTicks);
	}
});

test('the container port stays behind any codec-backed probe', async () => {
	// A build that has a decoder keeps answering with it: reading an original with
	// one backend and its proxy with another is how a pair that agrees in fact
	// comes to disagree on paper.
	const decided = Object.freeze({
		id: 'ffmpeg',
		probe: () => Promise.resolve({
			timescale: 24, presentationTicks: Object.freeze([0n, 1n]),
			finalFrameDurationTicks: 1n, nominalRate: Object.freeze({ num: 24, den: 1 }),
		}),
	});
	const decision = exactTiming(await probeVideoTiming(blobFor(CFR), {
		probes: [decided, createContainerVideoTimingProbe()],
	}));
	assert.equal(decision.backend, 'ffmpeg');
});

/** Assert an exact timing decision, and give the caller the narrowed one. */
function exactTiming(
	decision: Awaited<ReturnType<typeof probeVideoTiming>>,
): Extract<Awaited<ReturnType<typeof probeVideoTiming>>, { decision: 'timing-asset' }> {
	assert.equal(decision.decision, 'timing-asset');
	if (decision.decision !== 'timing-asset') throw new Error('unreachable');
	return decision;
}

function matroskaTimingFixture(blocks: readonly Uint8Array[]): Uint8Array {
	return bytes(
		element([0x16, 0x54, 0xae, 0x6b], element([0xae],
			element([0xd7], Uint8Array.of(1)),
			element([0x83], Uint8Array.of(1)),
		)),
		element([0x1f, 0x43, 0xb6, 0x75],
			element([0xe7], Uint8Array.of(0)),
			...blocks,
		),
	);
}

function block(timestamp: number, kind: 'simple' | 'group', duration = 0): Uint8Array {
	const payload = Uint8Array.of(0x81, timestamp >> 8 & 0xff, timestamp & 0xff, 0);
	if (kind === 'simple') return element([0xa3], payload);
	return element([0xa0], element([0xa1], payload), element([0x9b], Uint8Array.of(duration)));
}

function element(id: readonly number[], ...parts: readonly Uint8Array[]): Uint8Array {
	const payload = bytes(...parts);
	assert.ok(payload.byteLength < 127);
	return bytes(Uint8Array.from(id), Uint8Array.of(0x80 | payload.byteLength), payload);
}

function bytes(...parts: readonly Uint8Array[]): Uint8Array {
	const result = new Uint8Array(parts.reduce((length, part) => length + part.byteLength, 0));
	let offset = 0;
	for (const part of parts) { result.set(part, offset); offset += part.byteLength; }
	return result;
}
