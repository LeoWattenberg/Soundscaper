/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	VideoSourceUpgradeRefusedError,
	conformVideoSourceRange,
	planVideoSourceUpgrade,
} from '../src/common/editor/video-source-upgrade.ts';
import {
	createVideoTimingAssetPublication,
	decodeVideoTimingAsset,
} from '../src/common/editor/video-timing-asset.ts';
import {
	createUnreportedVideoSourceCharacteristics,
	normalizeVideoSourceCharacteristics,
	type VideoSourceCharacteristics,
} from '../src/common/editor/video-source-characteristics.ts';

const CONTENT_SHA256 = 'ab'.repeat(32);
const OTHER_SHA256 = 'cd'.repeat(32);
const FABRICATED_RATE = Object.freeze({ num: 30, den: 1 });
const EXACT_RATE = Object.freeze({ num: 24, den: 1 });

/** A real asset publication and its index, as ingest would produce them. */
function timing(frameCount: number, sourceSha256 = CONTENT_SHA256) {
	const publication = createVideoTimingAssetPublication(sourceSha256, {
		timescale: 24_000,
		presentationTicks: Array.from({ length: frameCount }, (_, index) => BigInt(index) * 1_000n),
		finalFrameDurationTicks: 1_000n,
	});
	return {
		reference: publication.reference,
		index: decodeVideoTimingAsset(publication.bytes),
	};
}

function probe(frameCount: number, characteristics: Record<string, unknown> | null = null, sourceSha256?: string) {
	const asset = timing(frameCount, sourceSha256);
	return {
		reference: asset.reference,
		probe: {
			decision: 'timing-asset' as const,
			backend: 'ffmpeg',
			nominalRate: EXACT_RATE,
			timing: asset.index,
			characteristics: characteristics
				? normalizeVideoSourceCharacteristics(characteristics, { rate: EXACT_RATE })
				: createUnreportedVideoSourceCharacteristics(),
		},
	};
}

/** A source imported when no timing probe was available: the rate is fabricated. */
function unprobedSource(overrides: Record<string, unknown> = {}) {
	return {
		kind: 'video',
		id: 'video-source-1',
		storageKey: 'video-source-1',
		name: 'phone.mp4',
		mimeType: 'video/mp4',
		contentSha256: CONTENT_SHA256,
		sampleFrameCount: 480_000,
		sampleRate: 48_000,
		width: 640,
		height: 360,
		frameRate: FABRICATED_RATE,
		sourceFrameCount: 300,
		timingAsset: null,
		timingDecision: {
			mode: 'conform-cfr-at-ingest',
			rate: FABRICATED_RATE,
			reason: 'timing-probe-unavailable',
			failures: [],
		},
		characteristics: createUnreportedVideoSourceCharacteristics(),
		videoCodec: 'unknown',
		audioCodec: 'unknown',
		hasAudio: true,
		...overrides,
	};
}

/** The plan carries a command payload, so its typed record is read back here. */
function reported(changes: Readonly<Record<string, unknown>>): VideoSourceCharacteristics {
	return changes.characteristics as VideoSourceCharacteristics;
}

function clip(id: string, sourceInFrame: number, sourceFrameCount: number, sourceId = 'video-source-1') {
	return { kind: 'video', id, sourceId, sourceInFrame, sourceFrameCount };
}

test('a never-probed source becomes exact and its edits conform in wall-clock', () => {
	const { probe: exact, reference } = probe(240, {
		backend: 'ffmpeg',
		codedWidth: 640,
		codedHeight: 360,
		rotationDegrees: 0,
		videoCodec: 'h264',
		audioStreams: [{ index: 1, codec: 'aac', channelCount: 2, sampleRate: 48_000, language: null }],
	});
	const plan = planVideoSourceUpgrade({
		source: unprobedSource(),
		probe: exact,
		timingAsset: reference,
		presented: { width: 640, height: 360 },
		clips: [
			// The whole source, and one second in for two seconds.
			clip('clip-whole', 0, 300),
			clip('clip-inner', 30, 60),
			clip('clip-other-source', 0, 300, 'video-source-2'),
		],
	});

	assert.equal(plan.upgraded, true);
	assert.deepEqual(plan.changes.frameRate, EXACT_RATE);
	assert.equal(plan.changes.sourceFrameCount, 240);
	assert.deepEqual(plan.changes.timingAsset, { ...reference });
	assert.deepEqual(plan.changes.timingDecision, {
		mode: 'exact',
		rate: EXACT_RATE,
		backend: 'ffmpeg',
	});
	assert.equal(plan.changes.videoCodec, 'h264');
	assert.equal(plan.changes.audioCodec, 'aac');
	// The inventory reports exactly one stream, so ingest's extraction is nameable.
	assert.equal(reported(plan.changes).extractedAudioStreamIndex, 1);
	assert.equal(reported(plan.changes).codedWidth, 640);
	// Ten seconds of media is 300 fabricated frames and 240 real ones; one second
	// in for two seconds is 24 frames in for 48.
	assert.deepEqual(plan.clips, [
		{ clipId: 'clip-whole', sourceInFrame: 0, sourceFrameCount: 240, clamped: false },
		{ clipId: 'clip-inner', sourceInFrame: 24, sourceFrameCount: 48, clamped: false },
	]);
	assert.deepEqual(plan.clampedClipIds, []);
});

