/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	FRAMESCAPER_CAPTURE_MAXIMUM_FILMSTRIP_THUMBNAILS,
	createFramescaperCaptureDerivativeScheduler,
	type FramescaperCaptureDerivativeProject,
	type FramescaperCaptureDerivativeSchedulerOptions,
	type FramescaperCapturedVideoProxyRequest,
	type FramescaperCaptureVideoDerivativeInput,
	type FramescaperCaptureVideoFrameCaptureOptions,
} from '../src/common/editor/controller/framescaper-capture-derivative-scheduler.ts';
import type {
	FramescaperCaptureDerivativeRequest,
} from '../src/common/editor/controller/framescaper-capture-canonical-publication.ts';
import type {
	FramescaperCapturePublicationPlan,
} from '../src/common/editor/controller/framescaper-capture-publication-plan.ts';

interface FixtureOptions {
	readonly audioActivationFailure?: boolean;
	readonly captureFailures?: readonly number[];
	readonly disposeFailure?: boolean;
	readonly proxy?: 'absent' | 'success' | 'failure';
	readonly saveFailures?: readonly number[];
	readonly videoActivationFailure?: boolean;
}

function createFixture(options: FixtureOptions = {}) {
	const calls: string[] = [];
	const captures: Array<Readonly<{
		timestamp: number;
		options: FramescaperCaptureVideoFrameCaptureOptions;
	}>> = [];
	const saved: Array<Readonly<{
		sourceId: string;
		derivative: FramescaperCaptureVideoDerivativeInput;
	}>> = [];
	const audio = Object.freeze({
		kind: 'audio' as const,
		id: 'microphone-source',
		storageKey: 'microphone-storage',
		name: 'Microphone capture',
	});
	const video = Object.freeze({
		kind: 'video' as const,
		id: 'camera-source',
		storageKey: 'camera-storage',
		name: 'Camera capture',
		characteristics: Object.freeze({ hasAlpha: true }),
		contentSha256: 'ca'.repeat(32),
	});
	const project: FramescaperCaptureDerivativeProject = Object.freeze({
		id: 'origin-project',
		revision: 7,
		sources: Object.freeze([audio, video]),
	});
	const media = new Blob([Uint8Array.of(1, 2, 3)], { type: 'video/webm' });
	const request = derivativeRequest();
	const schedulerOptions: FramescaperCaptureDerivativeSchedulerOptions = {
		getOriginProject(projectId) {
			calls.push(`get-origin:${projectId}`);
			return project;
		},
		store: {
			getSourceMetadata(storageKey) {
				calls.push(`metadata:${storageKey}`);
				return storageKey === audio.storageKey
					? Object.freeze({ sourceId: audio.storageKey, frameCount: 48_000 })
					: null;
			},
			loadMediaAsset(storageKey) {
				calls.push(`media:${storageKey}`);
				return storageKey === video.storageKey ? media : null;
			},
			saveVideoDerivative(sourceId, derivative) {
				calls.push(`save:${derivative.type}:${derivative.timestamp}`);
				if (options.saveFailures?.includes(derivative.timestamp)) {
					throw new Error(`save ${derivative.timestamp} failed`);
				}
				saved.push({ sourceId, derivative });
			},
		},
		activateStoredSource(source, metadata, activationOptions) {
			assert.deepEqual(activationOptions, { requireChunkStream: true });
			calls.push(`activate:${source.id}:${String((metadata as { sourceId?: unknown }).sourceId)}`);
			if (options.audioActivationFailure) throw new Error('audio activation failed');
		},
		activateVideoSource(source) {
			calls.push(`activate-video:${source.id}`);
			if (options.videoActivationFailure) throw new Error('video activation failed');
		},
		createVideoFrameExtractor(blob) {
			assert.equal(blob, media, 'the retained Blob is passed through without rebuilding it');
			calls.push('extractor:create');
			return {
				metadata: Object.freeze({ durationSeconds: 12, width: 1_920, height: 1_080 }),
				capture(timestamp, captureOptions = {}) {
					calls.push(`capture:${timestamp}`);
					captures.push({ timestamp, options: captureOptions });
					if (options.captureFailures?.includes(timestamp)) {
						throw new Error(`capture ${timestamp} failed`);
					}
					return Object.freeze({
						timestampSeconds: timestamp,
						width: captureOptions.maximumWidth ?? 320,
						height: captureOptions.maximumHeight ?? 180,
						mimeType: 'image/webp',
						blob: new Blob([Uint8Array.of(timestamp)], { type: 'image/webp' }),
					});
				},
				dispose() {
					calls.push('extractor:dispose');
					if (options.disposeFailure) throw new Error('dispose failed');
				},
			};
		},
		videoThumbnailTimes(durationSeconds, thumbnailOptions) {
			calls.push(`times:${durationSeconds}:${thumbnailOptions.maximum}`);
			return Object.freeze([1, 6, 11]);
		},
		...(options.proxy === 'absent' ? {} : {
			scheduleProxy(proxyRequest: FramescaperCapturedVideoProxyRequest) {
				calls.push(`proxy:${proxyRequest.sessionId}:${proxyRequest.sourceId}:${String(proxyRequest.expectedProjectRevision)}:${proxyRequest.expectedContentSha256}`);
				if (options.proxy === 'failure') throw new Error('proxy failed');
			},
		}),
	};
	return {
		audio,
		calls,
		captures,
		request,
		saved,
		schedule: createFramescaperCaptureDerivativeScheduler(schedulerOptions),
		video,
	};
}

