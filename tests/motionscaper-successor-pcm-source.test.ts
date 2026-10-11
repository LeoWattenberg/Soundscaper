/* SPDX-License-Identifier: AGPL-3.0-only */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMotionscaperProject } from '../src/motionscaper/editor-project.ts';
import { createMotionscaperRevision } from '../src/common/editor/motion-project-revision.ts';
import { createMotionCompositionOffer } from '../src/common/editor/motion-link-protocol.ts';
import { motionScalar } from '../src/common/editor/motion-property.ts';
import { createFramescaperCompositionSource } from '../src/framescaper/editor-composition-link-source.ts';
import { createFramescaperSuccessorRuntime } from '../src/framescaper/editor-project-successor-runtime.ts';
import { createFramescaperCompositionPcmSource } from '../src/framescaper/editor-composition-link-pcm-source.ts';
import { createFramescaperVideoExportStrategySuccessor } from '../src/framescaper/video-export-strategy-successor.ts';
import { framescaperSuccessorBaselineProject } from '../src/framescaper/editor-project-successor-commands.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';

function fixture(audio = true) {
	const motion = createMotionscaperProject({ id: 'sound', title: 'Scene', compositionId: 'main', sampleRate: 8000, frameRate: { num: 30, den: 1 }, durationFrames: 17 });
	const asset = { id: 'wave', kind: 'audio' as const, name: 'Wave', byteLength: 1, sha256: 'a'.repeat(64), storageKey: `motion-sha256:${'a'.repeat(64)}`, mimeType: 'audio/wav', sampleRate: 8000, channels: 1, duration: { num: 1, den: 1 } };
	const offer = createMotionCompositionOffer('main', createMotionscaperRevision({ ...motion, assets: audio ? [asset] : [], compositions: [{ ...motion.compositions[0]!, audio: audio ? [{ id: 'placed', assetId: asset.id, startFrame: { num: 0, den: 1 }, inFrame: { num: 0, den: 1 }, outFrame: { num: 17, den: 1 }, sourceStart: { num: 0, den: 1 }, timeScale: { num: 1, den: 1 }, enabled: true, gain: motionScalar(0.5) }] : [] }] }));
	const linked = createFramescaperCompositionSource({ sourceId: 'picture', audioSourceId: 'pcm', offer, sampleRate: 48000 });
	const project = { ...createFramescaperSuccessorRuntime({ line: 'successor' }).createProject({ sources: [linked.source, linked.audioSource!] }), compositionLinks: [linked.link] };
	return { project, source: linked.audioSource! };
}
test('successor export omits only authenticated silent Motion companions and retains authored or ordinary audio', () => {
	for (const audible of [false, true]) {
		const { project, source } = fixture(audible);
		const createDeliveryProject = (sources: typeof project.sources, clips: ReturnType<typeof createAudioClip>[]) => ({ ...createFramescaperSuccessorRuntime({ line: 'successor' }).createProject({ sources, clips, tracks: [createAudioTrack({ id: 'audio-track', clipIds: clips.map(clip => clip.id) })] }), compositionLinks: project.compositionLinks });
		const projectWithClip = createDeliveryProject(project.sources, [createAudioClip({ id: 'audio-clip', sourceId: source.id, trackId: 'audio-track', durationFrames: 100, sourceDurationFrames: 100 })]);
		const strategy = createFramescaperVideoExportStrategySuccessor({ store: {} as never, readAsset: async () => null });
		const exportProject = strategy.createExportProject({ canonicalProject: projectWithClip, delivery: { project: framescaperSuccessorBaselineProject(projectWithClip), audioRenderedFallback: null, videoRenderedFallback: null, requiredAudioSourceIds: [], requiredVideoSourceIds: [] } });
		assert.equal(strategy.hasAudio!(exportProject), audible);
		assert.throws(() => strategy.hasAudio!({ ...exportProject }), /owned|canonical/iu);
		const ordinarySource = createAudioSource({ id: 'ordinary', frameCount: 100, channelCount: 1, sampleRate: 48000 });
		const ordinary = createDeliveryProject([...project.sources, ordinarySource], [...projectWithClip.clips as ReturnType<typeof createAudioClip>[], createAudioClip({ id: 'ordinary-clip', sourceId: ordinarySource.id, trackId: 'audio-track', durationFrames: 100, sourceDurationFrames: 100 })]);
		const ordinaryExport = strategy.createExportProject({ canonicalProject: ordinary, delivery: { project: framescaperSuccessorBaselineProject(ordinary), audioRenderedFallback: null, videoRenderedFallback: null, requiredAudioSourceIds: [], requiredVideoSourceIds: [] } });
		assert.equal(strategy.hasAudio!(ordinaryExport), true);
	}
});
test('successor companion chunks keep the native grid, stereo identity and short terminal extent for random engine reads', async () => {
	const { project, source } = fixture(); let releases = 0;
	const pcm = createFramescaperCompositionPcmSource({ project, source, acquire: async () => ({ provider: {
		describe: () => Promise.resolve({ sampleRate: 8000, channels: 1, sampleCount: 8000 }),
		read: ({ startSample, sampleCount }) => Promise.resolve(Float32Array.from({ length: sampleCount }, (_, i) => (startSample + i) / 8000)),
	}, async release() { releases++; } }) });
	assert.ok(pcm); assert.equal(pcm.sampleRate, 8000); assert.equal(pcm.frameCount, 4534); assert.equal(pcm.channelCount, 2); assert.equal(pcm.chunkFrames, 4096);
	try {
		const tail = await pcm.readStorageChunk(1); assert.equal(tail[0]!.length, 438); assert.deepEqual(tail[0], tail[1]);
		assert.ok(Math.abs(tail[0]![0]! - 4096 / 16000) < 1e-6);
		const head = await pcm.readStorageChunk(0); assert.equal(head[0]!.length, 4096); assert.equal(head[0]![0], 0); assert.ok(Math.abs(tail[0]![437]! - 4533 / 16000) < 1e-6);
		head[0]!.fill(0); assert.ok((await pcm.readStorageChunk(0))[0]![4000]! > 0);
		await assert.rejects(pcm.readStorageChunk(2), /extent|range/u);
	} finally { await pcm.dispose(); }
	assert.equal(releases, 1); await assert.rejects(pcm.readStorageChunk(0), /disposed/u);
});
test('successor silent companion is still renderable and cancelled engine reads do not change its accepted revision', async () => {
	const { project, source } = fixture(false); let acquired = 0;
	const pcm = createFramescaperCompositionPcmSource({ project, source, acquire: async () => { acquired++; return { provider: { describe: () => Promise.reject(new Error('Silent scene must not decode media')), read: () => Promise.reject(new Error('Silent scene must not decode media')) }, async release() {} }; } });
	assert.ok(pcm); const abort = new AbortController(); abort.abort();
	await assert.rejects(pcm.readStorageChunk(0, { signal: abort.signal }), { name: 'AbortError' }); assert.equal(acquired, 0);
	assert.equal((await pcm.readStorageChunk(0))[0]!.every(value => value === 0), true); await pcm.dispose();
});
