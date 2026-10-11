/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMotionscaperProject } from '../src/motionscaper/editor-project.ts';
import { createMotionscaperRevision } from '../src/common/editor/motion-project-revision.ts';
import { createMotionCompositionOffer } from '../src/common/editor/motion-link-protocol.ts';
import { createFramescaperCompositionSource, resolveFramescaperCompositionSource, resolveFramescaperCompositionAudioSource } from '../src/framescaper/editor-composition-link-source.ts';
import { createFramescaperSuccessorRuntime } from '../src/framescaper/editor-project-successor-runtime.ts';
import { validateFramescaperProject } from '../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { framescaperSuccessorBaselineProject, applyFramescaperSuccessorCommand } from '../src/framescaper/editor-project-successor-commands.ts';
import { framescaperSuccessorMediaRootDocument } from '../src/framescaper/editor-project-successor-media-roots.ts';
import { createFramescaperSuccessorHistory } from '../src/framescaper/editor-project-successor-history.ts';
import { createProjectVisualService, type ProjectVisualServiceDependencies } from '../src/common/editor/controller/document/project-visual-service.ts';
function fixture() {
	const motion = createMotionscaperProject({ id: 'motion', title: 'Motion', compositionId: 'title', frameRate: { num: 30000, den: 1001 }, durationFrames: 3 });
	const offer = createMotionCompositionOffer('title', createMotionscaperRevision(motion));
	const linked = createFramescaperCompositionSource({ sourceId: 'linked', offer, sampleRate: 48000 });
	const project = { ...createFramescaperSuccessorRuntime({ line: 'successor' }).createProject({ id: 'frame', sources: [linked.source] }), compositionLinks: [linked.link] };
	return { linked, project, offer };
}
test('composition source retains exact rational timing without an encoded media authority', () => {
	const { linked, project, offer } = fixture();
	assert.equal(linked.source.mimeType, 'application/vnd.motionscaper.composition'); assert.equal(linked.source.videoCodec, 'Motion composition');
	assert.equal(linked.source.sourceFrameCount, 3); assert.equal(linked.source.sampleFrameCount, 4805);
	assert.deepEqual(linked.timing.index.presentationTicks, [0n, 1001n, 2002n]); assert.equal(linked.timing.index.timescale, 30000);
	assert.equal(linked.timing.index.endTicks, 3003n); assert.equal(linked.source.timingDecision.mode, 'exact');
	assert.equal(validateFramescaperProject(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, framescaperSuccessorBaselineProject(project)), true);
	assert.equal(resolveFramescaperCompositionSource(project, linked.source)?.offer.revision.digest, offer.revision.digest);
	assert.throws(() => resolveFramescaperCompositionSource(project, { ...linked.source, width: 123 }), /descriptor|contract/iu);
	const ordinary = { ...project.sources[0]!, videoCodec: 'h264' }; assert.equal(resolveFramescaperCompositionSource({ ...project, sources: [ordinary], compositionLinks: [] }, ordinary), null);
	assert.throws(() => resolveFramescaperCompositionSource({ ...project, compositionLinks: [] }, linked.source), /link|authority/iu);
});
test('composition activation precedes all timing, proxy, encoded body, and object URL access', async () => {
	const { linked, project } = fixture(); let reads = 0;
	const service = createProjectVisualService({
		getProject: () => project, captureProject: () => project, assertProject: token => assert.equal(token, project),
		missingSourceIds: new Set(['linked']), sourceBuffers: new Map(), sourcePeaks: new Map(), waveformPcmWindows: new Map(),
		store: { loadMediaAsset: async () => { reads++; throw new Error('Encoded bytes must not be requested.'); }, listVideoDerivatives: async () => { reads++; return []; }, loadVideoDerivative: async () => null },
		resolveProductVideoPreviewMedia: async () => { reads++; throw new Error('Proxy must not be requested.'); },
		resolveProductVideoSource: async request => { request.assertCurrent(); return { mediaKind: 'composition', timingIndex: linked.timing.index }; },
		projectDurationFrames: () => 4805, url: { createObjectURL: () => { reads++; return 'fake'; }, revokeObjectURL() {} },
	} satisfies ProjectVisualServiceDependencies);
	assert.deepEqual(await service.activateVideoSource(linked.source), { mediaKind: 'composition', mediaUrl: null, posterUrl: null, thumbnails: [] });
	assert.equal(service.getVideoSourceVisualData('linked')?.available, true); assert.equal(reads, 0); await service.dispose();
});
test('composition activation refuses stale results and preserves strict source refusal', async () => {
	const { linked, project } = fixture(); let current = true; let refusal = false;
	const service = createProjectVisualService({ getProject: () => project, captureProject: () => 1, assertProject: () => { if (!current) throw new Error('stale'); },
		missingSourceIds: new Set(), sourceBuffers: new Map(), sourcePeaks: new Map(), waveformPcmWindows: new Map(),
		store: { loadMediaAsset: async () => { throw new Error('Wrong fallback'); }, listVideoDerivatives: async () => [], loadVideoDerivative: async () => null },
		resolveProductVideoSource: async () => { if (refusal) throw new Error('Retained closure unavailable'); current = false; return { mediaKind: 'composition', timingIndex: linked.timing.index }; },
		projectDurationFrames: () => 4805, url: { createObjectURL: () => null, revokeObjectURL() {} },
	} satisfies ProjectVisualServiceDependencies);
	await assert.rejects(service.activateVideoSource(linked.source), /stale/u); assert.equal(service.getVideoSourceVisualData('linked')?.mediaKind, undefined);
	current = true; refusal = true; await assert.rejects(service.activateVideoSource(linked.source), /Retained closure unavailable/u); await service.dispose();
});

