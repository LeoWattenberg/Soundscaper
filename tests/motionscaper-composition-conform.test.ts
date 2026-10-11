/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMotionscaperProject } from '../src/motionscaper/editor-project.ts';
import { createMotionscaperRevision } from '../src/common/editor/motion-project-revision.ts';
import { createMotionCompositionOffer } from '../src/common/editor/motion-link-protocol.ts';
import { reconcileFramescaperProjectFeatureRequirementsAssistance } from '../src/framescaper/editor-project-feature-requirements-assistance.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { createFramescaperSuccessorRuntime } from '../src/framescaper/editor-project-successor-runtime.ts';
import { createFramescaperCompositionSource } from '../src/framescaper/editor-composition-link-source.ts';
import { createVideoTrack, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { framescaperSuccessorBaselineProject } from '../src/framescaper/editor-project-successor-commands.ts';
import { createFramescaperCompositionConformPlan, verifyFramescaperCompositionConformPlan } from '../src/framescaper/editor-composition-link-conform.ts';
function fixture() {
	const runtime = createFramescaperSuccessorRuntime({ line: 'successor' });
	const motion = createMotionscaperProject({ id: 'motion', title: 'Scene', compositionId: 'main', frameRate: { num: 24, den: 1 }, durationFrames: 240, sampleRate: 48000 });
	const offer = createMotionCompositionOffer('main', createMotionscaperRevision(motion));
	const source = createFramescaperCompositionSource({ sourceId: 'picture', audioSourceId: 'pcm', offer, sampleRate: 48000 });
	const video = { kind: 'video', id: 'v', sourceId: 'picture', title: 'Scene', sequenceId: 'seq', sequenceStartFrame: 0, sequenceFrameCount: 240, sourceInFrame: 0, sourceFrameCount: 240, retimeMap: null, avLinkId: 'av' };
	const nested = { ...video, id: 'nested', avLinkId: null, sequenceId: 'child', sequenceFrameCount: 120, sourceInFrame: 96, sourceFrameCount: 120,
		retimeMap: { feature: 'video-retime', version: 2, points: [{ outerFrame: 0, sourceFrame: { num: 216, den: 1 } }, { outerFrame: 120, sourceFrame: { num: 96, den: 1 } }], segments: [{ mode: 'constant-reverse' }] } };
	const bin = { ...video, id: 'bin', avLinkId: null, binItemId: 'item', sourceInFrame: 216, sourceFrameCount: 24 };
	const project = runtime.cloneProject({ ...runtime.createProject({ id: 'frame', sources: [source.source, source.audioSource!], clips: [video, nested, { kind: 'audio', id: 'a', sourceId: 'pcm', title: 'Audio', durationFrames: 480000, sourceDurationFrames: 480000, avLinkId: 'av' }],
		tracks: [createVideoTrack({ id: 'video', clipIds: ['v'], laneGroupId: 'av' }), createAudioTrack({ id: 'audio', clipIds: ['a'], laneGroupId: 'av' }), createVideoTrack({ id: 'child-track', clipIds: ['nested'] })],
		sequences: [{ id: 'seq', rate: { num: 24, den: 1 }, trackIds: ['video', 'audio'] }, { id: 'child', rate: { num: 24, den: 1 }, trackIds: ['child-track'] }], primarySequenceId: 'seq',
		subsequences: [{ id: 'sub', sequenceId: 'seq', sourceSequenceId: 'child', sequenceStartFrame: 300, sequenceFrameCount: 120, sourceInFrame: 0, sourceFrameCount: 120 }], projectBin: { clips: [bin] } }), compositionLinks: [source.link] });
	const next = createMotionCompositionOffer('main', createMotionscaperRevision({ ...motion, revision: 1, sampleRate: 44100, compositions: [{ ...motion.compositions[0]!, durationFrames: 150, frameRate: { num: 30, den: 1 } }] }));
	return { runtime, project, next };
}
test('M10 reviewed Conform fits exact FPS/native windows across paired, nested and bin clips in one undo step', () => {
	const { runtime, project, next } = fixture(); const plan = createFramescaperCompositionConformPlan({ project, sourceId: 'picture', offer: next });
	assert.equal(plan.policy, 'fit-source-window'); assert.equal(plan.changes.length, 4); assert.equal(plan.timelineSpansUnchanged, true);
	const history = runtime.executeCommand(runtime.createHistory(project), verifyFramescaperCompositionConformPlan(plan, { project, offer: next })); const result = history.present;
	const video = result.clips.find(clip => clip.id === 'v')!, audio = result.clips.find(clip => clip.id === 'a')!, nested = result.clips.find(clip => clip.id === 'nested')!;
	assert.equal(video.sequenceFrameCount, 240); assert.equal(video.sourceFrameCount, 150); assert.equal(video.speedRatio, .5);
	assert.equal(audio.durationFrames, 480000); assert.equal(audio.sourceDurationFrames, 220500); assert.equal(audio.speedRatio, .5); assert.equal(audio.avLinkId, 'av');
	assert.equal(nested.sourceInFrame, 120); assert.equal(nested.sourceFrameCount, 30); assert.equal(nested.sequenceFrameCount, 120);
	assert.deepEqual((nested.retimeMap as { points: unknown }).points, [{ outerFrame: 0, sourceFrame: { num: 150, den: 1 } }, { outerFrame: 120, sourceFrame: { num: 120, den: 1 } }]);
	const bin = framescaperSuccessorBaselineProject(result).projectBin.clips[0]!; assert.equal(bin.sourceInFrame, 149); assert.equal(bin.sourceFrameCount, 1);
	const binReview = plan.changes.find(change => change.clipId === 'bin')!;
	assert.deepEqual(binReview.before.sourceDuration, { num: 1, den: 1 }); assert.deepEqual(binReview.after.sourceDuration, { num: 1, den: 30 });
	assert.deepEqual(binReview.before.timelineDuration, { num: 10, den: 1 }); assert.deepEqual(binReview.after.timelineDuration, binReview.before.timelineDuration);
	assert.deepEqual(result.subsequences, project.subsequences); assert.deepEqual(video.videoKeyframes, project.clips[0]!.videoKeyframes);
	assert.equal(history.undoStack.length, 1); const restored = runtime.undo(history).present; assert.deepEqual({ ...restored, revision: project.revision, updatedAt: project.updatedAt }, project);
	const redone = runtime.redo(runtime.undo(history)).present; assert.deepEqual(redone.clips, result.clips); assert.deepEqual(redone.compositionLinks, result.compositionLinks);
});
test('M10 Conform review rejects stale project, changed pending offer and forged review before publication', () => {
	const { runtime, project, next } = fixture(); const plan = createFramescaperCompositionConformPlan({ project, sourceId: 'picture', offer: next });
	const changed = runtime.applyCommand(project, { type: 'project/rename', title: 'Later' });
	assert.throws(() => verifyFramescaperCompositionConformPlan(plan, { project: changed, offer: next }), /changed|stale/iu);
	assert.throws(() => runtime.applyCommand(changed, plan.command), /changed|stale/iu);
	const later = createMotionCompositionOffer('main', createMotionscaperRevision({ ...next.revision.project, revision: 2 }));
	assert.throws(() => verifyFramescaperCompositionConformPlan(plan, { project, offer: later }), /changed|stale/iu);
	assert.throws(() => verifyFramescaperCompositionConformPlan({ ...plan, changes: [] }, { project, offer: next }), /review|plan/iu);
	assert.equal(project.compositionLinks[0]!.acceptedRevision, 0);
});

test('M10 Conform preserves ramp and freeze intent, affine audio warp, fades and envelope authority', () => {
	const { runtime, project: base, next } = fixture(); const foundation = framescaperSuccessorBaselineProject(base);
	const candidate = { ...base, clips: base.clips.map(clip => clip.id === 'v' ? { ...clip, retimeMap: { feature: 'video-retime', version: 2,
		points: [{ outerFrame: 0, sourceFrame: { num: 0, den: 1 } }, { outerFrame: 240, sourceFrame: { num: 240, den: 1 } }], segments: [{ mode: 'ramp-forward', startVelocity: { num: 1, den: 2 }, endVelocity: { num: 3, den: 2 } }] } }
		: clip.id === 'a' ? { ...clip, fadeInFrames: 1200, fadeOutFrames: 2400, envelope: [{ frame: 0, value: .5 }, { frame: 480000, value: 1 }], warpMap: { feature: 'audio-warp', points: [{ outer: { num: 0, den: 1 }, source: { num: 0, den: 1 }, mode: 'forward' }, { outer: { num: 240000, den: 1 }, source: { num: 360000, den: 1 }, mode: 'forward' }, { outer: { num: 480000, den: 1 }, source: { num: 480000, den: 1 }, mode: 'forward' }] } } : clip),
		projectBin: { ...foundation.projectBin, clips: foundation.projectBin.clips.map(clip => ({ ...clip, retimeMap: { feature: 'video-retime', version: 2, points: [{ outerFrame: 0, sourceFrame: { num: 229, den: 1 } }, { outerFrame: 240, sourceFrame: { num: 229, den: 1 } }], segments: [{ mode: 'freeze' }] } })) } };
	const project = runtime.cloneProject({ ...candidate, featureRequirements: reconcileFramescaperProjectFeatureRequirementsAssistance(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, { ...candidate, schemaVersion: 1 }) });
	const plan = createFramescaperCompositionConformPlan({ project, sourceId: 'picture', offer: next }), result = runtime.applyCommand(project, plan.command);
	const video = result.clips.find(clip => clip.id === 'v')!, audio = result.clips.find(clip => clip.id === 'a')!;
	assert.deepEqual((video.retimeMap as { segments: unknown }).segments, [{ mode: 'ramp-forward', startVelocity: { num: 5, den: 16 }, endVelocity: { num: 15, den: 16 } }]);
	const bin = framescaperSuccessorBaselineProject(result).projectBin.clips[0]!;
	assert.deepEqual((bin.retimeMap as { points: unknown }).points, [{ outerFrame: 0, sourceFrame: { num: 3589, den: 24 } }, { outerFrame: 240, sourceFrame: { num: 3589, den: 24 } }]);
	assert.equal(audio.fadeInFrames, 1200); assert.equal(audio.fadeOutFrames, 2400); assert.deepEqual(audio.envelope, project.clips.find(clip => clip.id === 'a')!.envelope);
	assert.equal((audio.warpMap as { points: { source: { num: number } }[] }).points[1]!.source.num, 165375);
	assert.equal(plan.changes.find(change => change.clipId === 'a')!.warpMapChanged, true); assert.equal(plan.changes.find(change => change.clipId === 'bin')!.retimeMapChanged, true);
});
test('M10 Conform exposes nearest integer rounding and refuses an illegal audio speed without mutation', () => {
	const { runtime, project: base, next } = fixture(); const foundation = framescaperSuccessorBaselineProject(base);
	const project = runtime.cloneProject({ ...base, projectBin: { ...foundation.projectBin, clips: foundation.projectBin.clips.map(clip => ({ ...clip, sourceInFrame: 1, sourceFrameCount: 1 })) } });
	const plan = createFramescaperCompositionConformPlan({ project, sourceId: 'picture', offer: next }); const bin = plan.changes.find(change => change.clipId === 'bin')!;
	assert.equal(plan.rounding, 'nearest-frame-ties-away-from-zero'); assert.equal(bin.after.start, 1); assert.equal(bin.after.count, 2); assert.equal(bin.after.speedRatio, 1.6);
	const slow = runtime.cloneProject({ ...base, clips: base.clips.map(clip => clip.id === 'a' ? { ...clip, speedRatio: .001 } : clip) });
	assert.throws(() => createFramescaperCompositionConformPlan({ project: slow, sourceId: 'picture', offer: next }), /legal playback rate.*a/iu); assert.equal(slow.compositionLinks[0]!.acceptedRevision, 0);
});
test('M10 Conform refuses a review exceeding the occurrence budget before producing a candidate', () => {
	const { project, next } = fixture(); const foundation = framescaperSuccessorBaselineProject(project);
	const large = { ...project, projectBin: { ...foundation.projectBin, clips: Array.from({ length: 1025 }, (_, index) => ({ ...project.clips.find(clip => clip.id === 'a')!, avLinkId: null, id: `bin-${index}`, binItemId: `item-${index}` })) } };
	assert.throws(() => createFramescaperCompositionConformPlan({ project: large, sourceId: 'picture', offer: next }), /1024-occurrence review budget/iu);
	assert.equal(project.compositionLinks[0]!.acceptedRevision, 0);
});
