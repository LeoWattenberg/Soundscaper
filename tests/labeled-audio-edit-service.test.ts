/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createEditorEditService } from '../src/common/editor/controller/edit-service.ts';
import {
	createLabeledAudioEditService,
	isLabeledAudioEditAction,
} from '../src/common/editor/controller/labeled-audio-edit-service.ts';

const COPY = { labeledAudioRequired: 'Select a time range that contains at least one whole label.' };

interface Recorded {
	readonly commits: unknown[];
	readonly clipboards: unknown[];
	readonly splits: unknown[];
	readonly silences: unknown[];
	readonly disjoins: unknown[];
	readonly errors: unknown[];
}

function project() {
	return {
		selection: { startFrame: 0, endFrame: 10_000, trackIds: [] as string[] },
		tracks: [
			{ id: 'audio-1', type: 'audio', clipIds: ['clip-a', 'clip-b'] },
			{ id: 'labels-1', type: 'label', labels: [
				{ id: 'label-1', anchor: 'sample', startFrame: 1_000, endFrame: 2_000 },
				{ id: 'label-2', anchor: 'sample', startFrame: 4_000, endFrame: 5_000 },
			] },
		],
		clips: [
			{ id: 'clip-a', timelineStartFrame: 0, durationFrames: 1_500 },
			{ id: 'clip-b', timelineStartFrame: 1_500, durationFrames: 4_000 },
		],
	};
}

function runtime(overrides: Record<string, unknown> = {}) {
	const document = project();
	const recorded: Recorded = { commits: [], clipboards: [], splits: [], silences: [], disjoins: [], errors: [] };
	const base = {
		copy: COPY,
		state: { selectedTrackId: null as string | null, selectedClipId: 'clip-a' as string | null },
		getProject: () => document,
		activeSelection: () => ({ startFrame: document.selection.startFrame, endFrame: document.selection.endFrame }),
		commit: (command: unknown) => { recorded.commits.push(command); return command; },
		commitSplitAtFrames: (frames: unknown, trackIds: unknown) => {
			recorded.splits.push({ frames, trackIds });
			return null;
		},
		compactLiveSourceState: () => undefined,
		garbageCollectSources: () => Promise.resolve(),
		findClip: (value: typeof document, clipId: string) => value.clips.find((clip) => clip.id === clipId) || null,
		handleError: (error: unknown) => { recorded.errors.push(error); },
		publishDocumentSnapshot: () => undefined,
		setSessionClipboard: (descriptor: unknown) => { recorded.clipboards.push(descriptor); return descriptor; },
		labeledClipboard: {
			create: (regions: readonly { startFrame: number; endFrame: number }[], trackIds: readonly string[]) => ({
				schemaVersion: 2,
				sampleRate: 48_000,
				durationFrames: regions.at(-1)!.endFrame - regions[0]!.startFrame,
				tracks: trackIds.map((sourceTrackId) => ({ sourceTrackId, clips: regions.length })),
			}),
		},
		prepareDisjointRangeDeleteCommand: (_value: unknown, options: unknown) => ({ type: 'range/ripple-delete', options }),
		generateLabeledSilence: (regions: unknown, trackIds: unknown) => {
			recorded.silences.push({ regions, trackIds });
			return Promise.resolve(true);
		},
		disjoinLabeledRegions: (regions: unknown, trackIds: unknown) => {
			recorded.disjoins.push({ regions, trackIds });
			return Promise.resolve(true);
		},
	};
	return { document, recorded, runtime: { ...base, ...overrides } };
}

interface DeleteCommand {
	readonly type: string;
	readonly options: {
		readonly ranges: readonly { startFrame: number; endFrame: number }[];
		readonly rippleMode: string;
		readonly trackIds: readonly string[];
	};
}

/** The delete a labelled edit commits, whether or not it collapsed the selection too. */
function deleteCommand(committed: unknown): DeleteCommand {
	const command = committed as DeleteCommand & { readonly commands?: readonly DeleteCommand[] };
	return command.type === 'batch' ? command.commands![0]! : command;
}

test('the labelled action names are recognised and nothing else is', () => {
	assert.equal(isLabeledAudioEditAction('labeled-cut'), true);
	assert.equal(isLabeledAudioEditAction('labeled-disjoin'), true);
	assert.equal(isLabeledAudioEditAction('cut'), false);
	assert.equal(isLabeledAudioEditAction('labeled'), false);
});