test('composition audio companion retains its native sample grid and refuses descriptor drift', () => {
	const { offer } = fixture();
	const native = createMotionscaperProject({ id: 'native', title: 'Native', compositionId: 'title', sampleRate: 44100, frameRate: { num: 30000, den: 1001 }, durationFrames: 3 });
	const linked = createFramescaperCompositionSource({ sourceId: 'picture', audioSourceId: 'sound', offer: createMotionCompositionOffer('title', createMotionscaperRevision(native)), sampleRate: 48000 });
	assert.ok(linked.audioSource); assert.equal(linked.link.audioSourceId, 'sound');
	assert.equal(linked.audioSource.sampleRate, 44100); assert.equal(linked.audioSource.originalSampleRate, 44100);
	assert.equal(linked.audioSource.frameCount, 4415); assert.equal(linked.audioSource.channelCount, 2); assert.equal(linked.audioSource.chunkFrames, 4096);
	assert.equal(linked.source.hasAudio, false); // The stable companion permits silence now and audio in a later saved revision.
	const project = { ...createFramescaperSuccessorRuntime({ line: 'successor' }).createProject({ id: 'frame', sources: [linked.source, linked.audioSource] }), compositionLinks: [linked.link] };
	assert.deepEqual(framescaperSuccessorMediaRootDocument(createFramescaperSuccessorHistory(project)).sources, []);
	assert.equal(resolveFramescaperCompositionAudioSource(project, linked.audioSource)?.offer.revision.digest, linked.offer.revision.digest);
	assert.throws(() => resolveFramescaperCompositionAudioSource(project, { ...linked.audioSource, frameCount: 4414 }), /descriptor|contract/iu);
	assert.throws(() => resolveFramescaperCompositionAudioSource({ ...project, compositionLinks: [] }, linked.audioSource), /link|authority/iu);
	assert.equal(resolveFramescaperCompositionAudioSource(project, linked.source), null);
	assert.equal(createFramescaperCompositionSource({ sourceId: 'legacy', offer, sampleRate: 48000 }).audioSource, undefined);
	assert.throws(() => createFramescaperCompositionSource({ sourceId: 'same', audioSourceId: 'same', offer, sampleRate: 48000 }), /distinct/iu);
});

test('accepted scene replacement derives both source descriptors without pretending to rewrite encoded media', () => {
	const { offer } = fixture(); const first = createFramescaperCompositionSource({ sourceId: 'picture', audioSourceId: 'sound', offer, sampleRate: 48000 });
	const runtime = createFramescaperSuccessorRuntime({ line: 'successor' });
	const project = { ...runtime.createProject({ id: 'frame', sources: [first.source, first.audioSource!] }), compositionLinks: [first.link] };
	const revision = createMotionscaperRevision({ ...offer.revision.project, revision: 1, title: 'New saved title' });
	const next = createFramescaperCompositionSource({ sourceId: 'picture', audioSourceId: 'sound', offer: createMotionCompositionOffer('title', revision), sampleRate: 48000 });
	const updated = applyFramescaperSuccessorCommand(project, { type: 'composition-link/replace', sourceId: 'picture', expectedDigest: first.link.acceptedDigest, link: next.link, commands: [] });
	const sources = framescaperSuccessorBaselineProject(updated).sources;
	assert.equal(resolveFramescaperCompositionSource(updated, sources.find(source => source.id === 'picture')!)?.offer.revision.digest, revision.digest);
	assert.equal(resolveFramescaperCompositionAudioSource(updated, sources.find(source => source.id === 'sound')!)?.offer.revision.digest, revision.digest);
	assert.throws(() => applyFramescaperSuccessorCommand(updated, { type: 'source/update', sourceId: 'sound', changes: { mimeType: 'audio/wav' } }), /conform|detach/iu);
});
