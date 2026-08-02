/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createEditorExportService,
	type ExportServiceRuntime,
} from '../src/common/editor/controller/export-service.ts';
import { projectForVideoRenderedFallbackExport } from '../src/common/editor/controller/video-rendered-fallback-export.ts';
import { PROJECT_FEATURE_CAPABILITY_IDS } from '../src/common/editor/project-feature-capabilities.ts';
import type { ProjectVideoFallbackIntegritySelector } from '../src/common/editor/project-fallback-integrity.ts';

interface ExportProject extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly title: string;
	readonly sampleRate: number;
	readonly masterChannels: number;
	readonly tracks: readonly ExportTrack[];
	readonly clips: readonly ExportClip[];
	readonly sources: readonly ExportSource[];
}

interface ExportTrack {
	readonly id: string;
	readonly type: string;
	readonly hidden?: boolean;
	readonly clipIds: readonly string[];
}

interface ExportClip {
	readonly id: string;
	readonly kind: string;
	readonly sourceId: string;
}

interface ExportSource {
	readonly id: string;
	readonly storageKey: string;
	readonly opaqueExtensions?: Readonly<{ byteLength?: number }>;
}

interface ExportFixtureOptions {
	readonly fallback?: boolean;
	readonly outputCleanup?: () => Promise<void> | void;
	readonly verify?: (
		project: ExportProject,
		store: unknown,
		options: Readonly<{
			signal?: AbortSignal;
			videoFallback?: ProjectVideoFallbackIntegritySelector;
		}>,
	) => PromiseLike<Readonly<{
		assertCurrent(project: unknown): void;
		getVerifiedVideoBlob(selector: ProjectVideoFallbackIntegritySelector): Blob;
	}>> | Readonly<{
		assertCurrent(project: unknown): void;
		getVerifiedVideoBlob(selector: ProjectVideoFallbackIntegritySelector): Blob;
	}>;
}

const ORIGINAL_VIDEO_SOURCE_ID = 'original-video';
const FALLBACK_VIDEO_SOURCE_ID = 'fallback-video';
const AUDIO_SOURCE_ID = 'canonical-audio';
const FALLBACK_FEATURE_ID = PROJECT_FEATURE_CAPABILITY_IDS.videoCompositing;

function canonicalProject(): ExportProject {
	return Object.freeze({
		schemaVersion: 9,
		id: 'video-fallback-export',
		title: 'Fallback delivery',
		sampleRate: 48_000,
		masterChannels: 2,
		tracks: Object.freeze([
			Object.freeze({ id: 'video-track', type: 'video', clipIds: Object.freeze(['original-video-clip']) }),
			Object.freeze({ id: 'audio-track', type: 'audio', clipIds: Object.freeze(['audio-clip']) }),
		]),
		clips: Object.freeze([
			Object.freeze({ id: 'original-video-clip', kind: 'video', sourceId: ORIGINAL_VIDEO_SOURCE_ID }),
			Object.freeze({ id: 'audio-clip', kind: 'audio', sourceId: AUDIO_SOURCE_ID }),
		]),
		sources: Object.freeze([
			Object.freeze({
				id: ORIGINAL_VIDEO_SOURCE_ID,
				storageKey: 'original-video-storage',
				opaqueExtensions: Object.freeze({ byteLength: 4_096 }),
			}),
			Object.freeze({
				id: FALLBACK_VIDEO_SOURCE_ID,
				storageKey: 'fallback-video-storage',
				opaqueExtensions: Object.freeze({ byteLength: 2_048 }),
			}),
			Object.freeze({ id: AUDIO_SOURCE_ID, storageKey: 'canonical-audio-storage' }),
		]),
	});
}

function projectedProject(canonical: ExportProject): ExportProject {
	return Object.freeze({
		...canonical,
		tracks: Object.freeze([
			Object.freeze({ id: 'fallback-video-track', type: 'video', clipIds: Object.freeze(['fallback-video-clip']) }),
			canonical.tracks[1]!,
		]),
		clips: Object.freeze([
			Object.freeze({ id: 'fallback-video-clip', kind: 'video', sourceId: FALLBACK_VIDEO_SOURCE_ID }),
			canonical.clips[1]!,
		]),
	});
}

function fallbackReport() {
	return Object.freeze({
		schemaVersion: 1 as const,
		format: 'soundscaper-project' as const,
		compatible: false,
		counts: Object.freeze({ available: 0, unavailable: 1, unknown: 0 }),
		items: Object.freeze([Object.freeze({
			requirementId: 'publisher-video-render',
			featureId: FALLBACK_FEATURE_ID,
			displayName: 'Video compositing render',
			availability: 'unavailable' as const,
			declaredDisposition: 'rendered-fallback' as const,
			disposition: 'rendered-fallback' as const,
			fallback: Object.freeze({
				kind: 'video' as const,
				sourceId: FALLBACK_VIDEO_SOURCE_ID,
				sha256: 'ab'.repeat(32),
			}),
			message: 'Video compositing is unavailable and will use the rendered fallback.',
		})]),
	});
}

