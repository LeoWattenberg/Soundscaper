/* SPDX-License-Identifier: AGPL-3.0-only */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSourceLifecycleService, type SourceLifecycleServiceRuntime } from '../src/common/editor/controller/source/source-lifecycle-service.ts';
import { SourceChunkProviderRegistry } from '../src/common/editor/controller/source/source-chunk-provider-registry.ts';
import type { EngineChunkSource } from '../src/common/editor/engine/types.ts';

type Provider = EngineChunkSource & { dispose(): Promise<void> };
function fixture() {
	const source = { id: 'pcm', kind: 'audio', storageKey: 'motion-composition-pcm:pcm', frameCount: 17, sampleRate: 8000, channelCount: 2, chunkFrames: 4096 };
	const project = { id: 'frame', sources: [source], clips: [{ id: 'clip', sourceId: source.id, kind: 'audio', durationFrames: 17 }] };
	let live = project, disposed = 0, resolved = 0; const providers = new SourceChunkProviderRegistry<string, Provider>();
	const refusal = () => Promise.reject(new Error('Encoded storage must not be accessed.'));
	const provider = (): Provider => ({ frameCount: source.frameCount, channelCount: source.channelCount, sampleRate: source.sampleRate, chunkFrames: source.chunkFrames,
		readStorageChunk: () => [new Float32Array(17), new Float32Array(17)], async dispose() { disposed++; } });
	const buffers = new Map<string, unknown>();
	type Resolver = NonNullable<SourceLifecycleServiceRuntime<unknown, typeof project, Provider>['resolveProductAudioSource']>;
	let resolver: Resolver = async request => { resolved++; assert.equal(request.project, project); assert.equal(request.source, source); request.assertCurrent(); return provider(); };
	const runtime: SourceLifecycleServiceRuntime<unknown, typeof project, Provider> = {
		MAXIMUM_WAVEFORM_PCM_WINDOW_ENTRIES: 2, MAXIMUM_WAVEFORM_PCM_WINDOW_FRAMES: 100, SHORT_SOURCE_AUDIO_BUFFER_MAX_BYTES: 1024,
		activateVideoSource: refusal, allProjectClips: value => value.clips, audioBufferChannels: () => [], clipSourceWindowRange: (_clip, startFrame, endFrame) => ({ startFrame, endFrame }),
		clipWaveformPcmRequests: new Map(), clipWaveformPcmWindows: new Map(), copy: {}, createStoredChunkProviderCandidate: () => { throw new Error('No stored source candidacy'); },
		resolveProductAudioSource: request => resolver(request),
		engine: { getAudioContext: refusal, setChunkSources: () => undefined }, findClip: (value, id) => value.clips.find(clip => clip.id === id), findSource: (value, id) => value.sources.find(source => source.id === id),
		generateStoredWaveformPeaks: refusal, generateWaveformPeaks: refusal, getProject: () => live,
		legacyPeakCacheKey: id => id, peakCacheKey: id => id, publishDocumentSnapshot() {}, readStoredAudioBuffer: refusal,
		readWaveformPcmWindow: () => [new Float32Array(17), new Float32Array(17)], setStatus() {}, sourceAudioBufferBytes: () => 0,
		sourceBuffers: { [Symbol.iterator]: () => buffers.entries(), has: id => buffers.has(id), get: id => buffers.get(id), delete: id => buffers.delete(id), setIfFits: (id, value) => { buffers.set(id, value); return true; } },
		sourceChunkProviders: providers, sourcePcmBytes: () => 0, sourcePeaks: new Map(), state: { missingSourceIds: new Set() },
		store: { getSourceMetadata: refusal, loadAnalysis: refusal, saveAnalysis: refusal }, waveformPcmWindowContains: () => false, waveformPeaksHaveRms: () => false,
	};
	return { project, runtime, providers, provider, setResolver(value: Resolver) { resolver = value; }, disposed: () => disposed, resolved: () => resolved, switchProject() { live = { ...project, id: 'other' }; } };
}
test('Motion product PCM precedes metadata and whole-buffer decoding in load, ensure and required-source staging', async () => {
	const f = fixture(); const service = createSourceLifecycleService(f.runtime);
	await service.loadProjectSources(f.project); assert.equal(f.providers.size, 1); assert.equal(f.resolved(), 1);
	await service.ensureProjectSourcesAvailable(f.project, { requiredAudioSourceIds: ['pcm'] }); assert.equal(f.resolved(), 2); await f.providers.drain(); assert.equal(f.disposed(), 1);
	const staged = await service.prepareRequiredProjectSources(f.project, { requiredAudioSourceIds: ['pcm'] }); assert.equal(f.providers.size, 1); assert.equal(f.disposed(), 1);
	await staged.discard(); assert.equal(f.disposed(), 2); f.providers.clear(); await f.providers.drain(); assert.equal(f.disposed(), 3);
});
test('Motion product PCM refuses changed geometry and disposes late acquisition across cancellation or project switch', async () => {
	const f = fixture(); const abort = new AbortController();
	f.setResolver(async () => ({ ...f.provider(), frameCount: 18 }));
	const service = createSourceLifecycleService(f.runtime);
	await assert.rejects(service.prepareRequiredProjectSources(f.project, { requiredAudioSourceIds: ['pcm'] }), /geometry|frameCount/u); assert.equal(f.disposed(), 1);
	f.setResolver(async request => { abort.abort(); request.assertCurrent(); return f.provider(); });
	await assert.rejects(service.prepareRequiredProjectSources(f.project, { requiredAudioSourceIds: ['pcm'], signal: abort.signal }), { name: 'AbortError' });
	f.setResolver(async () => { f.switchProject(); return f.provider(); });
	await assert.rejects(service.prepareRequiredProjectSources(f.project, { requiredAudioSourceIds: ['pcm'] }), /project|changed/iu); assert.equal(f.disposed(), 2); assert.equal(f.providers.size, 0);
});
test('Motion product PCM retires a lease returned after abort and publishes a staged lease only after engine acceptance', async () => {
	const f = fixture(); const service = createSourceLifecycleService(f.runtime); const abort = new AbortController();
	f.setResolver(async () => { const lease = f.provider(); abort.abort(); return lease; });
	await assert.rejects(service.prepareRequiredProjectSources(f.project, { requiredAudioSourceIds: ['pcm'], signal: abort.signal }), { name: 'AbortError' });
	assert.equal(f.disposed(), 1); assert.equal(f.providers.size, 0);
	f.setResolver(async () => f.provider());
	const staged = await service.prepareRequiredProjectSources(f.project, { requiredAudioSourceIds: ['pcm'] });
	const result = await staged.commit(async inputs => {
		assert.equal(f.providers.size, 0); const source = inputs.chunkSources.get('pcm'); assert.ok(source);
		const value = await source.readStorageChunk(0); const channels = 'channels' in value ? value.channels : value;
		assert.equal(channels[0]?.length, 17); return 'accepted';
	});
	assert.equal(result, 'accepted'); assert.equal(f.providers.size, 1);
	await staged.discard(); assert.equal(f.disposed(), 1);
	f.providers.clear(); await f.providers.drain(); assert.equal(f.disposed(), 2);
});
