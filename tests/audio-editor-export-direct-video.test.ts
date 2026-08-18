/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createEditorVideoExportAction } from '../src/common/editor/controller/video-export-service.ts';
import { PROJECT_FEATURE_CAPABILITY_IDS } from '../src/common/editor/project-feature-capabilities.ts';
import { PROJECT_FEATURE_VIDEO_RENDERED_FALLBACK_IDS } from '../src/common/editor/project-feature-video-rendered-fallback.ts';
import { CANONICAL_VIDEO_EXPORT_PLAN_VERSION } from '../src/common/editor/video-export-plan-version.ts';

type Format = 'mp4' | 'webm';

test('browser video export prepares early and streams exact MP4 and WebM outputs directly', async () => {
	for (const format of ['mp4', 'webm'] as const) {
		const fixture = createFixture({ format });
		const result = await fixture.exportVideo({ format: `video-${format}` });

		assert.deepEqual(result, {
			url: null,
			fileName: `Direct-video.${format}`,
			mimeType: `video/${format}`,
			size: 4,
			method: 'file-system-access',
		});
		assertOrder(fixture.events, ['plan', 'prepare', 'preflight', 'load', 'render-audio', 'encode-sink']);
		assertOrder(fixture.events, ['encode-sink', 'open:4:exact', 'write:2', 'write:2', 'seal', 'commit']);
		assert.equal(fixture.events.includes('encode-bytes'), false);
		assert.equal(fixture.events.includes('download'), false);
		assert.deepEqual(fixture.prepareRequests, [{
			purpose: 'video',
			suggestedName: `Direct-video.${format}`,
			mimeType: `video/${format}`,
			target: undefined,
			types: [{
				description: format === 'mp4' ? 'MP4 video' : 'WebM video',
				accept: { [`video/${format}`]: [`.${format}`] },
			}],
			useFileSystemAccess: true,
		}]);
	}
});

test('desktop video export selects its target only from sink open after FFmpeg stats output', async () => {
	const fixture = createFixture({ desktop: true });
	const result = await fixture.exportVideo();

	assert.equal(result?.method, 'desktop');
	assertOrder(fixture.events, ['plan', 'preflight', 'load', 'render-audio', 'encode-sink', 'prepare', 'open:4:exact']);
	assert.equal(fixture.events.filter((event) => event === 'prepare').length, 1);
	assert.equal(fixture.events.includes('download'), false);
});

test('desktop late chooser cancellation returns silently without publication', async () => {
	const cancellation = Object.freeze({ mode: 'cancelled', cancelled: true, fileName: 'Direct-video.mp4' });
	const fixture = createFixture({ desktop: true, prepared: cancellation });
	const result = await fixture.exportVideo();

	assert.strictEqual(result, cancellation);
	assertOrder(fixture.events, ['encode-sink', 'prepare']);
	assert.equal(fixture.events.includes('open:4:exact'), false);
	assert.equal(fixture.events.includes('download'), false);
	assert.equal(fixture.errors.length, 0);
});

test('browser early picker cancellation returns silently before any encode work', async () => {
	const cancellation = Object.freeze({ mode: 'cancelled', cancelled: true, fileName: 'Direct-video.mp4' });
	const fixture = createFixture({ prepared: cancellation });
	const result = await fixture.exportVideo();

	assert.strictEqual(result, cancellation);
	assert.equal(fixture.events.includes('encode-sink'), false);
	assert.equal(fixture.events.includes('encode-bytes'), false);
	assert.equal(fixture.events.includes('download'), false);
	assert.equal(fixture.errors.length, 0);
});

test('prepared Blob mode preserves legacy whole-byte video publication', async () => {
	const fixture = createFixture({ prepared: Object.freeze({ mode: 'blob' }) });
	const result = await fixture.exportVideo();

	assert.equal(result?.url, 'blob:legacy-video');
	assert.equal(result?.method, 'object-url');
	assertOrder(fixture.events, ['plan', 'prepare', 'load', 'render-audio', 'encode-bytes', 'download']);
	assert.equal(fixture.events.includes('encode-sink'), false);
	assert.equal(fixture.downloads.length, 1);
	assert.ok(fixture.downloads[0]?.blob instanceof Blob);
	assert.equal(fixture.downloads[0]?.blob.type, 'video/mp4');
});