function createFixture(options: ExportFixtureOptions = {}) {
	const canonical = canonicalProject();
	const projected = projectedProject(canonical);
	const events: string[] = [];
	const errors: unknown[] = [];
	const loadedStorageKeys: string[] = [];
	const plannedProjects: ExportProject[] = [];
	const encodedPlans: unknown[] = [];
	const downloads: unknown[] = [];
	let activeController: AbortController | null = null;
	const verifiedFallbackBlob = new Blob([Uint8Array.of(7, 8, 9)]);
	const state = {
		exportGeneration: 0,
		exportAbort: null as null | Readonly<{ signal: AbortSignal; abort(): void }>,
		mobile: false,
		outputUrl: null,
		outputCleanup: options.outputCleanup ?? null,
		exportOutput: null,
		disposed: false,
	};
	const fallback = options.fallback !== false;
	const verify = options.verify ?? ((project: ExportProject, _store: unknown, verifyOptions: Readonly<{
		videoFallback?: ProjectVideoFallbackIntegritySelector;
	}>) => {
		events.push('integrity');
		assert.strictEqual(project, canonical);
		assert.deepEqual(verifyOptions.videoFallback, {
			requirementId: 'publisher-video-render',
			featureId: FALLBACK_FEATURE_ID,
			kind: 'video',
			sourceId: FALLBACK_VIDEO_SOURCE_ID,
			sha256: 'ab'.repeat(32),
		});
		return Object.freeze({
			assertCurrent(candidate: unknown) {
				events.push('integrity-current');
				assert.strictEqual(candidate, canonical);
			},
			getVerifiedVideoBlob(selector: ProjectVideoFallbackIntegritySelector) {
				events.push('integrity-blob');
				assert.deepEqual(selector, verifyOptions.videoFallback);
				return verifiedFallbackBlob;
			},
		});
	});
	const runtime: ExportServiceRuntime = {
		abortError: () => Object.assign(new Error('cancelled'), { name: 'AbortError' }),
		audioBufferChannels: (buffer: Readonly<{ channels: readonly Float32Array[] }>) => buffer.channels,
		cloneProject: <Project>(project: Project): Project => structuredClone(project),
		copy: {
			localSourcesMissing: 'Local sources missing.',
			rendering: 'Rendering',
			encoding: 'Encoding',
			done: 'Done',
		},
		createVideoExportPlan: (project: ExportProject) => {
			events.push('plan');
			plannedProjects.push(project);
			assert.equal(project.clips[0]?.sourceId, fallback ? FALLBACK_VIDEO_SOURCE_ID : ORIGINAL_VIDEO_SOURCE_ID);
			const sourceId = project.clips[0]!.sourceId;
			const source = project.sources.find((candidate) => candidate.id === sourceId)!;
			return Object.freeze({
				inputs: Object.freeze([Object.freeze({
					kind: 'video-source', sourceId, storageKey: source.storageKey,
				})]),
				range: Object.freeze({ startFrame: 0, endFrame: 4, durationFrames: 4 }),
				extension: 'mp4',
			});
		},
		encodeWav: () => Uint8Array.of(1, 2, 3),
		ffmpeg: {
			dispose() { events.push('ffmpeg-dispose'); },
			async encodeVideo(videoBlobs: ReadonlyMap<string, Blob>, audioMix: Blob | null, plan: unknown) {
				events.push('encode-video');
				assert.deepEqual([...videoBlobs.keys()], [
					fallback ? FALLBACK_VIDEO_SOURCE_ID : ORIGINAL_VIDEO_SOURCE_ID,
				]);
				if (fallback) assert.strictEqual(videoBlobs.get(FALLBACK_VIDEO_SOURCE_ID), verifiedFallbackBlob);
				assert.ok(audioMix);
				encodedPlans.push(plan);
				return Object.freeze({ bytes: Uint8Array.of(9), mimeType: 'video/mp4' });
			},
		},
		fileService: {
			async createDownload(request: unknown) {
				events.push('download');
				downloads.push(request);
				return Object.freeze({ cancelled: false, url: 'blob:export', method: 'memory' });
			},
		},
		findClip: (project: ExportProject, clipId: string) => project.clips.find((clip) => clip.id === clipId),
		findSource: (project: ExportProject, sourceId: string) => project.sources.find((source) => source.id === sourceId),
		getProject: () => canonical,
		handleError(error: unknown) { errors.push(error); },
		hasMissingTimelineSources(project: ExportProject) {
			events.push('missing-sources');
			assert.equal(project.clips[0]?.sourceId, fallback ? FALLBACK_VIDEO_SOURCE_ID : ORIGINAL_VIDEO_SOURCE_ID);
			return false;
		},
		lifetime: {
			startTask() {
				activeController = new AbortController();
				return Object.freeze({
					signal: activeController.signal,
					assertCurrent() { events.push('task-current'); },
					finish() { events.push('task-finish'); },
				});
			},
			cancelTask() { activeController?.abort(Object.assign(new Error('cancelled'), { name: 'AbortError' })); },
		},
		options: {
			async renderSnapshot(project: ExportProject) {
				events.push('render-audio');
				assert.equal(project.clips.some((clip) => clip.sourceId === AUDIO_SOURCE_ID), true);
				assert.equal(project.clips.some((clip) => clip.sourceId === FALLBACK_VIDEO_SOURCE_ID), fallback);
				return Object.freeze({
					sampleRate: 48_000,
					channels: Object.freeze([Float32Array.of(0), Float32Array.of(0)]),
				});
			},
		},
		playbackProjects: {
			projectForVideoRenderedFallbackDelivery(project: ExportProject) {
				events.push('projection');
				assert.strictEqual(project, canonical);
				return Object.freeze({
					project: fallback ? projected : canonical,
					featureRequirementsReport: fallback ? fallbackReport() : null,
					videoRenderedFallback: fallback ? Object.freeze({
						schemaVersion: 1,
						featureId: FALLBACK_FEATURE_ID,
						requirementId: 'publisher-video-render',
						sourceId: FALLBACK_VIDEO_SOURCE_ID,
						trackId: 'fallback-video-track',
						clipId: 'fallback-video-clip',
					}) : null,
					requiredVideoSourceIds: Object.freeze(fallback ? [FALLBACK_VIDEO_SOURCE_ID] : []),
				});
			},
		},
		preflightStorage() { events.push('preflight'); },
		projectGeneration: {
			capture: () => 'project-token',
			assertCurrent() { events.push('project-current'); },
		},
		projectSampleRate: () => 48_000,
		publishDocumentSnapshot() { events.push('publish'); },
		setStatus() {},
		sourceBuffers: new Map([[AUDIO_SOURCE_ID, Object.freeze({})]]),
		state,
		store: {
			async loadMediaAsset(storageKey: string) {
				events.push(`load:${storageKey}`);
				loadedStorageKeys.push(storageKey);
				return new Blob([Uint8Array.of(1, 2, 3)]);
			},
		},
		taskProgress: {
			begin: () => Object.freeze({ setPhase: () => true, finish: () => true }),
		},
		throwIfAborted(signal?: AbortSignal) {
			if (signal?.aborted) throw signal.reason;
		},
		toggleExport() {},
		verifyProjectFallbackIntegrity: verify,
	};
	return Object.freeze({
		canonical,
		downloads,
		encodedPlans,
		errors,
		events,
		loadedStorageKeys,
		plannedProjects,
		runtime,
		verifiedFallbackBlob,
	});
}

