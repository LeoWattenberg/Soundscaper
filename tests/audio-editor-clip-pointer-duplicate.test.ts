/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { createMemoryStore } from './helpers/audio-editor-memory-store-baseline.js';
import { COPY, createAudioEditorController, createMemoryEngine } from './helpers/audio-editor-controller-harness.js';

interface Project {
	readonly tracks: readonly Readonly<{ id: string; clipIds: readonly string[] }>[];
	readonly clips: readonly Readonly<{ id: string; timelineStartFrame: number; durationFrames: number; sourceStartFrame: number; sourceId: string; groupId: string | null }>[];
}
function snapshot(controller: ReturnType<typeof createAudioEditorController>) {
	return controller.getSnapshot().project as unknown as Project;
}
async function fixture() {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const controller = createAudioEditorController(null, { headless: true, copy: COPY, locale: 'en',
		store: createMemoryStore() as unknown as Options['store'], engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	await controller.ready;
	const trackId = snapshot(controller).tracks[0]!.id;
	controller.actions.edit.commit({ type: 'batch', commands: [
		{ type: 'source/add', source: { id: 'duplicate-source', storageKey: 'duplicate-source', name: 'tone.wav', mimeType: 'audio/wav', frameCount: 5000, channelCount: 1 } },
		{ type: 'clip/add', trackId, clip: { id: 'original', sourceId: 'duplicate-source', title: 'Original', timelineStartFrame: 500, sourceStartFrame: 100, durationFrames: 1000 } },
	] });
	return { controller, trackId };
}

test('Ctrl-drag duplicates at a new time through one undo without moving the original or replacing the clipboard', async context => {
	const { controller, trackId } = await fixture();
	context.after(async () => { await controller.dispose(); });
	controller.actions.timeline.setExactSelection(600, 850, { trackIds: [trackId] });
	controller.actions.edit.copy();
	const clipboard = controller.getSnapshot().history.hasClipboard;
	controller.actions.timeline.selectClip('original');
	const before = snapshot(controller);
	controller.actions.clip.move('original', trackId, 2000, { duplicate: true });
	const after = snapshot(controller);
	assert.equal(after.clips.length, 2);
	assert.deepEqual(after.clips.find(clip => clip.id === 'original'), before.clips[0]);
	const copy = after.clips.find(clip => clip.id !== 'original')!;
	assert.equal(copy.timelineStartFrame, 2000);
	assert.equal(copy.sourceStartFrame, 100);
	assert.equal(copy.durationFrames, 1000);
	assert.equal(copy.sourceId, 'duplicate-source');
	assert.equal(controller.getSnapshot().history.hasClipboard, clipboard);
	controller.actions.edit.undo();
	assert.deepEqual(snapshot(controller).clips, before.clips);
	controller.actions.timeline.setExactSelection(4000, 4000, { trackIds: [trackId] });
	controller.actions.transport.seek(4000);
	controller.actions.edit.pasteOverlap();
	const pasted = snapshot(controller).clips.find(clip => clip.timelineStartFrame === 4000);
	assert.equal(pasted?.durationFrames, 250, 'the clipboard still holds the earlier range rather than the dragged whole clip');
});

test('Ctrl-drag onto a new track creates its copy and destination in the same undo', async context => {
	const { controller } = await fixture();
	context.after(async () => { await controller.dispose(); });
	const before = snapshot(controller);
	const destination = controller.actions.clip.moveToNewTrack('original', 1800, { duplicate: true });
	const after = snapshot(controller);
	assert.equal(after.tracks.length, before.tracks.length + 1);
	assert.equal(after.clips.length, 2);
	assert.deepEqual(after.clips.find(clip => clip.id === 'original'), before.clips[0]);
	const copy = after.clips.find(clip => clip.id !== 'original')!;
	assert.equal(copy.timelineStartFrame, 1800);
	assert.deepEqual(after.tracks.find(track => track.id === destination)?.clipIds, [copy.id]);
	controller.actions.edit.undo();
	assert.equal(snapshot(controller).tracks.length, before.tracks.length);
	assert.equal(snapshot(controller).clips.length, 1);
});

test('duplicate drag uses the Framescaper native carrier for image bodies and picture/audio links', async () => {
	const { createEditorProjectRuntimeSelection } = await import('../src/framescaper/editor-project-runtime-selection.ts');
	const { FRAMESCAPER_PROJECT_RUNTIME_PROFILE } = await import('../src/framescaper/editor-project-runtime-profile.ts');
	const { createFramescaperBaselineImageFixture } = await import('./helpers/framescaper-baseline-image-fixture.ts');
	const { createClipTransformService } = await import('../src/common/editor/controller/clip-video/internal/clip/clip-transform-service.ts');
	const { createClipboardDescriptor } = await import('../src/common/editor/commands/clipboard-runtime.js');
	const runtime = createEditorProjectRuntimeSelection(FRAMESCAPER_PROJECT_RUNTIME_PROFILE);
	let owner = createFramescaperBaselineImageFixture().project;
	const projection = () => runtime.projectForCommandConsumers(owner) as unknown as import('../src/common/editor/controller/clip-video/internal/clip/clip-domain-types.ts').ClipTransformProject;
	let ordinal = 0;
	const createId = (prefix = 'id') => `${prefix}-pointer-duplicate-${++ordinal}`;
	let carrierCalls = 0;
	const service = createClipTransformService({ lifetime: { assertActive() {} }, copy: { audioClipNotFound: 'Missing clip', track: 'Track', timelineFramesFinite: 'Invalid frame' },
		getProject: projection, getSelectedClipId: () => null, editingBlocked: () => false, createId, snapTimelineFrame: frame => Math.round(Number(frame)), activeSelection: () => null,
		createDuplicateClipboard: (_project, options) => runtime.prepareEditClipboardDescriptor(owner, createClipboardDescriptor(runtime.projectForEditClipboardConsumers(owner), options)),
		prepareDuplicateCommand: (descriptor, command) => { carrierCalls++; return runtime.prepareEditDuplicateCommand(owner, descriptor, command, createId) as unknown as AudioEditorCommand; },
		commit: command => { owner = runtime.applyCommand(owner, command); },
	});
	const image = projection().clips.find(clip => clip.kind === 'image')!;
	assert.ok(image);
	const before = owner;
	const imageTrack = projection().tracks.find(track => track.clipIds?.includes(image.id))!;
	service.moveClips(image.id, imageTrack.id, 144_000, { duplicate: true, clipIds: [image.id] });
	assert.equal(carrierCalls, 1);
	assert.equal(owner.clips.length, before.clips.length + 1);
	assert.deepEqual(owner.clips.find(clip => clip.id === image.id), before.clips.find(clip => clip.id === image.id));
	const copies = projection().clips.filter(clip => clip.kind === 'image' && clip.id !== image.id);
	assert.equal(copies.length, 1);
	assert.equal(copies[0]?.timelineStartFrame, 144_000);
	owner = runtime.applyCommand(owner, { type: 'batch', commands: [
		{ type: 'track/update', trackId: 'video-track', changes: { laneGroupId: 'camera-lane' } },
		{ type: 'track/update', trackId: 'audio-track', changes: { laneGroupId: 'camera-lane' } },
		{ type: 'clip/link-av', videoClipId: 'video-clip', audioClipId: 'audio-clip', avLinkId: 'original-camera-link' },
	] });
	const picture = projection().clips.find(clip => clip.kind === 'video')!;
	const pictureTrack = projection().tracks.find(track => track.clipIds?.includes(picture.id))!;
	service.moveClips(picture.id, pictureTrack.id, 240_000, { duplicate: true, clipIds: [picture.id] });
	const linked = projection().clips.filter(clip => clip.timelineStartFrame === 240_000);
	assert.equal(linked.length, 2);
	assert.ok(linked[0]?.avLinkId);
	assert.equal(linked[0]?.avLinkId, linked[1]?.avLinkId);
	assert.notEqual(linked[0]?.avLinkId, picture.avLinkId);
});