test('direct video publication cleans prior output, closes before commit, and tolerates ownership loss during commit', async () => {
	const fixture = createFixture({
		priorOutput: true,
		onCommit() { fixture.state.disposed = true; },
	});
	const result = await fixture.exportVideo();

	assert.equal(result?.size, 4);
	assertOrder(fixture.events, ['seal', 'old-cleanup', 'commit']);
	assert.equal(fixture.state.exportOutput, null, 'late ownership loss cannot publish stale success state');
	assert.equal(fixture.statuses.some(([status]) => status === 'Done'), false);
	assert.equal(fixture.errors.length, 0);
});

test('direct video rejects plan drift and count disagreement with one rollback and no commit', async () => {
	const drift = createFixture({
		afterOpen(plan) { plan.mimeType = 'video/webm'; },
	});
	assert.equal(await drift.exportVideo(), null);
	assert.match((drift.errors[0] as Error).message, /plan changed/iu);
	assert.equal(drift.events.filter((event) => event === 'abort').length, 1);
	assert.equal(drift.events.includes('commit'), false);

	const counts = createFixture({ emittedByteLength: 3 });
	assert.equal(await counts.exportVideo(), null);
	assert.match((counts.errors[0] as Error).message, /byte count|byte length/iu);
	assert.equal(counts.events.filter((event) => event === 'abort').length, 1);
	assert.equal(counts.events.includes('commit'), false);
});

test('direct video declines stale, aliased, and underspecified plans before target preparation', async () => {
	for (const invalidPlan of ['legacy', 'alias', 'underspecified'] as const) {
		const fixture = createFixture({ invalidPlan });
		const result = await fixture.exportVideo();
		assert.equal(result?.method, 'object-url');
		assert.equal(fixture.events.includes('prepare'), false);
		assert.equal(fixture.events.includes('encode-sink'), false);
		assertOrder(fixture.events, ['plan', 'encode-bytes', 'download']);
	}
});

test('direct video write and close failures roll back once and aggregate cleanup failure', async () => {
	for (const failure of ['write', 'close'] as const) {
		const primary = new Error(`${failure} failed`);
		const fixture = createFixture({ [failure === 'write' ? 'writeFailure' : 'closeFailure']: primary });
		assert.equal(await fixture.exportVideo(), null);
		assert.strictEqual(fixture.errors[0], primary);
		assert.equal(fixture.events.filter((event) => event === 'abort').length, 1);
		assert.equal(fixture.events.includes('commit'), false);
		assert.equal(fixture.events.includes('download'), false);
	}

	const primary = new Error('write failed');
	const cleanup = new Error('abort failed');
	const aggregate = createFixture({ writeFailure: primary, abortFailure: cleanup });
	assert.equal(await aggregate.exportVideo(), null);
	assert.ok(aggregate.errors[0] instanceof AggregateError);
	assert.deepEqual((aggregate.errors[0] as AggregateError).errors, [primary, cleanup]);
	assert.equal(aggregate.events.filter((event) => event === 'abort').length, 1);
	assert.equal(aggregate.events.includes('commit'), false);
	assert.equal(aggregate.events.includes('download'), false);

	const synchronous = createFixture({
		writeFailure: primary, abortFailure: cleanup, abortSynchronously: true,
	});
	assert.equal(await synchronous.exportVideo(), null);
	assert.ok(synchronous.errors[0] instanceof AggregateError);
	assert.deepEqual((synchronous.errors[0] as AggregateError).errors, [primary, cleanup]);
	assert.equal(synchronous.events.filter((event) => event === 'abort').length, 1);
});

test('direct video commit failure rolls back the destination without stale publication', async () => {
	const primary = new Error('commit failed');
	const fixture = createFixture({ commitFailure: primary });
	assert.equal(await fixture.exportVideo(), null);
	assert.strictEqual(fixture.errors[0], primary);
	assertOrder(fixture.events, ['seal', 'commit', 'abort']);
	assert.equal(fixture.events.filter((event) => event === 'abort').length, 1);
	assert.equal(fixture.events.includes('download'), false);

	const cleanup = new Error('abort failed');
	const aggregate = createFixture({ commitFailure: primary, abortFailure: cleanup });
	assert.equal(await aggregate.exportVideo(), null);
	assert.ok(aggregate.errors[0] instanceof AggregateError);
	assert.deepEqual((aggregate.errors[0] as AggregateError).errors, [primary, cleanup]);
	assert.equal(aggregate.events.filter((event) => event === 'abort').length, 1);
	assert.equal(aggregate.events.includes('download'), false);
});

