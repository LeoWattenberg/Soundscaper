/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import { createProjectViewService } from '../src/common/editor/controller/project-view-service.ts';
import { createTrackDuplicationService } from '../src/common/editor/controller/track-duplication-service.ts';

test('project view publication clamps timeline geometry and updates dependent state once', () => {
	const project = {
		id: 'project',
		tracks: [{ id: 'audio', type: 'audio', displayMode: 'waveform' }],
	};
	const state = {
		pixelsPerSecond: 20,
		timelineViewportWidth: 500,
		timelineWidth: 0,
		timelineView: 'waveform' as const,
	};
	const events: string[] = [];
	const service = createProjectViewService({
		lifetime: { assertActive: () => undefined },
		state,
		getProject: () => project,
		projectDurationFrames: () => 100,
		editorTimelineDurationFrames: () => 1_000,
		projectSampleRate: () => 100,
		maximumPixelsPerSecond: 6_000_000,
		synchronizeAutomaticSampleEditMode: () => { events.push('sample-mode'); },
		getEnginePositionFrames: () => 42,
		updatePlayhead: (frame, duration) => { events.push(`playhead:${frame}:${duration}`); },
		publishDocumentSnapshot: () => { events.push('publish'); },
		editingBlocked: () => false,
		commit: () => undefined,
	});

	service.publishProjectState();
	assert.equal(state.pixelsPerSecond, 50);
	assert.equal(state.timelineWidth, 500);
	assert.deepEqual(events, ['sample-mode', 'playhead:42:100', 'publish']);
});

test('project view setters normalize modes and commit all changed audio tracks atomically', () => {
	const project = {
		id: 'project',
		tracks: [
			{ id: 'first', type: 'audio', displayMode: 'waveform' },
			{ id: 'second', type: 'audio', displayMode: 'spectrogram' },
			{ id: 'video', type: 'video', displayMode: 'waveform' },
		],
	};
	const state = {
		pixelsPerSecond: 120,
		timelineViewportWidth: 0,
		timelineWidth: 1,
		timelineView: 'waveform' as 'waveform' | 'spectrogram' | 'multiview',
	};
	const commands: AudioEditorCommand[] = [];
	let publishes = 0;
	const service = createProjectViewService({
		lifetime: { assertActive: () => undefined },
		state,
		getProject: () => project,
		projectDurationFrames: () => 0,
		editorTimelineDurationFrames: () => 100,
		projectSampleRate: () => 100,
		maximumPixelsPerSecond: 6_000_000,
		synchronizeAutomaticSampleEditMode: () => undefined,
		getEnginePositionFrames: () => 0,
		updatePlayhead: () => undefined,
		publishDocumentSnapshot: () => { publishes += 1; },
		editingBlocked: () => false,
		commit: (command) => { commands.push(command); return project; },
	});

	assert.equal(service.setTimelineView('unsupported'), 'waveform');
	assert.equal(service.setTimelineView('multiview'), 'multiview');
	assert.equal(service.setAllTracksView('spectrogram'), project);
	assert.equal(state.timelineView, 'spectrogram');
	assert.equal(commands.length, 1);
	assert.deepEqual(commands[0], {
		type: 'batch',
		commands: [{ type: 'track/update', trackId: 'first', changes: { displayMode: 'spectrogram' } }],
	});
	assert.equal(publishes, 2);

	// Multi-view is a display of its own, not a value that falls back to the
	// waveform: the toolbar's spectrogram options turn the whole timeline into it.
	assert.equal(service.setAllTracksView('multiview'), project);
	assert.equal(state.timelineView, 'multiview');
	assert.deepEqual(commands[1], {
		type: 'batch',
		commands: [
			{ type: 'track/update', trackId: 'first', changes: { displayMode: 'multiview' } },
			{ type: 'track/update', trackId: 'second', changes: { displayMode: 'multiview' } },
		],
	});
	assert.equal(service.setAllTracksView('half-wave'), project);
	assert.equal(state.timelineView, 'waveform');
});