test('video export verifies and uses only the rendered fallback while retaining canonical audio', async () => {
	const fixture = createFixture();
	const before = structuredClone(fixture.canonical);
	const result = await createEditorExportService(fixture.runtime).exportVideo();

	assert.equal(result?.mimeType, 'video/mp4');
	assert.deepEqual(fixture.canonical, before);
	assert.deepEqual(fixture.loadedStorageKeys, []);
	assert.equal(fixture.plannedProjects.length, 1);
	assert.equal(fixture.encodedPlans.length, 1);
	assert.equal(fixture.downloads.length, 1);
	assert.ok(fixture.events.indexOf('integrity-current') < fixture.events.indexOf('plan'));
	assert.ok(fixture.events.indexOf('integrity-blob') < fixture.events.indexOf('plan'));
	assert.ok(fixture.events.indexOf('render-audio') < fixture.events.indexOf('encode-video'));
});

test('video fallback integrity refusal happens before planning, body loading, encoding, or publication', async () => {
	const fixture = createFixture({
		verify() { throw new Error('rendered fallback digest mismatch'); },
	});
	const result = await createEditorExportService(fixture.runtime).exportVideo();

	assert.equal(result, null);
	assert.match((fixture.errors[0] as Error).message, /digest mismatch/iu);
	assert.deepEqual(fixture.loadedStorageKeys, []);
	assert.deepEqual(fixture.plannedProjects, []);
	assert.deepEqual(fixture.encodedPlans, []);
	assert.deepEqual(fixture.downloads, []);
});