test('rendered-fallback integrity admission precedes direct target preparation and supplies verified media', async () => {
	const fixture = createFixture({ renderedFallback: true });
	const result = await fixture.exportVideo();

	assert.equal(result?.method, 'file-system-access');
	assertOrder(fixture.events, [
		'projection', 'integrity', 'integrity-current', 'integrity-blob', 'plan', 'prepare', 'encode-sink',
	]);
	assert.equal(fixture.events.includes('load'), false, 'the verified fallback body bypasses ordinary storage loading');
	assert.strictEqual(fixture.encodedVideoBlobs.get('fallback-video'), fixture.verifiedFallbackBlob);
});

interface FixtureOptions {
	readonly abortFailure?: Error;
	readonly abortSynchronously?: boolean;
	readonly afterOpen?: (plan: ReturnType<typeof videoPlan>) => void;
	readonly closeFailure?: Error;
	readonly commitFailure?: Error;
	readonly desktop?: boolean;
	readonly emittedByteLength?: number;
	readonly format?: Format;
	readonly invalidPlan?: 'legacy' | 'alias' | 'underspecified';
	readonly onCommit?: () => void;
	readonly prepared?: Readonly<Record<string, unknown>>;
	readonly priorOutput?: boolean;
	readonly renderedFallback?: boolean;
	readonly writeFailure?: Error;
}

