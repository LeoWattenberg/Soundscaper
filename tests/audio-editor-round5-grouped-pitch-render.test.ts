/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createClipTimePitchRenderService } from '../src/common/editor/controller/clip-video/clip-time-pitch-render-service.ts';
import { timePitchClipReplacementCommands } from '../src/common/editor/controller/clip-video/internal/clip/time-pitch-clip-replacement.ts';
import type { ClipTransformProject } from '../src/common/editor/controller/clip-video/internal/clip/clip-domain-types.ts';
import type { AudioBufferLike } from '../src/common/editor/controller/source/source-audio.ts';
import { EditorControllerLifetime, EditorProjectGeneration } from '../src/common/editor/controller/shared/lifecycle.ts';
import { createAddClipCommand, createAddSourceCommand } from '../src/common/editor/commands/factories.ts';
import { createEditorHistory, executeEditorCommand, undoEditorCommand, redoEditorCommand } from '../src/common/editor/history.js';
import { apply, createFixture } from './helpers/audio-editor-model-harness.js';
import { createPersistedVideoProject } from './helpers/persisted-video-project-fixture.ts';

for (const members of [1, 2, 3]) test(`pitch render retains all ${String(members)} original occurrences in one history entry`, async () => {
	let original = createFixture({ frameCount: 4800, channelCount: 1 });
	const ids = ['lead', 'companion', 'later'].slice(0, members);
	for (const [index, id] of ids.entries()) original = apply(original, createAddClipCommand(index === 1 ? 'track-2' : 'track-1', {
		id, sourceId: 'source-1', title: id, sourceStartFrame: 0, sourceDurationFrames: 4800,
		timelineStartFrame: index === 2 ? 4800 : 0, durationFrames: 4800,
		pitchCents: index ? 0 : 200, gain: index ? 0.5 : 1,
	}));
	if (members > 1) original = apply(original, { type: 'clip/group', clipIds: ids, groupId: 'authored-group' });
	original = apply(original, { type: 'selection/set', startFrame: 0, endFrame: members === 3 ? 9600 : 4800,
		trackIds: members > 1 ? ['track-1', 'track-2'] : ['track-1'], clipIds: ids });
	let history = createEditorHistory(original);
	const lifetime = new EditorControllerLifetime();
	lifetime.markReady();
	const generation = new EditorProjectGeneration();
	generation.activate(original.id);
	const pcm = new Float32Array(4800).fill(0.25);
	const rendered: AudioBufferLike = { length: pcm.length, sampleRate: 48000, numberOfChannels: 1,
		getChannelData: () => pcm };
	const writes: Float32Array[][] = [];
	const discarded: string[] = [];
	const service = createClipTimePitchRenderService({ lifetime,
		copy: { audioClipNotFound: 'Audio clip missing.', rendering: 'Rendering', renderPitchSpeed: 'Render pitch and speed', done: 'Done' },
		store: { async beginSourceWrite() { return { async write(channels) { writes.push(channels); },
			async commit() {}, async abort() {} }; }, async saveAnalysis() {},
			async deleteSource(id) { discarded.push(id); } },
		sourceBuffers: new Map<string, AudioBufferLike>(), sourcePeaks: new Map<string, unknown>(), sourceChunkFrames: 65536,
		getProject: () => history.present as unknown as ClipTransformProject, getSelectedClipId: () => 'lead',
		editingBlocked: () => false, captureProject: () => generation.capture(original.id),
		assertProject: token => generation.assertCurrent(token),
		prepareCommittedOutput: async () => ({ cacheKey: 'rendered', sampleRate: 48000, audioBuffer: rendered }),
		materializeEntry: async entry => entry, preflightStorage: async () => undefined,
		createId: () => 'private-rendered-source', writeBuffer: async writer => { await writer.write([pcm]); },
		generateWaveformPeaks: async () => ({}), peakCacheKey: id => id, cacheSourceBuffer() {},
		commit: command => { history = executeEditorCommand(history, command); },
		setProcessing() {}, setStatus() {}, publish() {},
	});
	assert.equal(await service.renderClipPitchSpeed('lead'), 'lead');
	const changed = history.present as unknown as ClipTransformProject;
	assert.equal(changed.clips.length, members, 'rendering one member must not remove its grouped companions');
	assert.deepEqual(changed.clips.map(clip => clip.id).sort(), [...ids].sort());
	for (const id of ids.slice(1)) assert.deepEqual(changed.clips.find(clip => clip.id === id),
		original.clips.find((clip: { id: string }) => clip.id === id));
	const lead = changed.clips.find(clip => clip.id === 'lead');
	assert.ok(lead);
	assert.equal(lead.groupId, members > 1 ? 'authored-group' : null);
	assert.equal(lead.sourceId, 'private-rendered-source');
	assert.equal(lead.pitchCents, 0);
	assert.equal(lead.speedRatio, 1);
	assert.deepEqual(changed.selection, original.selection);
	assert.deepEqual(changed.tracks.map(track => track.clipIds), original.tracks.map(track => track.clipIds));
	assert.deepEqual(writes, [[pcm]]);
	assert.deepEqual(discarded, []);
	assert.equal(history.undoStack.length, 1);
	history = undoEditorCommand(history);
	assert.deepEqual(history.present.clips, original.clips);
	assert.deepEqual(history.present.selection, original.selection);
	history = redoEditorCommand(history);
	assert.deepEqual(history.present.clips, changed.clips);
	assert.deepEqual(history.present.selection, changed.selection);
});

