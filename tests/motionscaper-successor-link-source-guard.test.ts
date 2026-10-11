/* SPDX-License-Identifier: AGPL-3.0-only */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMotionscaperProject } from '../src/motionscaper/editor-project.ts';
import { createMotionscaperRevision } from '../src/common/editor/motion-project-revision.ts';
import { createMotionCompositionOffer } from '../src/common/editor/motion-link-protocol.ts';
import { createVideoTrack } from '../src/common/editor/project-media-factory.ts';
import { createFramescaperCompositionSource } from '../src/framescaper/editor-composition-link-source.ts';
import { createFramescaperSuccessorRuntime } from '../src/framescaper/editor-project-successor-runtime.ts';
import { imageFixture, imageClip } from './helpers/framescaper-timeline-image-preview-fixture.ts';
function fixture() {
	const runtime = createFramescaperSuccessorRuntime({ line: 'successor' });
	const revision = createMotionscaperRevision(createMotionscaperProject({ id: 'motion', title: 'Scene', compositionId: 'main', durationFrames: 3 }));
	const linked = createFramescaperCompositionSource({ sourceId: 'linked', offer: createMotionCompositionOffer('main', revision), sampleRate: 48000 });
	const clip = { kind: 'video', id: 'clip', sourceId: 'linked', title: 'Scene', sequenceId: 'seq', sequenceStartFrame: 0, sequenceFrameCount: 3, sourceInFrame: 0, sourceFrameCount: 3, retimeMap: null };
	const project = { ...runtime.createProject({ sources: [linked.source], clips: [clip], projectBin: { clips: [{ ...clip, id: 'bin' }] }, tracks: [createVideoTrack({ id: 'track', clipIds: ['clip'] })], sequences: [{ id: 'seq', rate: revision.project.compositions[0]!.frameRate, trackIds: ['track'] }], primarySequenceId: 'seq' }), compositionLinks: [linked.link] };
	return { runtime, project };
}
test('M10 unrelated image and track edits preserve linked source authority across normalized field order', () => {
	const { runtime, project } = fixture(); const image = imageFixture('image', 4, 2);
	const reordered = { ...project, sources: project.sources.map(source => Object.fromEntries(Object.entries(source).reverse())) };
	const result = runtime.applyCommand(reordered, { type: 'batch', commands: [
		{ type: 'track/add', sequenceId: 'seq', track: createVideoTrack({ id: 'images', clipIds: [] }) },
		{ type: 'image-source/set', sourceId: image.source.id, expectedSource: null, source: image.source },
		{ type: 'image-clip/set', clipId: 'image-clip', expectedClip: null, expectedPlacement: null, clip: imageClip('image-clip', image.source.id, { sequenceId: 'seq', sequenceFrameCount: 3 }), placement: { scope: 'timeline', trackId: 'images' } },
	] });
	assert.deepEqual(result.sources.find(source => source.id === 'linked'), project.sources[0]); assert.deepEqual(result.compositionLinks, project.compositionLinks);
	assert.ok(result.clips.some(clip => clip.id === 'image-clip')); assert.equal(result.revision, 1);
});
test('M10 actual virtual source metadata changes still require explicit conform or detach', () => {
	const { runtime, project } = fixture();
	assert.throws(() => runtime.applyCommand(project, { type: 'source/update', sourceId: 'linked', changes: { name: 'Changed source' } }), /conform or detach/u);
	assert.equal(project.sources[0]!.name, 'Scene');
});
