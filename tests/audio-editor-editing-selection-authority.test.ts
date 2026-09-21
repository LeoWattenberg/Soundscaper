/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	resolveEditingActionAvailability,
	resolveEditingSelectionAuthority,
} from '../src/common/editor/commands/editing-selection-authority.ts';
import { resolveEditingSelection } from '../src/common/editor/commands/clip-basic-runtime.js';
import { canJoinClips } from '../src/common/editor/commands/clip-link-runtime.js';
import { createEditorEditService } from '../src/common/editor/controller/edit/internal/edit-service.ts';
import {
	evaluateAudacityActionEnablement,
} from '../src/common/editor/audacity-action-parity.js';
import { resolveAudacityActionSelectionFacts } from '../src/common/editor/audacity-action-enablement.ts';
import { createWorkspaceEditItems } from '../src/common/editor/ui/workspace/workspace-edit-items.js';

interface ClipOptions {
	readonly avLinkId?: string | null;
	readonly groupId?: string | null;
	readonly kind?: 'audio' | 'video';
	readonly sourceId?: string;
	readonly sourceStartFrame?: number;
}

function clip(id: string, timelineStartFrame: number, options: ClipOptions = {}) {
	return {
		id,
		kind: options.kind ?? 'audio',
		sourceId: options.sourceId ?? `${options.kind ?? 'audio'}-source`,
		timelineStartFrame,
		durationFrames: 100,
		sourceStartFrame: options.sourceStartFrame ?? timelineStartFrame,
		sourceDurationFrames: 100,
		groupId: options.groupId ?? null,
		avLinkId: options.avLinkId ?? null,
		gain: 1,
		reversed: false,
	};
}

function project() {
	return {
		schemaVersion: 12,
		clips: [
			clip('group-audio', 0, { groupId: 'edit-group' }),
			clip('group-video', 0, { kind: 'video', groupId: 'edit-group', avLinkId: 'link-one' }),
			clip('linked-audio', 0, { avLinkId: 'link-one' }),
			clip('focus-only', 300),
		],
		tracks: [
			{ id: 'video-track', type: 'video', laneGroupId: 'media-lane', clipIds: ['group-video'] },
			{ id: 'audio-track', type: 'audio', laneGroupId: 'media-lane', clipIds: ['group-audio', 'linked-audio', 'focus-only'] },
			{ id: 'labels', type: 'label', labels: [] },
		],
		selection: {
			startFrame: 0,
			endFrame: 0,
			trackIds: ['missing-track', 'video-track', 'video-track'],
			clipIds: ['missing-clip', 'group-audio', 'group-audio'],
		},
	};
}

test('valid persisted targets win, deduplicate, and close groups and A/V links transitively', () => {
	const value = project();
	const authority = resolveEditingSelectionAuthority({
		project: value,
		focusedClipId: 'focus-only',
		focusedTrackId: 'audio-track',
	});
	assert.deepEqual(authority.seedClipIds, ['group-audio']);
	assert.deepEqual(authority.clipIds, ['group-audio', 'group-video', 'linked-audio']);
	assert.deepEqual(authority.trackIds, ['video-track']);
	assert.equal(authority.clipSource, 'persisted');
	assert.equal(authority.trackSource, 'persisted');

	const editing = resolveEditingSelection(value, { selectedClipId: 'focus-only' });
	assert.equal(editing?.kind, 'clips');
	assert.deepEqual(editing?.clipIds, authority.clipIds);
});

test('stale persisted targets fall back to focus independently of valid persisted target kinds', () => {
	const value = project();
	value.selection = {
		startFrame: 0,
		endFrame: 0,
		trackIds: ['missing-track'],
		clipIds: ['missing-clip'],
	};
	const fallback = resolveEditingSelectionAuthority({
		project: value,
		focusedClipId: 'focus-only',
		focusedTrackId: 'audio-track',
	});
	assert.deepEqual(fallback.clipIds, ['focus-only']);
	assert.deepEqual(fallback.trackIds, ['audio-track']);
	assert.equal(fallback.clipSource, 'focus');
	assert.equal(fallback.trackSource, 'focus');

	value.selection.clipIds = ['group-audio', 'missing-clip'];
	const persisted = resolveEditingSelectionAuthority({
		project: value,
		focusedClipId: 'focus-only',
		focusedTrackId: 'audio-track',
	});
	assert.equal(persisted.clipSource, 'persisted');
	assert.equal(persisted.clipIds.includes('focus-only'), false);
	assert.deepEqual(persisted.trackIds, ['audio-track'], 'each target kind falls back independently');
	assert.equal(persisted.trackSource, 'focus');
});

