/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createEditorVideoExportAction } from '../src/common/editor/controller/video-export-service.ts';
import {
	mapVideoTimelineFrameToSource,
	registerVideoTimingIndex,
	unregisterVideoTimingIndex,
} from '../src/common/editor/video-source-time.ts';
import { createVideoTimingAssetPublication } from '../src/common/editor/video-timing-asset.ts';
import { CANONICAL_VIDEO_EXPORT_PLAN_VERSION } from '../src/common/editor/video-export-plan-version.ts';

const SOURCE_SHA256 = '91'.repeat(32);
const VIDEO_SOURCE_ID = 'exact-vfr-video';
const publication = createVideoTimingAssetPublication(SOURCE_SHA256, {
	timescale: 1_000,
	presentationTicks: [0n, 100n, 300n],
	finalFrameDurationTicks: 200n,
});
const mappedClip = Object.freeze({
	id: 'video-clip', kind: 'video', sourceId: VIDEO_SOURCE_ID,
	timelineStartFrame: 0, durationFrames: 1_000,
	sourceStartFrame: 0, sourceDurationFrames: 3,
	sourceInFrame: 0, sourceFrameCount: 3,
});

test('composed browser export releases verified timing when native encoding fails closed', async () => {
	const fixture = createFixture(blobFromBytes(publication.bytes), false);

	assert.equal(await fixture.exportVideo(), null);
	assert.deepEqual(fixture.events, ['timing-load', 'plan']);
	assert.equal(fixture.plannedSourceFrame, 1.75);
	assert.equal(mappedSourceFrame(fixture.source), 1.5, 'export releases its timing registration after planning');
	assert.match((fixture.errors[0] as Error).message, /only a keyed frame delivery/iu);
});

test('video export rejects corrupt exact timing before plan construction', async () => {
	const corrupt = new Uint8Array(publication.bytes);
	corrupt[corrupt.byteLength - 1] ^= 0xff;
	const fixture = createFixture(blobFromBytes(corrupt));

	assert.equal(await fixture.exportVideo(), null);
	assert.deepEqual(fixture.events, ['timing-load']);
	assert.equal(fixture.plannedSourceFrame, null);
	assert.match((fixture.errors[0] as Error).message, /video timing asset is corrupt/iu);
});

test('video export restores an independently registered preview timing index', async () => {
	const fixture = createFixture(blobFromBytes(publication.bytes), true);
	registerVideoTimingIndex(fixture.source, {
		timescale: 1_000,
		frameCount: 3,
		presentationTicks: [0n, 250n, 400n],
		finalFrameDurationTicks: 200n,
		endTicks: 600n,
	});
	try {
		assert.equal(await fixture.exportVideo().then((result) => result?.cancelled), true);
		assert.strictEqual(fixture.deliveryReport, fixture.previousDeliveryReport,
			'a dismissed destination must preserve the last completed delivery report');
		assert.equal(fixture.plannedSourceFrame, 1.75, 'the verified export timing owns planning');
		assert.equal(mappedSourceFrame(fixture.source), 4 / 3, 'the preview timing is restored afterward');
	} finally {
		unregisterVideoTimingIndex(fixture.source);
	}
});