test('video fallback verification cancellation cannot start late delivery work', async () => {
	let verificationStarted: (() => void) | null = null;
	const started = new Promise<void>((resolve) => { verificationStarted = resolve; });
	const fixture = createFixture({
		verify(_project, _store, { signal }) {
			verificationStarted?.();
			return new Promise((_, reject) => {
				signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
			});
		},
	});
	const service = createEditorExportService(fixture.runtime);
	const pending = service.exportVideo();
	await started;
	await service.handleExportAction('cancel');
	assert.equal(await pending, null);

	assert.deepEqual(fixture.errors, []);
	assert.deepEqual(fixture.loadedStorageKeys, []);
	assert.deepEqual(fixture.plannedProjects, []);
	assert.deepEqual(fixture.encodedPlans, []);
	assert.deepEqual(fixture.downloads, []);
});

test('video fallback cancellation during prior-output cleanup cannot begin download publication', async () => {
	let cleanupStarted: (() => void) | null = null;
	let releaseCleanup!: () => void;
	const started = new Promise<void>((resolve) => { cleanupStarted = resolve; });
	const release = new Promise<void>((resolve) => { releaseCleanup = resolve; });
	const fixture = createFixture({
		outputCleanup: async () => {
			cleanupStarted?.();
			await release;
		},
	});
	const service = createEditorExportService(fixture.runtime);
	const pending = service.exportVideo();
	await started;
	await service.handleExportAction('cancel');
	releaseCleanup();
	assert.equal(await pending, null);

	assert.deepEqual(fixture.errors, []);
	assert.deepEqual(fixture.downloads, []);
});

test('video fallback download publication receives the owned export signal', async () => {
	const fixture = createFixture();
	const result = await createEditorExportService(fixture.runtime).exportVideo();

	assert.equal(result?.mimeType, 'video/mp4');
	const request = fixture.downloads[0] as Readonly<{ signal?: AbortSignal }>;
	assert.ok(request.signal instanceof AbortSignal);
	assert.equal(request.signal.aborted, false);
});

test('ordinary video export does not invoke rendered-fallback integrity admission', async () => {
	let verificationCalls = 0;
	const fixture = createFixture({
		fallback: false,
		verify() {
			verificationCalls += 1;
			throw new Error('ordinary export must not verify a rendered fallback');
		},
	});
	const result = await createEditorExportService(fixture.runtime).exportVideo();

	assert.equal(result?.mimeType, 'video/mp4');
	assert.equal(verificationCalls, 0);
	assert.deepEqual(fixture.loadedStorageKeys, ['original-video-storage']);
});

test('video delivery rejects a simultaneous rendered fallback it cannot honor', () => {
	const fixture = createFixture();
	const delivery = fixture.runtime.playbackProjects.projectForVideoRenderedFallbackDelivery(fixture.canonical);
	const report = delivery.featureRequirementsReport;
	const competing = Object.freeze({
		...delivery,
		featureRequirementsReport: Object.freeze({
			...report,
			counts: Object.freeze({ available: 0, unavailable: 2, unknown: 0 }),
			items: Object.freeze([...report.items, Object.freeze({
				...report.items[0],
				requirementId: 'publisher-audio-render',
				featureId: PROJECT_FEATURE_CAPABILITY_IDS.audioEffects,
				fallback: Object.freeze({ kind: 'audio', sourceId: AUDIO_SOURCE_ID, sha256: 'cd'.repeat(32) }),
			})]),
		}),
	});

	assert.throws(
		() => projectForVideoRenderedFallbackExport(fixture.canonical, {
			projectForVideoRenderedFallbackDelivery: () => competing,
		}),
		/simultaneous rendered fallbacks/iu,
	);
});

test('video delivery rejects feature metadata drift before integrity admission', () => {
	const fixture = createFixture();
	const delivery = fixture.runtime.playbackProjects.projectForVideoRenderedFallbackDelivery(fixture.canonical);
	for (const featureId of [
		PROJECT_FEATURE_CAPABILITY_IDS.videoEffects,
		PROJECT_FEATURE_CAPABILITY_IDS.audioEffects,
	]) {
		assert.throws(
			() => projectForVideoRenderedFallbackExport(fixture.canonical, {
				projectForVideoRenderedFallbackDelivery: () => Object.freeze({
					...delivery,
					videoRenderedFallback: Object.freeze({
						...delivery.videoRenderedFallback!, featureId,
					}),
				}),
			}),
			/metadata|report|source|invalid|simultaneous/iu,
		);
	}
});
