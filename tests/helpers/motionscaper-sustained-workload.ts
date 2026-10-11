/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Worker } from 'node:worker_threads';
import { getHeapStatistics } from 'node:v8';
import CanvasKitInit from 'canvaskit-wasm';
import { createMotionPreviewWorkerBackend } from '../../src/common/editor/controller/composition/motion-preview-worker-backend.ts';
import { createMotionPreviewClient } from '../../src/common/editor/controller/composition/motion-preview-client.ts';
import type { MotionPreviewWorkerPort } from '../../src/common/editor/motion-preview-worker-protocol.ts';
import { createMotionMediaProvider } from '../../src/common/editor/motion-media-provider.ts';
import { prepareMotionMedia } from '../../src/common/editor/motion-media-import.ts';
import { createMotionAudioMixer } from '../../src/common/editor/motion-audio-mixer.ts';
import { createCanvasKitMotionRasterizer } from '../../src/common/editor/motion-canvaskit-rasterizer.ts';
import { createMotionFontProviderOwner } from '../../src/common/editor/motion-canvaskit-font-owner.ts';
import { createMotionPngSequenceSink } from '../../src/common/editor/controller/export/motion-png-sequence.ts';
import { renderMotionFrameSequence } from '../../src/common/editor/controller/export/motion-render-pipeline.ts';
import { createMotionscaperRenderRequest } from '../../src/motionscaper/editor-render-task.ts';
import { createMotionscaperRevision } from '../../src/motionscaper/editor-project-revision.ts';
import { createMotionscaperProject, createMotionLayer } from '../../src/motionscaper/editor-project.ts';
import { motionColor, motionScalar, motionVector } from '../../src/common/editor/motion-property.ts';
import { encodeMotionPng } from '../../src/common/editor/motion-png.ts';
import { motionWavFixture } from './motion-media-fixture.ts';
import type { MotionSustainedWorkerBackendName } from './motionscaper-sustained-worker.ts';

