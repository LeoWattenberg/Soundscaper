/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { CaptureStreamMetrics } from '../src/common/editor/framescaper-capture-domain.ts';
import {
	normalizeFramescaperCaptureSessionManifest,
	type FramescaperCaptureSessionManifestV1,
} from '../src/common/editor/framescaper-capture-session-manifest.ts';
import { FramescaperCaptureSessionManifestRepository } from '../src/common/editor/storage/framescaper-capture-session-manifest-repository.ts';
import {
	createFramescaperCaptureAssetStreams,
} from '../src/common/editor/controller/framescaper-capture-stream-timing.ts';

test('manifest timing requires one retained shared-origin range for every acknowledged stream', () => {
	const empty = manifest();
	assert.deepEqual(normalizeFramescaperCaptureSessionManifest(empty).streams[0]?.timing, {
		firstPresentationMicroseconds: null,
		lastPresentationEndMicroseconds: null,
	});
	assert.throws(() => normalizeFramescaperCaptureSessionManifest({
		...empty,
		streams: [{
			...empty.streams[0]!,
			storage: { ...empty.streams[0]!.storage, packetCount: 1, chunkCount: 1, byteLength: 1 },
		}],
	}), /presentation timing/iu);
	assert.throws(() => normalizeFramescaperCaptureSessionManifest({
		...empty,
		streams: [{
			...empty.streams[0]!,
			timing: { firstPresentationMicroseconds: 2_000, lastPresentationEndMicroseconds: 2_000 },
		}],
	}), /presentation timing/iu);
});

test('manifest CAS advances acknowledged timing with storage and freezes it after sealing', async () => {
	let stored: unknown = null;
	const repository = new FramescaperCaptureSessionManifestRepository({
		get: () => stored,
		putIfAbsent: (_key, value) => {
			if (stored !== null) return false;
			stored = value;
			return true;
		},
		replaceIfCurrent: (_key, expected, replacement) => {
			if (JSON.stringify(stored) !== JSON.stringify(expected)) return false;
			stored = replacement;
			return true;
		},
		deleteIfCurrent: () => false,
		listByPrefix: () => [],
	});
	const initial = await repository.create(manifest());
	const advanced = normalizeFramescaperCaptureSessionManifest({
		...initial,
		streams: [{
			...initial.streams[0]!,
			timing: { firstPresentationMicroseconds: 250_000, lastPresentationEndMicroseconds: 1_250_000 },
			storage: { ...initial.streams[0]!.storage, packetCount: 1, chunkCount: 1, byteLength: 1 },
		}],
		updatedAt: 2,
	});
	await repository.replace(initial, advanced);
	const timingOnly = normalizeFramescaperCaptureSessionManifest({
		...advanced,
		streams: [{
			...advanced.streams[0]!,
			timing: { ...advanced.streams[0]!.timing, lastPresentationEndMicroseconds: 1_500_000 },
		}],
		updatedAt: 3,
	});
	await assert.rejects(repository.replace(advanced, timingOnly), /timing.*storage|storage.*timing/iu);
	const sealed = normalizeFramescaperCaptureSessionManifest({ ...advanced, state: 'sealed', updatedAt: 3 });
	await repository.replace(advanced, sealed);
	const changedAfterSeal = normalizeFramescaperCaptureSessionManifest({
		...sealed,
		streams: [{
			...sealed.streams[0]!,
			timing: { ...sealed.streams[0]!.timing, lastPresentationEndMicroseconds: 1_500_000 },
		}],
		updatedAt: 4,
	});
	await assert.rejects(repository.replace(sealed, changedAfterSeal), /sealed.*timing|timing.*sealed/iu);
});