test('media conformed at ingest keeps that provenance however exactly it re-probes', () => {
	const conformed = timing(300);
	const { probe: exact, reference } = probe(240);
	const plan = planVideoSourceUpgrade({
		source: unprobedSource({
			timingAsset: conformed.reference,
			timingDecision: { mode: 'conform-cfr-at-ingest', rate: FABRICATED_RATE, backend: 'ffmpeg' },
		}),
		probe: exact,
		timingAsset: reference,
	});
	assert.deepEqual(plan.changes.timingDecision, {
		mode: 'conform-cfr-at-ingest',
		rate: EXACT_RATE,
		backend: 'ffmpeg',
	});
});

test('an exact decision survives a re-probe as exact', () => {
	const previous = timing(240);
	const { probe: exact, reference } = probe(240);
	const plan = planVideoSourceUpgrade({
		source: unprobedSource({
			frameRate: EXACT_RATE,
			sourceFrameCount: 240,
			timingAsset: previous.reference,
			timingDecision: { mode: 'exact', rate: EXACT_RATE, backend: 'webcodecs' },
		}),
		probe: exact,
		timingAsset: reference,
	});
	assert.deepEqual(plan.changes.timingDecision, { mode: 'exact', rate: EXACT_RATE, backend: 'ffmpeg' });
});

test('a probe that cannot read exact timing is refused rather than believed', () => {
	const fallback = {
		decision: 'conform-cfr-at-ingest' as const,
		rate: FABRICATED_RATE,
		reason: 'timing-probe-unavailable' as const,
		failures: Object.freeze([]),
		characteristics: createUnreportedVideoSourceCharacteristics(),
	};
	assert.throws(() => planVideoSourceUpgrade({ source: unprobedSource(), probe: fallback }), (error: unknown) => {
		assert.ok(error instanceof VideoSourceUpgradeRefusedError);
		assert.equal(error.reason, 'probe-unavailable');
		return true;
	});
	assert.throws(() => planVideoSourceUpgrade({
		source: unprobedSource({
			frameRate: EXACT_RATE,
			sourceFrameCount: 240,
			timingAsset: timing(240).reference,
			timingDecision: { mode: 'exact', rate: EXACT_RATE, backend: 'ffmpeg' },
		}),
		probe: fallback,
	}), (error: unknown) => {
		assert.ok(error instanceof VideoSourceUpgradeRefusedError);
		assert.equal(error.reason, 'timing-regressed');
		return true;
	});
});

test('a timing asset the upgrade cannot bind to this source is refused', () => {
	const { probe: exact } = probe(240);
	assert.throws(() => planVideoSourceUpgrade({ source: unprobedSource(), probe: exact }), (error: unknown) => {
		assert.ok(error instanceof VideoSourceUpgradeRefusedError);
		assert.equal(error.reason, 'timing-asset-missing');
		return true;
	});
	const foreign = probe(240, null, OTHER_SHA256);
	assert.throws(() => planVideoSourceUpgrade({
		source: unprobedSource(),
		probe: foreign.probe,
		timingAsset: foreign.reference,
	}), (error: unknown) => {
		assert.ok(error instanceof VideoSourceUpgradeRefusedError);
		assert.equal(error.reason, 'timing-asset-mismatch');
		return true;
	});
	const shortAsset = probe(200);
	assert.throws(() => planVideoSourceUpgrade({
		source: unprobedSource(),
		probe: probe(240).probe,
		timingAsset: shortAsset.reference,
	}), (error: unknown) => {
		assert.ok(error instanceof VideoSourceUpgradeRefusedError);
		assert.equal(error.reason, 'timing-asset-mismatch');
		return true;
	});
});

test('a range the corrected media cannot hold is clamped and reported', () => {
	const { probe: exact, reference } = probe(200);
	const plan = planVideoSourceUpgrade({
		source: unprobedSource(),
		probe: exact,
		timingAsset: reference,
		clips: [clip('clip-whole', 0, 300), clip('clip-tail', 280, 20)],
	});
	assert.deepEqual(plan.clips, [
		{ clipId: 'clip-whole', sourceInFrame: 0, sourceFrameCount: 200, clamped: true },
		// 280 fabricated frames scale past the end of the corrected media, so the
		// clip keeps its last frame rather than collapsing.
		{ clipId: 'clip-tail', sourceInFrame: 199, sourceFrameCount: 1, clamped: true },
	]);
	assert.deepEqual(plan.clampedClipIds, ['clip-whole', 'clip-tail']);
});