for (const grouped of [false, true]) test(`camera audio replacement preserves its picture${grouped ? ' and grouped third occurrence' : ''}`, () => {
	let project = createPersistedVideoProject({ timeline: true }).project;
	const audioId = 'persisted-timeline-audio';
	if (grouped) {
		project = apply(project, { type: 'track/add', track: { id: 'third-track', name: 'Untouched third track' } });
		project = apply(project, createAddClipCommand('third-track', { id: 'third', sourceId: 'persisted-audio-source',
			durationFrames: 48000, sourceDurationFrames: 48000 }));
		project = apply(project, { type: 'clip/group', clipIds: [audioId, 'third'], groupId: 'camera-group' });
	}
	const original = project;
	const projection = project as unknown as ClipTransformProject;
	const audio = projection.clips.find(clip => clip.id === audioId);
	const source = project.sources.find(source => source.id === audio?.sourceId);
	assert.ok(audio); assert.ok(source);
	const replacement = { ...audio, sourceId: 'rendered-camera-audio', pitchCents: 0, renderCacheRevision: 0 };
	let history = createEditorHistory(original);
	history = executeEditorCommand(history, { type: 'batch', commands: [
		createAddSourceCommand({ ...source, id: replacement.sourceId, storageKey: replacement.sourceId }),
		...timePitchClipReplacementCommands(projection, 'persisted-audio-track', audio, replacement),
	] });
	const after = history.present as unknown as ClipTransformProject;
	assert.equal(after.clips.length, grouped ? 3 : 2);
	for (const clip of projection.clips.filter(clip => clip.id !== audio.id))
		assert.deepEqual(after.clips.find(candidate => candidate.id === clip.id), clip);
	const rendered = after.clips.find(clip => clip.id === audio.id);
	assert.ok(rendered);
	assert.equal(rendered.sourceId, replacement.sourceId);
	assert.equal(rendered.avLinkId, audio.avLinkId);
	assert.equal(rendered.groupId, audio.groupId);
	assert.equal(rendered.durationFrames, audio.durationFrames);
	assert.deepEqual(after.tracks, projection.tracks);
	assert.equal(history.undoStack.length, 1);
	history = undoEditorCommand(history);
	assert.deepEqual(history.present.clips, original.clips);
	history = redoEditorCommand(history);
	assert.deepEqual(history.present.clips, after.clips);
});
