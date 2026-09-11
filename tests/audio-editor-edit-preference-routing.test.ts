/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createEditorEditService } from '../src/common/editor/controller/edit/internal/edit-service.ts';

type DeleteCommand = Readonly<{
	type: 'range/delete';
	options: Readonly<{
		startFrame: number;
		endFrame: number;
		trackIds: readonly string[];
		rippleMode: 'none' | 'clip' | 'track';
	}>;
}>;

function harness(editing: Readonly<Record<string, unknown>>, options: Readonly<{
	selectedClip?: boolean;
	selectedClipIds?: readonly string[];
	selectedTrackIds?: readonly string[];
	trackOnly?: boolean;
	labelOnly?: boolean;
	videoClip?: boolean;
	clipboard?: boolean;
	onboardDeleteBehavior?: (
		action: 'cut' | 'delete',
		apply: (action: string) => unknown,
	) => PromiseLike<unknown> | unknown;
}> = {}) {
	const selectedClipIds = options.selectedClipIds
		?? (options.videoClip ? ['video-clip'] : options.selectedClip ? ['clip-a'] : []);
	const selectedTrackIds = options.selectedTrackIds ?? ['audio-a'];
	const project = {
		selection: options.trackOnly ? {
			startFrame: 0,
			endFrame: 0,
			trackIds: selectedTrackIds,
			clipIds: [],
		} : selectedClipIds.length ? null : {
			startFrame: 100,
			endFrame: 200,
			trackIds: [options.labelOnly ? 'labels' : 'audio-a'],
		},
		tracks: [
			{ id: 'audio-a', type: 'audio', clipIds: ['clip-a'] },
			{ id: 'labels', type: 'label', labels: [] },
			{ id: 'audio-b', type: 'audio', clipIds: ['clip-b'] },
			...(options.videoClip ? [{ id: 'video-track', type: 'video', clipIds: ['video-clip'] }] : []),
		],
		clips: [
			{ id: 'clip-a', timelineStartFrame: 100, durationFrames: 100, sourceId: 'source-a' },
			{ id: 'clip-b', timelineStartFrame: 400, durationFrames: 100, sourceId: 'source-b' },
			...(options.videoClip ? [{
				id: 'video-clip', kind: 'video', timelineStartFrame: 600,
				durationFrames: 100, sourceId: 'video-source',
			}] : []),
		],
	};
	const commits: unknown[] = [];
	const clipboardDescriptors: unknown[] = [];
	const preparedPasteCommits: unknown[] = [];
	const pastedModes: string[] = [];
	const pasteAsNewClipValues: boolean[] = [];
	const onboardingRequests: string[] = [];
	const state = {
		history: {},
		videoEffectGestures: new Map(),
		selectedTrackId: options.labelOnly ? 'labels' : options.videoClip ? 'video-track' : 'audio-a',
		selectedClipId: selectedClipIds[0] ?? null,
		clipboard: (options.clipboard === false ? null : {}) as unknown,
		preferences: { editing },
	};
	const handleEdit = createEditorEditService({
		activeSelection: () => options.trackOnly ? null : project.selection,
		commit: (command: unknown) => { commits.push(command); return command; },
		compactLiveSourceState: () => undefined,
		copy: { timeSelectionRequired: 'Select audio.' },
		createClipboardDescriptor: (_value: unknown, descriptorOptions: unknown) => {
			clipboardDescriptors.push(descriptorOptions);
			return { schemaVersion: 2 };
		},
		editingBlocked: () => false,
		findClip: (value: typeof project, id: string) => value.clips.find((clip) => clip.id === id) ?? null,
		findClipTrack: (value: typeof project, id: string) => value.tracks.find((track) => track.clipIds?.includes(id)) ?? null,
		findTrack: (value: typeof project, id: string | null) => value.tracks.find((track) => track.id === id) ?? null,
		garbageCollectSources: () => Promise.resolve(),
		getProject: () => project,
		handleError: (error: unknown) => { throw error; },
		prepareControllerPaste: (mode: string, _atFrame?: number, pasteAsNewClip = true) => {
			pastedModes.push(mode);
			pasteAsNewClipValues.push(pasteAsNewClip);
			return { type: 'clipboard/paste', mode };
		},
		commitPreparedPaste: (command: unknown) => { preparedPasteCommits.push(command); return command; },
		prepareDisjointRangeDeleteCommand: (_value: unknown, deleteOptions: unknown) => ({
			type: 'range/delete', options: deleteOptions,
		}),
		prepareRangeDeleteCommand: (_value: unknown, deleteOptions: unknown) => ({
			type: 'range/delete', options: deleteOptions,
		}),
		requestDeleteBehaviorChoice: (action: 'cut' | 'delete', apply: (action: string) => unknown) => {
			onboardingRequests.push(action);
			return options.onboardDeleteBehavior?.(action, apply) ?? null;
		},
		publishDocumentSnapshot: () => undefined,
		resolveEditingSelection: () => selectedClipIds.length ? {
			kind: 'clips',
			clipIds: selectedClipIds,
			startFrame: 100,
			endFrame: selectedClipIds.length > 1 ? 500 : 200,
			ranges: selectedClipIds.length > 1
				? [{ startFrame: 100, endFrame: 200 }, { startFrame: 400, endFrame: 500 }]
				: [{ startFrame: 100, endFrame: 200 }],
		} : null,
		setSessionClipboard: (clipboard: unknown) => { state.clipboard = clipboard; },
		state,
	});
	return {
		clipboardDescriptors,
		commits,
		handleEdit,
		onboardingRequests,
		pastedModes,
		pasteAsNewClipValues,
		preparedPasteCommits,
		state,
	};
}