test('publication offsets come from each retained shared-origin presentation range', () => {
	const captured = normalizeFramescaperCaptureSessionManifest({
		...manifest(),
		state: 'sealed',
		streams: [
			stream('camera', 'camera-stream', 250_000, 1_250_000),
			stream('microphone', 'microphone-stream', 500_000, 1_500_000),
		],
	});
	const streams = createFramescaperCaptureAssetStreams(captured, [
		metric('camera-stream', 'camera'),
		metric('microphone-stream', 'microphone'),
	], 48_000);
	assert.deepEqual(streams.map(({ role, startOffsetFrames, presentationEndOffsetFrames, exactPresentationRange }) => ({
		role, startOffsetFrames, presentationEndOffsetFrames, exactPresentationRange,
	})), [
		{ role: 'camera', startOffsetFrames: 12_000, presentationEndOffsetFrames: 60_000,
			exactPresentationRange: '250000:1250000' },
		{ role: 'microphone', startOffsetFrames: 24_000, presentationEndOffsetFrames: 72_000,
			exactPresentationRange: '500000:1500000' },
	]);
});

test('publication does not retain numeric drift when aggregate metric confidence is unavailable', () => {
	const captured = normalizeFramescaperCaptureSessionManifest({
		...manifest(),
		state: 'sealed',
		streams: [stream('camera', 'camera-stream', 250_000, 1_250_000)],
	});
	const [asset] = createFramescaperCaptureAssetStreams(
		captured,
		[metric('camera-stream', 'camera')],
		48_000,
	);
	assert.deepEqual(asset?.metrics, {
		confidence: 'unavailable',
		droppedUnits: null,
		maximumAbsoluteDriftMicroseconds: null,
		finalDriftMicroseconds: null,
	});
});

function manifest(): FramescaperCaptureSessionManifestV1 {
	return {
		version: 1,
		sessionId: 'session-a',
		generation: 1,
		state: 'capturing',
		recoveryDecision: null,
		projectFence: { schemaFamily: 'framescaper' as const, schemaVersion: 1 as const, projectId: 'project-a', baseRevision: 1, baseSha256: 'a'.repeat(64) },
		origin: { sequenceId: 'sequence-a', playheadMicroseconds: 0, destination: 'both' },
		clock: { monotonicOriginMicroseconds: 10_000, pauseSpans: [] },
		streams: [{
			streamId: 'camera-stream', role: 'camera', required: true, playability: 'unknown',
			timing: { firstPresentationMicroseconds: null, lastPresentationEndMicroseconds: null },
			storage: {
				kind: 'encoded-media', spoolId: 'camera-spool', spoolToken: 'camera-token',
				sourceId: 'camera-source', mimeType: 'video/webm', packetCount: 0,
				chunkCount: 0, byteLength: 0,
			},
		}],
		createdAt: 1,
		updatedAt: 1,
	};
}

function stream(
	role: 'camera' | 'microphone',
	streamId: string,
	firstPresentationMicroseconds: number,
	lastPresentationEndMicroseconds: number,
): FramescaperCaptureSessionManifestV1['streams'][number] {
	const common = {
		streamId, role, required: true, playability: 'unknown' as const,
		timing: { firstPresentationMicroseconds, lastPresentationEndMicroseconds },
	};
	return role === 'camera' ? {
		...common,
		storage: {
			kind: 'encoded-media', spoolId: 'camera-spool', spoolToken: 'camera-token',
			sourceId: 'camera-source', mimeType: 'video/webm', packetCount: 1,
			chunkCount: 1, byteLength: 1,
		},
	} : {
		...common,
		storage: {
			kind: 'raw-pcm', spoolId: 'microphone-spool', spoolToken: 'microphone-token',
			sourceId: 'microphone-source', sampleRate: 48_000, channelCount: 1,
			frameCount: 48_000, chunkCount: 1,
		},
	};
}

function metric(streamId: string, role: 'camera' | 'microphone'): CaptureStreamMetrics {
	const dropped = role === 'camera'
		? { value: null, confidence: 'unavailable' as const }
		: { value: 0, confidence: 'exact' as const };
	return {
		streamId, role, packetCount: 1, capturedDurationUs: 1_000_000,
		droppedUnits: dropped,
		droppedRatio: dropped,
		currentDriftUs: { value: 0, confidence: 'estimated' as const },
		maximumAbsoluteDriftUs: { value: 0, confidence: 'estimated' as const },
	};
}