test('project view handles empty, blocked, and already-matching timelines without commands', () => {
	let project: {
		readonly id: string;
		readonly tracks: readonly Readonly<{ id: string; type: string; displayMode: string }>[];
	} | null = null;
	let blocked = false;
	let publishes = 0;
	let commits = 0;
	const state = {
		pixelsPerSecond: 120,
		timelineViewportWidth: 0,
		timelineWidth: 1,
		timelineView: 'waveform' as 'waveform' | 'spectrogram' | 'multiview',
	};
	const service = createProjectViewService({
		lifetime: { assertActive: () => undefined },
		state,
		getProject: () => project,
		projectDurationFrames: () => 0,
		editorTimelineDurationFrames: () => 100,
		projectSampleRate: () => 100,
		maximumPixelsPerSecond: 6_000_000,
		synchronizeAutomaticSampleEditMode: () => undefined,
		getEnginePositionFrames: () => 0,
		updatePlayhead: () => undefined,
		publishDocumentSnapshot: () => { publishes += 1; },
		editingBlocked: () => blocked,
		commit: () => { commits += 1; return project; },
	});

	service.publishProjectState();
	assert.equal(service.setAllTracksView('spectrogram'), 'spectrogram');
	project = { id: 'project', tracks: [{ id: 'audio', type: 'audio', displayMode: 'spectrogram' }] };
	blocked = true;
	assert.equal(service.setAllTracksView('waveform'), null);
	blocked = false;
	assert.equal(service.setAllTracksView('spectrogram'), project);
	assert.equal(service.setTimelineView('spectrogram'), 'spectrogram');
	assert.equal(commits, 0);
	assert.equal(publishes, 4);
});

test('track duplication prepares stable track, clip, and effect identities in one batch', () => {
	const track = {
		id: 'video-track',
		name: 'Picture',
		type: 'video',
		armed: true,
		laneGroupId: 'linked-lanes',
		clipIds: ['clip'],
		effects: [{ id: 'rack-effect', type: 'delay', params: { mix: 0.5 } }],
	};
	const clip = {
		id: 'clip',
		kind: 'video',
		sourceId: 'source',
		title: 'Picture',
		avLinkId: 'av-link',
		videoEffects: [{ id: 'video-effect', type: 'pixelate', params: { blockSize: 16 } }],
	};
	let sequence = 0;
	let committed: Readonly<{
		command: AudioEditorCommand;
		selection: Readonly<{ selectTrackId: string; selectClipId: string | null }>;
	}> | null = null;
	const service = createTrackDuplicationService({
		lifetime: { assertActive: () => undefined },
		copySuffix: 'copy',
		editingBlocked: () => false,
		getProject: () => ({ id: 'project', tracks: [track], clips: [clip] }),
		createId: (prefix) => `${prefix}-${++sequence}`,
		findClip: (project, clipId) => project.clips.find((candidate) => candidate.id === clipId) || null,
		cloneVideoEffects: (effects) => effects.map((effect) => ({ ...structuredClone(effect), id: `video-effect-${++sequence}` })),
		createAddTrackCommand: (value) => ({ type: 'track/add', track: value }),
		createAddClipCommand: (trackId, value) => ({ type: 'clip/add', trackId, clip: value }),
		commit: (command, selection) => { committed = { command, selection }; },
	});

	assert.equal(service.duplicateTrack(track), undefined);
	assert.ok(committed);
	const result = committed as Readonly<{
		command: AudioEditorCommand;
		selection: Readonly<{ selectTrackId: string; selectClipId: string | null }>;
	}>;
	assert.equal(result.command.type, 'batch');
	if (result.command.type !== 'batch') assert.fail('Expected one atomic batch.');
	assert.deepEqual(result.command.commands.map((command) => command.type), ['track/add', 'clip/add']);
	const addTrack = result.command.commands[0];
	const addClip = result.command.commands[1];
	if (addTrack?.type !== 'track/add' || addClip?.type !== 'clip/add') assert.fail('Expected add commands.');
	assert.equal(addTrack.track.id, 'track-1');
	assert.equal(addTrack.track.name, 'Picture copy');
	assert.equal(addTrack.track.armed, false);
	assert.equal(addTrack.track.laneGroupId, null);
	assert.deepEqual(addTrack.productionDuplicate, {
		sourceTrackId: 'video-track',
		effectIds: [{ sourceId: 'rack-effect', targetId: 'effect-2' }],
	});
	assert.deepEqual((addTrack.track.effects as ReadonlyArray<Readonly<Record<string, unknown>>>).map((effect) => effect.id), ['effect-2']);
	assert.equal(addClip.clip.id, 'clip-3');
	assert.equal(addClip.clip.avLinkId, null);
	assert.deepEqual((addClip.clip.videoEffects as ReadonlyArray<Readonly<Record<string, unknown>>>).map((effect) => effect.id), ['video-effect-4']);
	assert.deepEqual(result.selection, { selectTrackId: 'track-1', selectClipId: 'clip-3' });
	assert.equal(track.effects[0]?.id, 'rack-effect');
	assert.equal(clip.videoEffects[0]?.id, 'video-effect');
});