test('a re-read that agrees with the document changes nothing', () => {
	const asset = timing(240);
	const characteristics = {
		backend: 'ffmpeg',
		codedWidth: 640,
		codedHeight: 360,
		rotationDegrees: 0,
		videoCodec: 'h264',
	};
	const source = unprobedSource({
		frameRate: EXACT_RATE,
		sourceFrameCount: 240,
		timingAsset: asset.reference,
		timingDecision: { mode: 'exact', rate: EXACT_RATE, backend: 'ffmpeg' },
		characteristics: normalizeVideoSourceCharacteristics(characteristics, { rate: EXACT_RATE }),
		videoCodec: 'h264',
		hasAudio: false,
		audioCodec: null,
	});
	const { probe: exact, reference } = probe(240, characteristics);
	const plan = planVideoSourceUpgrade({
		source,
		probe: exact,
		timingAsset: reference,
		presented: { width: 640, height: 360 },
		clips: [clip('clip-whole', 0, 240)],
	});
	assert.deepEqual(plan.changedFields, []);
	assert.deepEqual(plan.clips, []);
	assert.equal(plan.upgraded, false);
});

test('a corrected coded size and this engine\'s presented size both land', () => {
	// The older probe read autorotated frames, so a rotated source persisted its
	// presented size as its coded size; the document was also written by an
	// engine that does not apply the pixel aspect ratio.
	const source = unprobedSource({
		frameRate: EXACT_RATE,
		sourceFrameCount: 240,
		timingAsset: timing(240).reference,
		timingDecision: { mode: 'exact', rate: EXACT_RATE, backend: 'ffmpeg' },
		width: 24,
		height: 32,
		characteristics: normalizeVideoSourceCharacteristics({
			backend: 'ffmpeg',
			codedWidth: 24,
			codedHeight: 32,
			rotationDegrees: 270,
			pixelAspectRatio: { num: 2, den: 1 },
		}, { rate: EXACT_RATE }),
		hasAudio: false,
		audioCodec: null,
	});
	const { probe: exact, reference } = probe(240, {
		backend: 'ffmpeg',
		codedWidth: 32,
		codedHeight: 24,
		rotationDegrees: 270,
		pixelAspectRatio: { num: 2, den: 1 },
	});
	const plan = planVideoSourceUpgrade({
		source,
		probe: exact,
		timingAsset: reference,
		presented: { width: 24, height: 64 },
		clips: [clip('clip-whole', 0, 240)],
	});
	// The presented width already agreed; only the height this engine presents
	// and the coded size the older probe misread actually move.
	assert.deepEqual([...plan.changedFields].sort(), ['characteristics', 'height']);
	assert.equal(reported(plan.changes).codedWidth, 32);
	assert.equal(reported(plan.changes).codedHeight, 24);
	assert.equal(plan.changes.height, 64);
	// The rate did not move, so no edit had to.
	assert.deepEqual(plan.clips, []);
});

test('an audio program is only named when the inventory reports exactly one', () => {
	const streams = [
		{ index: 1, codec: 'aac', channelCount: 2, sampleRate: 48_000, language: 'en' },
		{ index: 2, codec: 'ac3', channelCount: 6, sampleRate: 48_000, language: 'de' },
	];
	const many = probe(240, { backend: 'ffmpeg', audioStreams: streams });
	const plan = planVideoSourceUpgrade({
		source: unprobedSource(),
		probe: many.probe,
		timingAsset: many.reference,
	});
	assert.equal(reported(plan.changes).extractedAudioStreamIndex, null);
	assert.equal(Object.hasOwn(plan.changes, 'audioCodec'), false);

	const silent = probe(240, { backend: 'ffmpeg', audioStreams: [streams[0]] });
	const silentPlan = planVideoSourceUpgrade({
		source: unprobedSource({ hasAudio: false, audioCodec: null }),
		probe: silent.probe,
		timingAsset: silent.reference,
	});
	assert.equal(reported(silentPlan.changes).extractedAudioStreamIndex, null);
	assert.equal(Object.hasOwn(silentPlan.changes, 'audioCodec'), false);
});

test('a source range conforms as an exact change of basis with a one-frame floor', () => {
	const rate = (num: number, den = 1) => Object.freeze({ num, den });
	assert.deepEqual(conformVideoSourceRange(0, 300, rate(30), rate(30), 300), {
		sourceInFrame: 0, sourceFrameCount: 300, clamped: false,
	});
	// 23.976 is not 24: an hour in scales exactly rather than through seconds,
	// and because both boundaries conform independently the extent may lose a
	// frame — which is the point of conforming boundaries and not durations.
	assert.deepEqual(conformVideoSourceRange(86_400, 240, rate(24), rate(24_000, 1_001), 90_000), {
		sourceInFrame: 86_314, sourceFrameCount: 239, clamped: false,
	});
	// The last fabricated frame lands on the last real one: it fits, so nothing
	// is clamped. A range that starts past the end keeps one frame and says so.
	assert.deepEqual(conformVideoSourceRange(299, 1, rate(30), rate(24), 240), {
		sourceInFrame: 239, sourceFrameCount: 1, clamped: false,
	});
	assert.deepEqual(conformVideoSourceRange(300, 30, rate(30), rate(24), 240), {
		sourceInFrame: 239, sourceFrameCount: 1, clamped: true,
	});
	assert.throws(() => conformVideoSourceRange(0, 0, rate(30), rate(24), 240), RangeError);
});