function createFixture(timingBlob: Blob, desktop = false) {
	const events: string[] = [];
	const errors: unknown[] = [];
	let plannedSourceFrame: number | null = null;
	let activeController: AbortController | null = null;
	const source = Object.freeze({
		id: VIDEO_SOURCE_ID,
		kind: 'video',
		storageKey: 'video-storage',
		contentSha256: SOURCE_SHA256,
		timingAsset: publication.reference,
	});
	const project = Object.freeze({
		id: 'exact-timing-export',
		title: 'Exact timing export',
		sampleRate: 1_000,
		tracks: Object.freeze([Object.freeze({
			id: 'video-track', type: 'video', hidden: false, clipIds: Object.freeze([mappedClip.id]),
		})]),
		clips: Object.freeze([mappedClip]),
		sources: Object.freeze([source]),
	});
	const previousDeliveryReport = Object.freeze({ id: 'previous-delivery-report' });
	const state = {
		exportGeneration: 0,
		exportAbort: null as null | Readonly<{ signal: AbortSignal; abort(): void }>,
		outputUrl: null,
		outputCleanup: null,
		exportOutput: null,
		disposed: false,
		deliveryReport: previousDeliveryReport,
	};
	const runtime = {
		abortError: () => new DOMException('Cancelled', 'AbortError'),
		audioBufferChannels: () => Object.freeze([]),
		cloneProject: <Value>(value: Value): Value => structuredClone(value),
		copy: {
			localSourcesMissing: 'Local sources missing', rendering: 'Rendering', encoding: 'Encoding', done: 'Done',
		},
		createVideoExportPlan() {
			events.push('plan');
			plannedSourceFrame = mappedSourceFrame(source);
			return videoPlan();
		},
		encodeWav: () => new Uint8Array(),
		ffmpeg: {
			async encodeVideoToSink(
				_videoBlobs: unknown, _audioMix: unknown, _plan: unknown,
				sink: Readonly<{ open(byteLength: number): Promise<void> }>,
			) {
				await sink.open(4);
				throw new Error('The cancelled desktop destination must stop encoding.');
			},
		},
		fileService: {
			isDesktop: desktop,
			getDesktopVideoExportCapabilities: () => Object.freeze({
				schemaVersion: 1,
				formats: Object.freeze({
					mp4: Object.freeze({ available: true, provider: 'external-ffmpeg', reason: null }),
					webm: Object.freeze({ available: true, provider: 'external-ffmpeg', reason: null }),
				}),
			}),
			prepareSave() {
				events.push('prepare');
				return Object.freeze({ mode: 'cancelled', cancelled: true });
			},
		},
		findClip: (value: typeof project, id: string) => value.clips.find((clip) => clip.id === id),
		findSource: (value: typeof project, id: string) => value.sources.find((candidate) => candidate.id === id),
		getProject: () => project,
		handleError(error: unknown) { errors.push(error); },
		hasMissingTimelineSources: () => false,
		lifetime: {
			startTask() {
				activeController = new AbortController();
				return Object.freeze({ signal: activeController.signal, assertCurrent() {}, finish() {} });
			},
			cancelTask() { activeController?.abort(); },
		},
		preflightStorage() {},
		projectGeneration: { capture: () => project.id, assertCurrent() {} },
		projectSampleRate: () => project.sampleRate,
		publishDocumentSnapshot() {},
		setStatus() {},
		sourceBuffers: new Map(),
		state,
		store: {
			async loadMediaAsset(storageKey: string) {
				if (storageKey === 'video-storage') {
					events.push('video-load');
					return new Blob([Uint8Array.of(1)], { type: 'video/mp4' });
				}
				assert.equal(storageKey, publication.reference.storageKey);
				events.push('timing-load');
				return timingBlob;
			},
		},
		throwIfAborted(signal?: AbortSignal) { if (signal?.aborted) throw signal.reason; },
		toggleExport() {},
	};
	return {
		events,
		errors,
		source,
		get plannedSourceFrame() { return plannedSourceFrame; },
		get deliveryReport() { return state.deliveryReport; },
		previousDeliveryReport,
		exportVideo: createEditorVideoExportAction(runtime, async () => Object.freeze({
			sampleRate: project.sampleRate, channels: Object.freeze([]),
		})),
	};
}

function mappedSourceFrame(source: unknown): number {
	return mapVideoTimelineFrameToSource(mappedClip, 500, { source }).sourceFrame;
}

function blobFromBytes(bytes: Uint8Array): Blob {
	const buffer = new ArrayBuffer(bytes.byteLength);
	new Uint8Array(buffer).set(bytes);
	return new Blob([buffer]);
}

function videoPlan() {
	return {
		version: CANONICAL_VIDEO_EXPORT_PLAN_VERSION,
		format: 'mp4',
		container: 'mp4',
		extension: 'mp4',
		mimeType: 'video/mp4',
		quality: 'balanced',
		durationSeconds: 1,
		outputFrameCount: 30,
		canvas: { width: 640, height: 360, frameRate: 30, fit: 'contain', pixelFormat: 'yuv420p' },
		codecs: {
			video: 'h264', videoEncoder: 'libx264', audio: null, audioEncoder: null, pixelFormat: 'yuv420p',
		},
		inputs: [{ kind: 'video-source', inputIndex: 0, sourceId: VIDEO_SOURCE_ID, storageKey: 'video-storage' }],
		filterPlan: { audio: { strategy: 'none' } },
		range: { startFrame: 0, endFrame: 1_000, durationFrames: 1_000 },
	};
}