test('cut copies the labelled regions and then closes the gap they leave', () => {
	const { recorded, runtime: dependencies } = runtime();
	createLabeledAudioEditService(dependencies)('labeled-cut');

	assert.equal(recorded.clipboards.length, 1);
	assert.equal(recorded.commits.length, 1);
	const command = deleteCommand(recorded.commits[0]);
	assert.deepEqual(command.options.ranges, [
		{ startFrame: 1_000, endFrame: 2_000 },
		{ startFrame: 4_000, endFrame: 5_000 },
	]);
	assert.equal(command.options.rippleMode, 'track');
	assert.deepEqual(command.options.trackIds, ['audio-1']);
});

test('cut and leave gap keeps the timeline in place, and copy never removes anything', () => {
	const gapped = runtime();
	createLabeledAudioEditService(gapped.runtime)('labeled-split-cut');
	assert.equal(deleteCommand(gapped.recorded.commits[0]).options.rippleMode, 'none');
	assert.equal(gapped.recorded.clipboards.length, 1);

	const copied = runtime();
	createLabeledAudioEditService(copied.runtime)('labeled-copy');
	assert.equal(copied.recorded.clipboards.length, 1);
	assert.deepEqual(copied.recorded.commits, []);
});

test('delete removes without touching the clipboard, in both ripple modes', () => {
	const closing = runtime();
	createLabeledAudioEditService(closing.runtime)('labeled-delete');
	assert.deepEqual(closing.recorded.clipboards, []);
	assert.equal(deleteCommand(closing.recorded.commits[0]).options.rippleMode, 'track');

	const leaving = runtime();
	createLabeledAudioEditService(leaving.runtime)('labeled-split-delete');
	assert.deepEqual(leaving.recorded.clipboards, []);
	assert.equal(deleteCommand(leaving.recorded.commits[0]).options.rippleMode, 'none');
});

test('cut collapses the selection onto its start while leave-gap does not', () => {
	const closing = runtime();
	createLabeledAudioEditService(closing.runtime)('labeled-cut');
	const batch = closing.recorded.commits[0] as { type: string; commands: { type: string; startFrame: number; endFrame: number }[] };
	assert.equal(batch.type, 'batch');
	const selection = batch.commands.at(-1)!;
	assert.equal(selection.type, 'selection/set');
	assert.equal(selection.startFrame, 0);
	assert.equal(selection.endFrame, 0);

	const leaving = runtime();
	createLabeledAudioEditService(leaving.runtime)('labeled-split-delete');
	assert.equal((leaving.recorded.commits[0] as { type: string }).type, 'range/ripple-delete');
});

test('split cuts at every labelled boundary on the tracks being edited', () => {
	const { recorded, runtime: dependencies } = runtime();
	createLabeledAudioEditService(dependencies)('labeled-split');
	assert.deepEqual(recorded.splits, [{ frames: [1_000, 2_000, 4_000, 5_000], trackIds: ['audio-1'] }]);
});

test('join joins only the clips that already touch inside a label', () => {
	const { recorded, runtime: dependencies } = runtime();
	createLabeledAudioEditService(dependencies)('labeled-join');
	assert.deepEqual(recorded.commits, [{ type: 'clip/join', clipIds: ['clip-a', 'clip-b'] }]);
});

test('silence and detach hand their spans to the services that own them', () => {
	const silenced = runtime();
	void createLabeledAudioEditService(silenced.runtime)('labeled-silence');
	assert.deepEqual(silenced.recorded.silences, [{
		regions: [{ startFrame: 1_000, endFrame: 2_000 }, { startFrame: 4_000, endFrame: 5_000 }],
		trackIds: ['audio-1'],
	}]);

	const detached = runtime();
	void createLabeledAudioEditService(detached.runtime)('labeled-disjoin');
	assert.deepEqual(detached.recorded.disjoins, [{
		regions: [{ startFrame: 1_000, endFrame: 2_000 }, { startFrame: 4_000, endFrame: 5_000 }],
		trackIds: ['audio-1'],
	}]);
});

test('a selection with no whole label refuses the edit with the labelled requirement', () => {
	const { document, recorded, runtime: dependencies } = runtime();
	document.selection.startFrame = 1_500;
	document.selection.endFrame = 3_500;
	createLabeledAudioEditService(dependencies)('labeled-cut');
	assert.deepEqual(recorded.commits, []);
	assert.deepEqual(recorded.clipboards, []);
	assert.equal((recorded.errors[0] as Error).message, COPY.labeledAudioRequired);
});

test('the edit service routes labelled actions and leaves the rest alone', () => {
	const seen: string[] = [];
	const handleEdit = createEditorEditService({
		editingBlocked: () => false,
		state: { history: {}, videoEffectGestures: new Map() },
		copy: COPY,
		getProject: () => ({ tracks: [], selection: null }),
		activeSelection: () => null,
		handleError: (error: unknown) => { seen.push((error as Error).message); },
	});
	handleEdit('labeled-cut');
	assert.deepEqual(seen, [COPY.labeledAudioRequired]);
});