test('capture derivatives activate audio peaks and create retained-video poster and filmstrip records', async () => {
	const fixture = createFixture({ proxy: 'success' });

	await fixture.schedule(fixture.request);

	assert.deepEqual(fixture.calls, [
		'get-origin:origin-project',
		'metadata:microphone-storage',
		'activate:microphone-source:microphone-storage',
		'media:camera-storage',
		'extractor:create',
		'capture:0',
		'save:poster:0',
		`times:12:${FRAMESCAPER_CAPTURE_MAXIMUM_FILMSTRIP_THUMBNAILS}`,
		'capture:1',
		'save:thumbnail:1',
		'capture:6',
		'save:thumbnail:6',
		'capture:11',
		'save:thumbnail:11',
		'extractor:dispose',
		'activate-video:camera-source',
		`proxy:capture-session:camera-source:7:${'ca'.repeat(32)}`,
	]);
	assert.equal(fixture.saved.length, 4);
	assert.deepEqual(fixture.saved.map(({ sourceId, derivative }) => ({
		sourceId,
		timestamp: derivative.timestamp,
		type: derivative.type,
	})), [
		{ sourceId: 'camera-storage', timestamp: 0, type: 'poster' },
		{ sourceId: 'camera-storage', timestamp: 1, type: 'thumbnail' },
		{ sourceId: 'camera-storage', timestamp: 6, type: 'thumbnail' },
		{ sourceId: 'camera-storage', timestamp: 11, type: 'thumbnail' },
	]);
	assert.deepEqual(fixture.captures[0], {
		timestamp: 0,
		options: { maximumWidth: 640, maximumHeight: 360, alpha: true },
	});
	assert.deepEqual(fixture.captures.slice(1).map(({ options }) => options), [
		{ alpha: true }, { alpha: true }, { alpha: true },
	]);
});

test('one failed filmstrip thumbnail save is aggregated after later thumbnails and cleanup complete', async () => {
	const fixture = createFixture({ proxy: 'absent', saveFailures: [6] });

	await assert.rejects(fixture.schedule(fixture.request), (error: unknown) => {
		assert.ok(error instanceof AggregateError);
		assert.equal(error.errors.length, 1);
		assert.match(error.message, /capture derivatives completed with failures/iu);
		assert.match(String(error.errors[0]), /camera-source thumbnail at 6 seconds/iu);
		return true;
	});

	assert.deepEqual(fixture.saved.map(({ derivative }) => derivative.timestamp), [0, 1, 11]);
	assert.equal(fixture.calls.filter((call) => call === 'extractor:dispose').length, 1);
});

test('audio and proxy failures do not prevent video derivatives and are reported together at the end', async () => {
	const fixture = createFixture({ audioActivationFailure: true, proxy: 'failure' });

	await assert.rejects(fixture.schedule(fixture.request), (error: unknown) => {
		assert.ok(error instanceof AggregateError);
		assert.equal(error.errors.length, 2);
		assert.match(String(error.errors[0]), /microphone-source waveform/iu);
		assert.match(String(error.errors[1]), /camera-source proxy scheduling/iu);
		return true;
	});

	assert.equal(fixture.saved.length, 4, 'video work survives an audio derivative failure');
	assert.match(fixture.calls.at(-1) ?? '', /^proxy:capture-session:camera-source:/u);
});