function createFixture(options: FixtureOptions = {}) {
	const format = options.format ?? 'mp4';
	const events: string[] = [];
	const errors: unknown[] = [];
	const statuses: Array<[string, unknown]> = [];
	const prepareRequests: Array<Record<string, unknown>> = [];
	const downloads: Array<Record<string, unknown>> = [];
	const encodedVideoBlobs = new Map<string, Blob>();
	const verifiedFallbackBlob = new Blob([Uint8Array.of(7, 8, 9)], { type: 'video/mp4' });
	const ordinaryVideoBlob = new Blob([Uint8Array.of(1, 2, 3)], { type: 'video/mp4' });
	const canonical = project(false);
	const projected = project(true);
	const plan = videoPlan(format, options.renderedFallback ? 'fallback-video' : 'original-video');
	if (options.invalidPlan === 'legacy') plan.version = 5;
	if (options.invalidPlan === 'alias') {
		(plan as { format: string }).format = format === 'mp4' ? 'h264' : 'vp9';
	}
	if (options.invalidPlan === 'underspecified') plan.codecs.videoEncoder = '';
	const state = {
		exportGeneration: 0,
		exportAbort: null as null | Readonly<{ signal: AbortSignal; abort(): void }>,
		mobile: false,
		outputUrl: options.priorOutput ? 'blob:old-video' : null,
		outputCleanup: options.priorOutput ? async () => { events.push('old-cleanup'); } : null,
		exportOutput: null as unknown,
		disposed: false,
	};
	let activeController: AbortController | null = null;
	const prepared = options.prepared ?? preparedStream(events, options);
	const runtime = {
		abortError: () => Object.assign(new Error('aborted'), { name: 'AbortError' }),
		audioBufferChannels: (buffer: { channels: readonly Float32Array[] }) => buffer.channels,
		cloneProject: <Value>(value: Value): Value => structuredClone(value),
		copy: { localSourcesMissing: 'Local sources missing', rendering: 'Rendering', encoding: 'Encoding', done: 'Done' },
		createVideoExportPlan() { events.push('plan'); return plan; },
		encodeWav: () => Uint8Array.of(4, 5, 6),
		ffmpeg: {
			async encodeVideoToSink(
				videoBlobs: ReadonlyMap<string, Blob>,
				_audio: Blob | null,
				encodedPlan: ReturnType<typeof videoPlan>,
				sink: DirectSink,
				settings: Readonly<{ assertCurrent?: () => void }>,
			) {
				events.push('encode-sink');
				for (const [key, value] of videoBlobs) encodedVideoBlobs.set(key, value);
				try {
					settings.assertCurrent?.();
					await sink.open(4);
					options.afterOpen?.(encodedPlan);
					await sink.write(Uint8Array.of(9, 8));
					await sink.write(Uint8Array.of(7, 6));
					const output = await sink.close();
					return {
						output,
						byteLength: options.emittedByteLength ?? 4,
						chunkCount: 2,
						extension: `.${format}`,
						mimeType: `video/${format}`,
					};
				} catch (error) {
					try {
						await sink.abort(error);
					} catch (cleanupError) {
						throw new AggregateError(
							[error, cleanupError],
							'Video stream and destination cleanup both failed.',
						);
					}
					throw error;
				}
			},
			async encodeVideo() {
				events.push('encode-bytes');
				return { bytes: Uint8Array.of(9, 8, 7, 6), mimeType: `video/${format}` };
			},
		},
		fileService: {
			isDesktop: options.desktop === true,
			async prepareSave(request: Record<string, unknown>) {
				events.push('prepare');
				const { signal: _signal, ...captured } = request;
				prepareRequests.push(captured);
				return prepared;
			},
			async createDownload(request: Record<string, unknown>) {
				events.push('download');
				downloads.push(request);
				return { cancelled: false, url: 'blob:legacy-video', method: 'object-url' };
			},
		},
		findClip: (value: ReturnType<typeof project>, id: string) => value.clips.find((clip) => clip.id === id),
		findSource: (value: ReturnType<typeof project>, id: string) => value.sources.find((source) => source.id === id),
		getProject: () => canonical,
		handleError(error: unknown) { errors.push(error); },
		hasMissingTimelineSources: () => false,
		lifetime: {
			startTask() {
				activeController = new AbortController();
				return { signal: activeController.signal, assertCurrent() {}, finish() {} };
			},
			cancelTask() { activeController?.abort(); },
		},
		playbackProjects: options.renderedFallback ? {
			projectForVideoRenderedFallbackDelivery() {
				events.push('projection');
				return renderedFallbackProjection(projected);
			},
		} : undefined,
		preflightStorage() { events.push('preflight'); },
		projectGeneration: { capture: () => 'token', assertCurrent() {} },
		projectSampleRate: () => 48_000,
		publishDocumentSnapshot() {},
		setStatus(status: string, kind?: unknown) { statuses.push([status, kind]); },
		sourceBuffers: new Map(),
		state,
		store: {
			async loadMediaAsset() { events.push('load'); return ordinaryVideoBlob; },
		},
		throwIfAborted(signal?: AbortSignal) { if (signal?.aborted) throw signal.reason; },
		toggleExport() {},
		verifyProjectFallbackIntegrity: options.renderedFallback ? async () => {
			events.push('integrity');
			return {
				assertCurrent() { events.push('integrity-current'); },
				getVerifiedVideoBlob() { events.push('integrity-blob'); return verifiedFallbackBlob; },
			};
		} : undefined,
	};
	const renderSnapshot = async () => {
		events.push('render-audio');
		return { sampleRate: 48_000, channels: [Float32Array.of(0), Float32Array.of(0)] };
	};
	return {
		events, errors, statuses, prepareRequests, downloads, encodedVideoBlobs, verifiedFallbackBlob, state,
		exportVideo: createEditorVideoExportAction(runtime, renderSnapshot),
	};
}

interface DirectSink {
	open(exactByteLength: number): Promise<void>;
	write(chunk: Uint8Array): Promise<void>;
	close(): Promise<DirectSink>;
	abort(reason?: unknown): Promise<void>;
}

function preparedStream(events: string[], options: FixtureOptions) {
	let written = 0;
	return {
		mode: 'stream' as const,
		async createWritable(exactByteLength: number, sizeMode: string) {
			events.push(`open:${exactByteLength}:${sizeMode}`);
			return new WritableStream<Uint8Array>({
				write(chunk) {
					if (options.writeFailure) throw options.writeFailure;
					written += chunk.byteLength;
					events.push(`write:${chunk.byteLength}`);
				},
				close() {
					if (options.closeFailure) throw options.closeFailure;
					events.push('seal');
				},
			});
		},
		bytesWritten: () => written,
		async commit() {
			events.push('commit');
			options.onCommit?.();
			if (options.commitFailure) throw options.commitFailure;
			return { fileName: `Direct-video.${options.format ?? 'mp4'}`, method: options.desktop ? 'desktop' : 'file-system-access', size: written };
		},
		abort() {
			events.push('abort');
			if (options.abortFailure && options.abortSynchronously) throw options.abortFailure;
			return options.abortFailure ? Promise.reject(options.abortFailure) : Promise.resolve();
		},
	};
}


