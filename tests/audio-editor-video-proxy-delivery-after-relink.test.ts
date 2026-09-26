/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createEditorVideoExportAction } from '../src/common/editor/controller/export/internal/video/video-export-service.ts';
import { CANONICAL_VIDEO_EXPORT_PLAN_VERSION } from '../src/common/editor/video-export-plan-version.ts';

const ORIGINAL_BYTES = Uint8Array.of(1, 2, 3, 4);
const PROXY_BYTES = Uint8Array.of(9, 8, 7, 6);
const ENCODED_MP4 = Uint8Array.of(
	0, 0, 0, 16, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0,
	0, 0, 0, 9, 0x6d, 0x6f, 0x6f, 0x76, 0,
);

test('video delivery refuses an offline linked original despite its proxy, then encodes the exact relink', async () => {
	const original = new Blob([ORIGINAL_BYTES], { type: 'video/mp4' });
	const proxy = new Blob([PROXY_BYTES], { type: 'video/mp4' });
	const project = linkedProject();
	const errors: unknown[] = [];
	const events: string[] = [];
	const encodedSources: Array<ReadonlyMap<string, Blob>> = [];
	const downloads: Blob[] = [];
	let linkedOriginal: Blob | null = null;
	let activeController: AbortController | null = null;
	const state = {
		exportGeneration: 0,
		exportAbort: null as AbortController | null,
		mobile: false,
		outputUrl: null as string | null,
		outputCleanup: null as (() => Promise<void>) | null,
		exportOutput: null as unknown,
		disposed: false,
	};
	const runtime = {
		abortError: () => Object.assign(new Error('aborted'), { name: 'AbortError' }),
		audioBufferChannels: (buffer: { channels: readonly Float32Array[] }) => buffer.channels,
		copy: { localSourcesMissing: 'Original missing', rendering: 'Rendering', encoding: 'Encoding', done: 'Done' },
		createVideoExportPlan: () => videoPlan(),
		encodeWav: () => Uint8Array.of(4, 5, 6),
		ffmpeg: {
			async encodeVideo(sources: ReadonlyMap<string, Blob>) {
				events.push('encode');
				encodedSources.push(new Map(sources));
				return { bytes: ENCODED_MP4, mimeType: 'video/mp4' };
			},
		},
		fileService: {
			isDesktop: true,
			getDesktopVideoExportCapabilities: () => ({ schemaVersion: 1, formats: {
				mp4: { available: true, provider: 'external-ffmpeg' },
				webm: { available: true, provider: 'external-ffmpeg' },
			} }),
			async createDownload(request: Readonly<{ blob: Blob }>) {
				events.push('download');
				downloads.push(request.blob);
				return { cancelled: false, url: 'blob:linked-export', fileName: 'Linked-video.mp4', method: 'object-url' };
			},
		},
		findClip: (value: typeof project, id: string) => value.clips.find((clip) => clip.id === id),
		findSource: (value: typeof project, id: string) => value.sources.find((source) => source.id === id),
		getProject: () => project,
		handleError(error: unknown) { errors.push(error); },
		hasMissingTimelineSources: () => false,
		lifetime: {
			startTask() {
				activeController = new AbortController();
				return { signal: activeController.signal, assertCurrent() {}, finish() {} };
			},
			cancelTask() { activeController?.abort(); },
		},
		preflightStorage: () => { events.push('preflight'); },
		projectGeneration: { capture: () => 'revision', assertCurrent() {} },
		projectSampleRate: () => 48_000,
		publishDocumentSnapshot() {},
		setStatus() {},
		sourceBuffers: new Map(),
		state,
		store: {
			async loadMediaAsset() { events.push('owned-original'); return null; },
			async resolveLinkedVideoOriginal(projectId: string, source: Readonly<{ id: string }>) {
				events.push('linked-original');
				assert.equal(projectId, project.id);
				assert.equal(source.id, 'linked-video');
				return linkedOriginal === null ? null : { blob: linkedOriginal, binding: 'exact-locator' };
			},
			async loadProxyBody() { throw new Error('A video proxy cannot supply delivery bytes.'); },
		},
		throwIfAborted(signal?: AbortSignal) { if (signal?.aborted) throw signal.reason; },
		toggleExport() {},
	};
	const exportVideo = createEditorVideoExportAction(runtime, async () => ({
		sampleRate: 48_000,
		channels: [Float32Array.of(0), Float32Array.of(0)],
	}));

	assert.equal(await exportVideo({ format: 'video-mp4' }), null);
	assert.match(String(errors[0]), /Relink the original; proxies are preview-only/u);
	assert.deepEqual(events, ['owned-original', 'linked-original']);
	assert.equal(encodedSources.length, 0);
	assert.equal(downloads.length, 0);

	linkedOriginal = original;
	const delivered = await exportVideo({ format: 'video-mp4' });
	assert.deepEqual(delivered, {
		url: 'blob:linked-export', fileName: 'Linked-video.mp4', mimeType: 'video/mp4',
		size: ENCODED_MP4.byteLength, method: 'object-url',
	});
	assert.deepEqual(events.slice(2), ['owned-original', 'linked-original', 'preflight', 'encode', 'download']);
	assert.equal(encodedSources.length, 1);
	assert.strictEqual(encodedSources[0]?.get('linked-video'), original);
	assert.notStrictEqual(encodedSources[0]?.get('linked-video'), proxy);
	assert.deepEqual(new Uint8Array(await downloads[0]!.arrayBuffer()), ENCODED_MP4);
	assert.equal(errors.length, 1);
});

function linkedProject() {
	return {
		id: 'linked-video-project', title: 'Linked video', sampleRate: 48_000, masterChannels: 2,
		tracks: [
			{ id: 'video-track', type: 'video', clipIds: ['video-clip'] },
			{ id: 'audio-track', type: 'audio', clipIds: ['audio-clip'] },
		],
		clips: [
			{ id: 'video-clip', kind: 'video', sourceId: 'linked-video', timelineStartFrame: 0,
				durationFrames: 48_000, sourceStartFrame: 0 },
			{ id: 'audio-clip', kind: 'audio', sourceId: 'audio-source', timelineStartFrame: 0,
				durationFrames: 48_000, sourceStartFrame: 0 },
		],
		sources: [{ id: 'linked-video', kind: 'video', storageKey: 'linked-video-storage',
			proxyAttachment: { body: 'verified-proxy' }, opaqueExtensions: { byteLength: ORIGINAL_BYTES.length } }],
	};
}

function videoPlan() {
	return {
		version: CANONICAL_VIDEO_EXPORT_PLAN_VERSION,
		format: 'mp4', container: 'mp4', extension: 'mp4', mimeType: 'video/mp4',
		quality: 'balanced', durationSeconds: 1, outputFrameCount: 30,
		canvas: { width: 640, height: 360, frameRate: 30, fit: 'contain', pixelFormat: 'yuv420p' },
		codecs: { video: 'h264', videoEncoder: 'libx264', audio: 'aac', audioEncoder: 'aac', pixelFormat: 'yuv420p' },
		inputs: [
			{ kind: 'video-source', inputIndex: 0, sourceId: 'linked-video', storageKey: 'linked-video-storage', mimeType: 'video/mp4' },
			{ kind: 'staged-audio-mix', inputIndex: 1, fileName: 'audio-mix.wav' },
		],
		filterPlan: { audio: { strategy: 'staged-mix', inputIndex: 1 } },
		range: { startFrame: 0, endFrame: 48_000, durationFrames: 48_000 },
		captions: null,
	};
}