test('valid explicit command targets take precedence over persisted selection and focus', () => {
	const value = project();
	const authority = resolveEditingSelectionAuthority({
		project: value,
		explicitClipIds: ['focus-only', 'focus-only', 'missing-clip'],
		explicitTrackIds: ['audio-track', 'audio-track', 'missing-track'],
		focusedClipId: 'group-audio',
		focusedTrackId: 'video-track',
	});
	assert.equal(authority.clipSource, 'explicit');
	assert.equal(authority.trackSource, 'explicit');
	assert.deepEqual(authority.clipIds, ['focus-only']);
	assert.deepEqual(authority.trackIds, ['audio-track']);
});

test('a positive time range suppresses clip focus and persisted clip targets', () => {
	const value = project();
	value.selection = {
		startFrame: 20,
		endFrame: 80,
		trackIds: ['audio-track'],
		clipIds: ['group-audio'],
	};
	const authority = resolveEditingSelectionAuthority({ project: value, focusedClipId: 'focus-only' });
	assert.deepEqual(authority.clipIds, []);
	assert.deepEqual(authority.trackIds, ['audio-track']);
	assert.deepEqual(authority.range, { startFrame: 20, endFrame: 80 });
	assert.equal(authority.editSelectionActive, true);
});

test('split, group, and ungroup availability use the same effective targets', () => {
	const value = project();
	const availability = resolveEditingActionAvailability({
		project: value,
		focusedClipId: 'focus-only',
		focusedTrackId: 'audio-track',
	});
	assert.equal(availability.split, true, 'a selected video track participates in Split');
	assert.equal(availability.group, true, 'the expanded selection contains multiple clips');
	assert.equal(availability.ungroup, true, 'the expanded selection contains a grouped clip');
	assert.equal(availability.join, false, 'one linked A/V segment is not a joinable run');

	value.selection.clipIds = [];
	value.selection.trackIds = ['video-track'];
	const trackOnly = resolveEditingActionAvailability({ project: value });
	assert.equal(trackOnly.split, true);
	assert.equal(trackOnly.editSelectionActive, false);
	assert.equal(evaluateAudacityActionEnablement('split', {
		snapshot: { project: value, selectedClipId: null, selectedTrackId: null, readOnly: false },
	}), true);
});

test('toolbar and shortcut predicates consume the same selection authority', () => {
	const value = project();
	const snapshot = {
		project: value,
		selectedClipId: 'focus-only',
		selectedTrackId: 'audio-track',
		readOnly: false,
	};
	const facts = resolveAudacityActionSelectionFacts(snapshot);
	assert.deepEqual(facts.selectedClipIds, ['group-audio', 'group-video', 'linked-audio']);
	assert.equal(evaluateAudacityActionEnablement('split', { snapshot }), true);
	assert.equal(evaluateAudacityActionEnablement('group-clips', { snapshot }), true);
	assert.equal(evaluateAudacityActionEnablement('ungroup-clips', { snapshot }), true);
	assert.equal(evaluateAudacityActionEnablement('join', { snapshot }), false);

	const availability = resolveEditingActionAvailability({
		project: value,
		focusedClipId: snapshot.selectedClipId,
		focusedTrackId: snapshot.selectedTrackId,
	});
	const split = createWorkspaceEditItems({
		copy: { split: 'Split' },
		editBlocked: false,
		editSelectionActive: availability.editSelectionActive,
		hasClipboard: false,
		splitAvailable: availability.split,
	}).find(({ action }) => action === 'split');
	assert.equal(split?.disabled, false);
});

test('Join preflight is the command validator and admits complete adjacent linked lanes', () => {
	const clips = [
		clip('video-a', 0, { kind: 'video', avLinkId: 'link-a', sourceStartFrame: 0 }),
		clip('video-b', 100, { kind: 'video', avLinkId: 'link-b', sourceStartFrame: 100 }),
		clip('audio-a', 0, { avLinkId: 'link-a', sourceStartFrame: 0 }),
		clip('audio-b', 100, { avLinkId: 'link-b', sourceStartFrame: 100 }),
	];
	const value = {
		schemaVersion: 17,
		clips,
		tracks: [
			{ id: 'video', type: 'video', laneGroupId: 'lane', clipIds: ['video-a', 'video-b'] },
			{ id: 'audio', type: 'audio', laneGroupId: 'lane', clipIds: ['audio-a', 'audio-b'] },
		],
		selection: { startFrame: 0, endFrame: 0, trackIds: [], clipIds: clips.map(({ id }) => id) },
	};
	assert.equal(canJoinClips(value, ['video-a', 'audio-a']), false);
	assert.equal(canJoinClips(value, value.selection.clipIds), true);
	assert.equal(resolveEditingActionAvailability({ project: value }).join, true);

	value.clips[1] = { ...value.clips[1], timelineStartFrame: 101 };
	assert.equal(canJoinClips(value, value.selection.clipIds), false);
	assert.equal(resolveEditingActionAvailability({ project: value }).join, false);
});