function committedDelete(value: unknown): DeleteCommand {
	return value as DeleteCommand;
}

test('generic cut and delete route Audacity delete preferences while explicit variants remain explicit', () => {
	for (const action of ['cut', 'delete']) {
		const leaving = harness({ deleteBehavior: 'leave-gap', closeGapBehavior: 'all-tracks' });
		leaving.handleEdit(action);
		assert.equal(committedDelete(leaving.commits[0]).options.rippleMode, 'none', action);

		const closingClip = harness({ deleteBehavior: 'close-gap', closeGapBehavior: 'clip' });
		closingClip.handleEdit(action);
		assert.deepEqual(committedDelete(closingClip.commits[0]).options, {
			startFrame: 100, endFrame: 200, trackIds: ['audio-a'], rippleMode: 'clip',
		}, action);

		const closingTrack = harness({ deleteBehavior: 'close-gap', closeGapBehavior: 'track' });
		closingTrack.handleEdit(action);
		assert.deepEqual(committedDelete(closingTrack.commits[0]).options.trackIds, ['audio-a'], action);
		assert.equal(committedDelete(closingTrack.commits[0]).options.rippleMode, 'track', action);

		const closingAll = harness({ deleteBehavior: 'close-gap', closeGapBehavior: 'all-tracks' });
		closingAll.handleEdit(action);
		assert.deepEqual(committedDelete(closingAll.commits[0]).options.trackIds, ['audio-a', 'audio-b'], action);
		assert.equal(committedDelete(closingAll.commits[0]).options.rippleMode, 'track', action);
	}

	const explicitLeave = harness({ deleteBehavior: 'close-gap', closeGapBehavior: 'all-tracks' });
	explicitLeave.handleEdit('delete-leave-gap');
	assert.equal(committedDelete(explicitLeave.commits[0]).options.rippleMode, 'none');
	assert.deepEqual(committedDelete(explicitLeave.commits[0]).options.trackIds, ['audio-a']);

	const explicitClip = harness({ deleteBehavior: 'leave-gap', closeGapBehavior: 'clip' });
	explicitClip.handleEdit('delete-per-clip-ripple');
	assert.equal(committedDelete(explicitClip.commits[0]).options.rippleMode, 'clip');
});

test('generic delete applies an all-track close-gap preference to a selected clip', () => {
	const selected = harness({ deleteBehavior: 'close-gap', closeGapBehavior: 'all-tracks' }, { selectedClip: true });
	selected.handleEdit('delete');

	assert.deepEqual(committedDelete(selected.commits[0]).options, {
		startFrame: 100,
		endFrame: 200,
		trackIds: ['audio-a', 'audio-b'],
		rippleMode: 'track',
	});
});

test('all-track ripple cut copies and removes the complete selected-item span on every audio track', () => {
	const selected = harness(
		{ deleteBehavior: 'close-gap', closeGapBehavior: 'all-tracks' },
		{ selectedClipIds: ['clip-a', 'clip-b'] },
	);
	selected.handleEdit('cut');

	assert.deepEqual(selected.clipboardDescriptors, [{
		startFrame: 100,
		endFrame: 500,
		trackIds: ['audio-a', 'audio-b'],
	}]);
	assert.deepEqual(committedDelete(selected.commits[0]).options, {
		startFrame: 100,
		endFrame: 500,
		trackIds: ['audio-a', 'audio-b'],
		rippleMode: 'track',
	});
});

test('all-track ripple delete collapses one bounding span rather than disjoint clip ranges', () => {
	const selected = harness(
		{ deleteBehavior: 'close-gap', closeGapBehavior: 'all-tracks' },
		{ selectedClipIds: ['clip-a', 'clip-b'] },
	);
	selected.handleEdit('delete');

	assert.deepEqual(committedDelete(selected.commits[0]).options, {
		startFrame: 100,
		endFrame: 500,
		trackIds: ['audio-a', 'audio-b'],
		rippleMode: 'track',
	});
});

test('generic Delete removes a selected track when no time or clip selection exists', () => {
	const selected = harness(
		{ deleteBehavior: 'close-gap', closeGapBehavior: 'all-tracks' },
		{ trackOnly: true },
	);
	selected.handleEdit('delete');

	assert.deepEqual(selected.commits, [{ type: 'track/remove', trackId: 'audio-a' }]);
});