test('proxy scheduling runs once for every captured video and never for audio', async () => {
	const fixture = createFixture({ proxy: 'absent' });
	const scheduled: FramescaperCapturedVideoProxyRequest[] = [];
	const secondVideo = Object.freeze({
		...fixture.video,
		id: 'display-source',
		storageKey: 'display-storage',
		contentSha256: 'db'.repeat(32),
	});
	const request = Object.freeze({
		...fixture.request,
		sourceIds: Object.freeze([
			...fixture.request.sourceIds,
			secondVideo.id,
		]),
		plan: Object.freeze({
			...fixture.request.plan,
			entries: Object.freeze([
				...fixture.request.plan.entries,
				publicationEntry('display-stream', 'display', secondVideo.id),
			]),
		}),
	});
	const schedule = createFramescaperCaptureDerivativeScheduler({
		getOriginProject: () => Object.freeze({
			id: 'origin-project',
			revision: 7,
			sources: Object.freeze([fixture.audio, fixture.video, secondVideo]),
		}),
		store: {
			getSourceMetadata: () => Object.freeze({ sourceId: fixture.audio.storageKey }),
			loadMediaAsset: () => new Blob([Uint8Array.of(1)], { type: 'video/webm' }),
			saveVideoDerivative: () => undefined,
		},
		activateStoredSource: () => undefined,
		createVideoFrameExtractor: () => ({
			metadata: Object.freeze({ durationSeconds: 1, width: 16, height: 16 }),
			capture: (timestampSeconds) => Object.freeze({
				timestampSeconds,
				width: 16,
				height: 16,
				mimeType: 'image/webp',
				blob: new Blob([Uint8Array.of(1)], { type: 'image/webp' }),
			}),
			dispose: () => undefined,
		}),
		videoThumbnailTimes: () => Object.freeze([]),
		scheduleProxy: (value) => { scheduled.push(value); },
	});

	await schedule(request);

	assert.deepEqual(scheduled, [
		{
			projectId: 'origin-project', sessionId: 'capture-session', sourceId: 'camera-source',
			expectedProjectRevision: 7, expectedContentSha256: 'ca'.repeat(32),
		},
		{
			projectId: 'origin-project', sessionId: 'capture-session', sourceId: 'display-source',
			expectedProjectRevision: 7, expectedContentSha256: 'db'.repeat(32),
		},
	]);
});

test('the optional proxy seam is not required', async () => {
	const fixture = createFixture({ proxy: 'absent' });

	await fixture.schedule(fixture.request);

	assert.equal(fixture.calls.some((call) => call.startsWith('proxy:')), false);
});

test('active video refresh failure is aggregated after derivative persistence', async () => {
	const fixture = createFixture({ proxy: 'absent', videoActivationFailure: true });

	await assert.rejects(fixture.schedule(fixture.request), (error: unknown) => {
		assert.ok(error instanceof AggregateError);
		assert.equal(error.errors.length, 1);
		assert.match(String(error.errors[0]), /camera-source video activation/iu);
		return true;
	});
	assert.equal(fixture.saved.length, 4);
});

test('a failing poster and failing cleanup each report once while filmstrip work continues', async () => {
	const fixture = createFixture({ captureFailures: [0], disposeFailure: true, proxy: 'absent' });

	await assert.rejects(fixture.schedule(fixture.request), (error: unknown) => {
		assert.ok(error instanceof AggregateError);
		assert.equal(error.errors.length, 2);
		assert.match(String(error.errors[0]), /camera-source poster/iu);
		assert.match(String(error.errors[1]), /camera-source extractor cleanup/iu);
		return true;
	});

	assert.deepEqual(fixture.saved.map(({ derivative }) => derivative.timestamp), [1, 6, 11]);
	assert.equal(fixture.calls.filter((call) => call === 'extractor:dispose').length, 1);
});

function derivativeRequest(): FramescaperCaptureDerivativeRequest {
	const entries = Object.freeze([
		publicationEntry('microphone-stream', 'microphone', 'microphone-source'),
		publicationEntry('camera-stream', 'camera', 'camera-source'),
	]);
	const plan: FramescaperCapturePublicationPlan = Object.freeze({
		destination: 'both',
		command: Object.freeze({ type: 'batch', commands: Object.freeze([]) }),
		entries,
	});
	return Object.freeze({
		projectId: 'origin-project',
		sessionId: 'capture-session',
		sourceIds: Object.freeze(entries.map(({ sourceId }) => sourceId)),
		plan,
	});
}

function publicationEntry(
	streamId: string,
	role: 'microphone' | 'camera' | 'display',
	sourceId: string,
) {
	return Object.freeze({
		streamId,
		role,
		sourceId,
		binItemId: null,
		binClipId: null,
		trackId: null,
		trackIndex: null,
		timelineClipId: null,
		groupId: null,
		laneGroupId: null,
		avLinkId: null,
	});
}
