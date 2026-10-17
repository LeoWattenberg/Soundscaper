/* SPDX-License-Identifier: AGPL-3.0-only */
import { createMotionscaperProject, createMotionLayer } from '../../src/motionscaper/editor-project.ts';
import { createMotionscaperRevision } from '../../src/common/editor/motion-project-revision.ts';
import { createMotionCompositionOffer } from '../../src/common/editor/motion-link-protocol.ts';
import { motionColor, motionVector } from '../../src/common/editor/motion-property.ts';
import { createVideoTrack } from '../../src/common/editor/project-media-factory.ts';
import { createFramescaperCompositionSource } from '../../src/framescaper/editor-composition-link-source.ts';
import { createFramescaperSuccessorRuntime } from '../../src/framescaper/editor-project-successor-runtime.ts';
import { imageFixture, imageClip } from './framescaper-timeline-image-preview-fixture.ts';

export function motionscaperMixedPreviewFixture(imageAbove = false, adjustment = false) {
	const motion = createMotionscaperProject({ id: 'motion', title: 'Scene', compositionId: 'main', width: 4, height: 2, durationFrames: 60, frameRate: { num: 30000, den: 1001 } });
	const layer = createMotionLayer({ id: 'card', name: 'Card', durationFrames: 60, content: { kind: 'solid', color: motionColor([1, 0, 0, 0.5]), size: motionVector([2, 2]) } });
	const offer = createMotionCompositionOffer('main', createMotionscaperRevision({ ...motion, compositions: [{ ...motion.compositions[0]!, layers: [layer] }] }));
	const linked = createFramescaperCompositionSource({ sourceId: 'linked', offer, sampleRate: 48000 });
	const tracks = [createVideoTrack({ id: 'motion-track', clipIds: ['motion-clip'] }), createVideoTrack({ id: 'image-track', clipIds: [] })];
	if (imageAbove) tracks.reverse();
	const runtime = createFramescaperSuccessorRuntime({ line: 'successor' });
	const project = { ...runtime.createProject({ sources: [linked.source], clips: [{ kind: 'video', id: 'motion-clip', sourceId: 'linked', title: 'Scene', sequenceId: 'seq', sequenceStartFrame: 0, sequenceFrameCount: 60, sourceInFrame: 0, sourceFrameCount: 60, retimeMap: null, ...(adjustment ? { videoEffects: [{ id: 'grade', type: 'color-adjust', enabled: true, params: { brightness: 0.1 } }] } : {}) }], tracks,
		...(adjustment ? { visualModel: { stillSources: [], generatorSources: [], maskMattes: [], presets: [], freezeFallbacks: [], adjustmentLayers: [{ schemaVersion: 1, kind: 'adjustment-layer', id: 'adjustment', sequenceId: 'seq', sequenceStartFrame: 0, sequenceFrameCount: 60, targetTrackIds: ['motion-track', 'image-track'], effectIds: ['grade'] }] } } : {}),
		sequences: [{ id: 'seq', rate: offer.output.frameRate, trackIds: tracks.map(track => track.id) }], primarySequenceId: 'seq',
	}), compositionLinks: [linked.link] };
	const image = imageFixture('image', 4, 2);
	const mixed = runtime.applyCommand(project, { type: 'batch', commands: [
		{ type: 'image-source/set', sourceId: image.source.id, expectedSource: null, source: image.source },
		{ type: 'image-clip/set', clipId: 'image-clip', expectedClip: null, expectedPlacement: null, clip: imageClip('image-clip', image.source.id, { sequenceId: 'seq', sequenceFrameCount: 60 }), placement: { scope: 'timeline', trackId: 'image-track' } },
	] });
	return { project: mixed, image, linked };
}