test('track duplication is a no-op while editing is blocked or the track is absent', () => {
	let commits = 0;
	const service = createTrackDuplicationService({
		lifetime: { assertActive: () => undefined },
		copySuffix: 'copy',
		editingBlocked: () => true,
		getProject: () => ({ id: 'project', tracks: [], clips: [] }),
		createId: (prefix) => prefix,
		findClip: () => null,
		cloneVideoEffects: (effects) => effects,
		createAddTrackCommand: (track) => ({ type: 'track/add', track }),
		createAddClipCommand: (trackId, clip) => ({ type: 'clip/add', trackId, clip }),
		commit: () => { commits += 1; },
	});
	service.duplicateTrack(null);
	service.duplicateTrack({ id: 'track', name: 'Track', type: 'audio', clipIds: [] });
	assert.equal(commits, 0);
});

test('track duplication skips missing clips and keeps the first generated clip selected', () => {
	const clips = [
		{ id: 'first', kind: 'video', videoEffects: [] },
		{ id: 'second', kind: 'video' },
	];
	let sequence = 0;
	const batches: AudioEditorCommand[] = [];
	const selections: Readonly<{ selectTrackId: string; selectClipId: string | null }>[] = [];
	const service = createTrackDuplicationService({
		lifetime: { assertActive: () => undefined },
		copySuffix: 'copy',
		editingBlocked: () => false,
		getProject: () => ({ id: 'project', tracks: [], clips }),
		createId: (prefix) => `${prefix}-${++sequence}`,
		findClip: (project, clipId) => project.clips.find((clip) => clip.id === clipId) || null,
		cloneVideoEffects: (effects) => [...effects],
		createAddTrackCommand: (track) => ({ type: 'track/add', track }),
		createAddClipCommand: (trackId, clip) => ({ type: 'clip/add', trackId, clip }),
		commit: (command, selected) => { batches.push(command); selections.push(selected); },
	});

	service.duplicateTrack(null);
	service.duplicateTrack({
		id: 'track', name: 'Track', type: 'video', clipIds: ['missing', 'first', 'second'],
	});
	const batch = batches[0];
	assert.ok(batch);
	assert.equal(batch.type, 'batch');
	if (batch.type !== 'batch') assert.fail('Expected one atomic batch.');
	assert.deepEqual(batch.commands.map((command) => command.type), ['track/add', 'clip/add', 'clip/add']);
	assert.deepEqual(selections[0], { selectTrackId: 'track-1', selectClipId: 'clip-2' });
});