function videoPlan(format: Format, sourceId = 'original-video') {
	const mp4 = format === 'mp4';
	return {
		version: CANONICAL_VIDEO_EXPORT_PLAN_VERSION,
		format,
		container: format,
		extension: format,
		mimeType: `video/${format}`,
		durationSeconds: 1,
		outputFrameCount: 30,
		canvas: { width: 640, height: 360, frameRate: 30, fit: 'contain', pixelFormat: 'yuv420p' },
		codecs: {
			video: mp4 ? 'h264' : 'vp9',
			videoEncoder: mp4 ? 'libx264' : 'libvpx-vp9',
			audio: mp4 ? 'aac' : 'opus',
			audioEncoder: mp4 ? 'aac' : 'libopus',
			pixelFormat: 'yuv420p',
		},
		inputs: [
			{ kind: 'video-source', inputIndex: 0, sourceId, storageKey: `${sourceId}-storage`, mimeType: 'video/mp4' },
			{ kind: 'staged-audio-mix', inputIndex: 1, fileName: 'audio-mix.wav' },
		],
		filterPlan: { audio: { strategy: 'staged-mix', inputIndex: 1 } },
		range: { startFrame: 0, endFrame: 48_000, durationFrames: 48_000 },
	};
}

function project(fallback: boolean) {
	const videoId = fallback ? 'fallback-video' : 'original-video';
	const videoTrackId = fallback ? PROJECT_FEATURE_VIDEO_RENDERED_FALLBACK_IDS.track : 'video-track';
	const videoClipId = fallback ? PROJECT_FEATURE_VIDEO_RENDERED_FALLBACK_IDS.clip : 'video-clip';
	return {
		id: 'direct-video-project', title: 'Direct video', sampleRate: 48_000, masterChannels: 2,
		tracks: [
			{ id: videoTrackId, type: 'video', clipIds: [videoClipId] },
			{ id: 'audio-track', type: 'audio', clipIds: ['audio-clip'] },
		],
		clips: [
			{ id: videoClipId, kind: 'video', sourceId: videoId },
			{ id: 'audio-clip', kind: 'audio', sourceId: 'audio-source' },
		],
		sources: [
			{ id: 'original-video', storageKey: 'original-video-storage', opaqueExtensions: { byteLength: 3 } },
			{ id: 'fallback-video', storageKey: 'fallback-video-storage', opaqueExtensions: { byteLength: 3 } },
		],
	};
}

function renderedFallbackProjection(projected: ReturnType<typeof project>) {
	const item = {
		requirementId: 'video-render',
		featureId: PROJECT_FEATURE_CAPABILITY_IDS.videoEffects,
		displayName: 'Video effects',
		availability: 'unavailable',
		declaredDisposition: 'rendered-fallback',
		disposition: 'rendered-fallback',
		fallback: {
			role: 'project-video-render-v1', kind: 'video',
			sourceId: 'fallback-video', sha256: 'ab'.repeat(32),
		},
	};
	return {
		project: projected,
		featureRequirementsReport: {
			format: 'soundscaper-project', compatible: false,
			counts: { available: 0, unavailable: 1, unknown: 0 }, items: [item],
		},
		audioRenderedFallback: null,
		videoRenderedFallback: {
			schemaVersion: 1,
			role: 'project-video-render-v1',
			featureId: PROJECT_FEATURE_CAPABILITY_IDS.videoEffects,
			requirementId: 'video-render', sourceId: 'fallback-video',
			trackId: PROJECT_FEATURE_VIDEO_RENDERED_FALLBACK_IDS.track,
			clipId: PROJECT_FEATURE_VIDEO_RENDERED_FALLBACK_IDS.clip,
		},
		requiredAudioSourceIds: [],
		requiredVideoSourceIds: ['fallback-video'],
	};
}

function assertOrder(events: readonly string[], expected: readonly string[]): void {
	let cursor = -1;
	for (const event of expected) {
		const next = events.indexOf(event, cursor + 1);
		assert.notEqual(next, -1, `missing ordered event ${event} in ${events.join(', ')}`);
		cursor = next;
	}
}