test('generic Delete removes every selected track in one atomic batch', () => {
	const selected = harness(
		{ deleteBehavior: 'leave-gap' },
		{ trackOnly: true, selectedTrackIds: ['audio-a', 'labels', 'audio-b'] },
	);
	selected.handleEdit('delete');

	assert.deepEqual(selected.commits, [{
		type: 'batch',
		commands: [
			{ type: 'track/remove', trackId: 'audio-a' },
			{ type: 'track/remove', trackId: 'labels' },
			{ type: 'track/remove', trackId: 'audio-b' },
		],
	}]);
	assert.equal(selected.state.selectedTrackId, null);
	assert.equal(selected.state.selectedClipId, null);
});

test('fresh generic Cut and Delete use Leave gap without triggering onboarding', () => {
	for (const action of ['cut', 'delete'] as const) {
		const selected = harness(
			{ deleteBehavior: 'not-set', closeGapBehavior: 'clip' },
			{
				onboardDeleteBehavior: () => { throw new Error('must not prompt'); },
			},
		);

		selected.handleEdit(action);
		assert.equal(committedDelete(selected.commits[0]).options.rippleMode, 'none');
		assert.deepEqual(selected.onboardingRequests, []);
		assert.equal(selected.clipboardDescriptors.length, action === 'cut' ? 1 : 0);
	}

	const video = harness(
		{ deleteBehavior: 'not-set' },
		{ videoClip: true, onboardDeleteBehavior: () => { throw new Error('must not prompt'); } },
	);
	video.handleEdit('delete');
	assert.deepEqual(video.onboardingRequests, []);
	assert.deepEqual(video.commits, [{
		type: 'clip/remove-many', clipIds: ['video-clip'], rippleMode: 'none',
	}]);
});

test('track-only and label-only edits never enter delete onboarding', () => {
	const trackDelete = harness(
		{ deleteBehavior: 'not-set' },
		{ trackOnly: true, onboardDeleteBehavior: () => { throw new Error('must not prompt'); } },
	);
	trackDelete.handleEdit('delete');
	assert.deepEqual(trackDelete.commits, [{ type: 'track/remove', trackId: 'audio-a' }]);
	assert.deepEqual(trackDelete.onboardingRequests, []);

	const trackCut = harness(
		{ deleteBehavior: 'not-set' },
		{ trackOnly: true, onboardDeleteBehavior: () => { throw new Error('must not prompt'); } },
	);
	assert.throws(() => trackCut.handleEdit('cut'), /Select audio/u);
	assert.deepEqual(trackCut.onboardingRequests, []);

	for (const action of ['cut', 'delete'] as const) {
		const labelOnly = harness(
			{ deleteBehavior: 'not-set' },
			{ labelOnly: true, onboardDeleteBehavior: () => { throw new Error('must not prompt'); } },
		);
		labelOnly.handleEdit(action);
		assert.deepEqual(labelOnly.onboardingRequests, []);
		assert.deepEqual(labelOnly.commits, []);
		assert.deepEqual(labelOnly.clipboardDescriptors, []);
	}
});

test('configured generic Cut and Delete never reinterpret a label-only range as all audio', () => {
	for (const editing of [
		{ deleteBehavior: 'leave-gap' },
		{ deleteBehavior: 'close-gap', closeGapBehavior: 'all-tracks' },
	]) {
		for (const action of ['cut', 'delete']) {
			const labelOnly = harness(editing, { labelOnly: true });
			labelOnly.handleEdit(action);
			assert.deepEqual(labelOnly.commits, [], `${action}: ${editing.deleteBehavior}`);
			assert.deepEqual(labelOnly.clipboardDescriptors, [], `${action}: ${editing.deleteBehavior}`);
		}
	}
});

test('generic paste routes Audacity overlap and insert preferences while explicit variants remain explicit', () => {
	const cases = [
		[{ pasteBehavior: 'overlap', pasteInsertBehavior: 'all-tracks' }, 'overlap'],
		[{ pasteBehavior: 'insert', pasteInsertBehavior: 'track' }, 'insert-track'],
		[{ pasteBehavior: 'insert', pasteInsertBehavior: 'all-tracks' }, 'insert-all'],
	] as const;
	for (const [editing, expected] of cases) {
		const paste = harness(editing);
		paste.handleEdit('paste');
		assert.deepEqual(paste.pastedModes, [expected]);
		assert.equal(paste.preparedPasteCommits.length, 1);
	}

	const explicit = harness({ pasteBehavior: 'insert', pasteInsertBehavior: 'all-tracks' });
	explicit.handleEdit('paste-overlap');
	explicit.handleEdit('paste-insert');
	explicit.handleEdit('paste-all-tracks-ripple');
	assert.deepEqual(explicit.pastedModes, ['overlap', 'insert-track', 'insert-all']);
});

test('paste routes the new-clip preference while duplicate always makes a distinct clip', () => {
	const merging = harness({ alwaysPasteAsNewClip: false });
	merging.handleEdit('paste');
	assert.deepEqual(merging.pasteAsNewClipValues, [false]);

	const distinct = harness({ alwaysPasteAsNewClip: true });
	distinct.handleEdit('paste-overlap');
	assert.deepEqual(distinct.pasteAsNewClipValues, [true]);
});