interface Run {
	frames: number; previewFrames: number; renderedFrames: number; audioSamples: number; sourceLoads: number;
	maximumDestinationFlights: number; maximumPreviewCacheBytes: number; maximumPcmCacheBytes: number;
	outputBytes: number; tarSha256: string; pcmSha256: string; closed: boolean; elapsedMs: number; maximumRssBytes: number;
	maximumHeapUsedBytes: number; endHeapUsedBytes: number; maximumFontProviders: number; maximumFontBytes: number;
}
/** Node CPU qualification: real persistent worker/CanvasKit, retained WAV decode, and forward-only PNG+PCM consumers. */
export async function qualifyMotionscaperSustainedWorkload(frameCounts: readonly number[]): Promise<{
	profile: 'node-worker-cpu-png-pcm-v1'; width: number; height: number; runs: readonly Run[]; maximumRssBytes: number; heapSizeLimitBytes: number;
}> {
	const maximumFrames = Math.floor((64 * 1024 * 1024 - 44) / (1600 * 2 * 2));
	if (!frameCounts.length || frameCounts.length > 4 || frameCounts.some(count => !Number.isSafeInteger(count) || count < 1 || count > maximumFrames)) throw new RangeError('Sustained qualification requires one to four frame counts within the 64 MiB retained WAV admission.');
	const kit = await CanvasKitInit(), fontBytes = new Uint8Array(await readFile(new URL('../../node_modules/@fontsource/inter/files/inter-latin-400-normal.woff2', import.meta.url)));
	const fontDigest = createHash('sha256').update(fontBytes).digest('hex');
	const font = { kind: 'font' as const, id: 'font', name: 'Inter', family: 'Inter', style: 'Regular', byteLength: fontBytes.length, sha256: fontDigest, storageKey: `motion-sha256:${fontDigest}`, mimeType: 'font/woff2' };
	const runs: Run[] = []; let maximumRssBytes = process.memoryUsage().rss;
	for (const frames of frameCounts) {
		const started = performance.now(); let peak = process.memoryUsage().rss, maximumHeapUsedBytes = 0;
		const sample = () => { const memory = process.memoryUsage(); peak = Math.max(peak, memory.rss); maximumRssBytes = Math.max(maximumRssBytes, peak); maximumHeapUsedBytes = Math.max(maximumHeapUsedBytes, memory.heapUsed); };
		const bytes = motionWavFixture(2, frames * 1600);
		const { asset } = await prepareMotionMedia(new Blob([bytes]), { id: 'sound', name: 'Sustained.wav' });
		if (asset.kind !== 'audio') throw new Error('The qualification requires actual retained PCM media.');
		const base = createMotionscaperProject({ id: 'sustained', title: 'Sustained CPU', compositionId: 'main', width: 64, height: 32, durationFrames: frames });
		const text = createMotionLayer({ id: 'text', name: 'Text', durationFrames: frames, content: { kind: 'text', document: {
			runs: [{ text: 'Motion', fontAssetId: 'font', fontSize: motionScalar(14), color: motionColor([1, 1, 1, 1]), tracking: motionScalar(0) }], align: 'left', lineHeight: motionScalar(1), boxSize: motionVector([64, 32]),
		} } });
		const solid = createMotionLayer({ id: 'solid', name: 'Background', durationFrames: frames, content: { kind: 'solid', color: motionColor([0.25, 0, 0.5, 0.5]), size: motionVector([64, 32]) } });
		const project = { ...base, assets: [font, asset], compositions: [{ ...base.compositions[0]!, layers: [text, solid], audio: [{ id: 'audio', assetId: asset.id,
			startFrame: { num: 0, den: 1 }, inFrame: { num: 0, den: 1 }, outFrame: { num: frames, den: 1 }, sourceStart: { num: 0, den: 1 }, timeScale: { num: 1, den: 1 }, enabled: true, gain: motionScalar(1) }] }] };
		const thread = new Worker(new URL('./motionscaper-sustained-worker.ts', import.meta.url));
		const events = new EventTarget(); thread.on('message', (data: unknown) => events.dispatchEvent(new MessageEvent('message', { data })));
		thread.on('error', () => events.dispatchEvent(new Event('error'))); thread.on('messageerror', () => events.dispatchEvent(new Event('messageerror')));
		let termination: Promise<number> | null = null;
		const port: MotionPreviewWorkerPort = { postMessage(message, transfer = []) { thread.postMessage(message, transfer.map(value => { if (!(value instanceof ArrayBuffer)) throw new TypeError('Only fixture buffers cross this worker.'); return value; })); },
			addEventListener(type, listener) { events.addEventListener(type, listener as EventListener); }, removeEventListener(type, listener) { events.removeEventListener(type, listener as EventListener); }, terminate() { termination ??= thread.terminate(); } };
		let previewFrames = 0, maximumPreviewCacheBytes = 0;
		const expectedBackend: MotionSustainedWorkerBackendName = 'worker-cpu';
		const preview = await createMotionPreviewClient({ maximumCacheBytes: 1024 * 1024,
			backendFactory: () => Promise.resolve(createMotionPreviewWorkerBackend(port, { maximumAssetBytes: 64 * 1024 * 1024, maximumWorkingBytes: 64 * 1024 * 1024 })),
			onFrame(frame) { assert.equal(frame.backend, expectedBackend); assert.equal(frame.rgba.byteLength, 64 * 32 * 4); previewFrames++; },
			onState(state) { maximumPreviewCacheBytes = Math.max(maximumPreviewCacheBytes, state.cacheBytes); },
		});
		try { await preview.setProject(project, () => Promise.resolve(fontBytes)); for (let index = 0; index < frames; index++) { await preview.seek({ compositionId: 'main', time: { num: index, den: 30 } }); if (index % 32 === 0) sample(); } }
		finally { preview.dispose(); await termination; }
		let sourceLoads = 0; const provider = createMotionMediaProvider({ loadAsset: () => { sourceLoads++; return Promise.resolve(bytes); } });
		const mixer = createMotionAudioMixer({ project, provider, maximumCacheBytes: 32768 });
		let audioSamples = 0, maximumPcmCacheBytes = 0, outputBytes = 0, active = 0, maximumDestinationFlights = 0, closed = false;
		const fontProviders = createMotionFontProviderOwner(kit); let maximumFontProviders = 0, maximumFontBytes = 0;
		const pngDigest = createHash('sha256'), pcmDigest = createHash('sha256');
		const writable = new WritableStream<Uint8Array>({
			async write(chunk) { active++; maximumDestinationFlights = Math.max(maximumDestinationFlights, active); try { await new Promise<void>(resolve => setImmediate(resolve)); pngDigest.update(chunk); outputBytes += chunk.byteLength; sample(); const state = fontProviders.snapshot(); maximumFontProviders = Math.max(maximumFontProviders, state.providers); maximumFontBytes = Math.max(maximumFontBytes, state.fontBytes); } finally { active--; } },
			close() { closed = true; }, abort() { throw new Error('Qualification unexpectedly aborted its destination.'); },
		});
		const revision = createMotionscaperRevision(project), composition = revision.project.compositions[0]!;
		const png = createMotionPngSequenceSink({ plan: { identity: { projectId: revision.projectId, revisionDigest: revision.digest, compositionId: composition.id },
			width: 64, height: 32, frameRate: { num: 30, den: 1 }, firstFrame: 0, frameCount: frames }, writable, encode: surface => Promise.resolve(encodeMotionPng(kit, surface)) });
		try {
			const receipt = await renderMotionFrameSequence(createMotionscaperRenderRequest({ project, compositionId: 'main', sink: { write: png.write, finish: png.finish, abort: png.abort, audio: { sampleRate: 48000, channels: 2,
				write(block) { assert.equal(block.startSample.num / block.startSample.den, audioSamples); for (let index = 0; index < block.sampleCount; index++) {
					const expected = ((audioSamples + index) % 127 - 63) / 128; assert.equal(block.interleaved[index * 2], expected); assert.equal(block.interleaved[index * 2 + 1], -expected || 0);
				} pcmDigest.update(new Uint8Array(block.interleaved.buffer, block.interleaved.byteOffset, block.interleaved.byteLength)); audioSamples += block.sampleCount;
				maximumPcmCacheBytes = Math.max(maximumPcmCacheBytes, mixer.snapshot().cacheBytes); return Promise.resolve(); },
			} }, acquire: () => Promise.resolve({ rasterizer: createCanvasKitMotionRasterizer(kit, { assets: project.assets, fallbackFonts: [], fontProviders, loadAsset: () => Promise.resolve(fontBytes) }),
				audioMixer: mixer, maximumWorkingBytes: 64 * 1024 * 1024, release() { fontProviders.dispose(); mixer.dispose(); provider.dispose(); return Promise.resolve(); } }) }));
			assert.equal(receipt.output, null); assert.equal(mixer.snapshot().cacheBytes, 0); sample();
			assert.deepEqual(fontProviders.snapshot(), { providers: 0, fontBytes: 0, activeLeases: 0, disposed: true });
			runs.push({ frames, previewFrames, renderedFrames: receipt.renderedFrames, audioSamples, sourceLoads, maximumDestinationFlights, maximumPreviewCacheBytes, maximumPcmCacheBytes,
				outputBytes, tarSha256: pngDigest.digest('hex'), pcmSha256: pcmDigest.digest('hex'), closed, elapsedMs: performance.now() - started, maximumRssBytes: peak,
				maximumHeapUsedBytes, endHeapUsedBytes: process.memoryUsage().heapUsed, maximumFontProviders, maximumFontBytes });
		} finally { fontProviders.dispose(); mixer.dispose(); provider.dispose(); }
	}
	return { profile: 'node-worker-cpu-png-pcm-v1', width: 64, height: 32, runs, maximumRssBytes, heapSizeLimitBytes: getHeapStatistics().heap_size_limit };
}