test('controller execution obeys the same Join, Group, and Ungroup gates as every surface', () => {
	const invalidJoin = project();
	assert.equal(resolveEditingActionAvailability({ project: invalidJoin }).join, false);
	assert.deepEqual(executeControllerEdit(invalidJoin, 'join'), []);

	const joinable = project();
	joinable.schemaVersion = 17;
	joinable.clips.splice(0, joinable.clips.length,
		clip('video-a', 0, { kind: 'video', avLinkId: 'link-a', sourceStartFrame: 0 }),
		clip('video-b', 100, { kind: 'video', avLinkId: 'link-b', sourceStartFrame: 100 }),
		clip('audio-a', 0, { avLinkId: 'link-a', sourceStartFrame: 0 }),
		clip('audio-b', 100, { avLinkId: 'link-b', sourceStartFrame: 100 }),
	);
	joinable.tracks.splice(0, joinable.tracks.length,
		{ id: 'video-track', type: 'video', laneGroupId: 'lane', clipIds: ['video-a', 'video-b'] },
		{ id: 'audio-track', type: 'audio', laneGroupId: 'lane', clipIds: ['audio-a', 'audio-b'] },
	);
	joinable.selection.clipIds = joinable.clips.map(({ id }) => id);
	joinable.selection.trackIds = [];
	assert.equal(resolveEditingActionAvailability({ project: joinable }).join, true);
	assert.deepEqual(executeControllerEdit(joinable, 'join'), [{
		type: 'clip/join', clipIds: ['video-a', 'video-b', 'audio-a', 'audio-b'],
	}]);

	const ungrouped = project();
	ungrouped.selection.clipIds = ['focus-only'];
	assert.equal(resolveEditingActionAvailability({ project: ungrouped }).ungroup, false);
	assert.deepEqual(executeControllerEdit(ungrouped, 'ungroup'), []);

	const grouped = project();
	assert.equal(resolveEditingActionAvailability({ project: grouped }).ungroup, true);
	assert.deepEqual(executeControllerEdit(grouped, 'ungroup'), [{
		type: 'clip/ungroup', clipIds: ['group-audio', 'group-video', 'linked-audio'],
	}]);

	const single = project();
	single.selection.clipIds = ['focus-only'];
	assert.equal(resolveEditingActionAvailability({ project: single }).group, false);
	assert.deepEqual(executeControllerEdit(single, 'group'), []);
	assert.equal(resolveEditingActionAvailability({ project: grouped }).group, true);
	assert.deepEqual(executeControllerEdit(grouped, 'group'), [{
		type: 'clip/group', clipIds: ['group-audio', 'group-video', 'linked-audio'], groupId: 'group-created',
	}]);
});

function executeControllerEdit(value: ReturnType<typeof project>, action: string): readonly unknown[] {
	const commands: unknown[] = [];
	const findClip = (_project: unknown, clipId: string) => value.clips.find(({ id }) => id === clipId) ?? null;
	const findTrack = (_project: unknown, trackId: string | null) => (
		value.tracks.find(({ id }) => id === trackId) ?? null
	);
	const findClipTrack = (_project: unknown, clipId: string) => (
		value.tracks.find((track) => Array.isArray(track.clipIds) && track.clipIds.includes(clipId)) ?? null
	);
	const state = {
		history: {},
		selectedClipId: null,
		selectedTrackId: null,
		preferences: {},
		videoEffectGestures: new Map(),
	};
	const handleEdit = createEditorEditService({
		activeSelection: () => null,
		commit: (command: unknown) => { commands.push(command); },
		copy: {},
		editingBlocked: () => false,
		findClip,
		findClipTrack,
		findTrack,
		getProject: () => value,
		handleError: (error: unknown) => { throw error; },
		prepareGroupClipsCommand: (clipIds: readonly string[]) => ({
			type: 'clip/group', clipIds, groupId: 'group-created',
		}),
		resolveEditingSelection,
		state,
	});
	handleEdit(action);
	return commands;
}
