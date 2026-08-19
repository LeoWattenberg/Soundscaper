/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	applyEditorCommand,
	createClipboardDescriptor,
	preparePasteCommand,
} from '../src/common/editor/commands.js';
import {
	collectAudioEditorClipboardSourceIds,
	normalizeAudioEditorClipboardDescriptor,
} from '../src/common/editor/commands/clipboard-codec.ts';
import type { AudioEditorClipboard, AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import {
	prepareTakeCompClipboardPasteIds,
	stageTakeCompClipboardPaste,
} from '../src/common/editor/commands/take-comp-clipboard.ts';
import { createAudioSourceV10, createAudioTrackV10 } from '../src/common/editor/project-v10.ts';
import { createAudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';
import { createAudioEditorSessionClipboard } from '../src/common/editor/session-clipboard-codec.ts';

const NOW = '2026-08-12T12:00:00.000Z';

function project() {
	return createAudioEditorProjectV17({
		id: 'take-clipboard-project', title: 'Take clipboard project', now: NOW,
		sources: [
			createAudioSourceV10({
				id: 'take-source-a', storageKey: 'take-source-a', name: 'Take A',
				frameCount: 2_000, channelCount: 1, sampleRate: 48_000,
			}),
			createAudioSourceV10({
				id: 'take-source-b', storageKey: 'take-source-b', name: 'Take B',
				frameCount: 2_000, channelCount: 1, sampleRate: 48_000,
			}),
		],
		tracks: [createAudioTrackV10({ id: 'track-a', name: 'Vocal', clipIds: [] })],
		sequences: [{ id: 'main-sequence', trackIds: ['track-a'] }],
		primarySequenceId: 'main-sequence',
		takeGroups: [{
			id: 'group-a', sequenceId: 'main-sequence', trackId: 'track-a',
			startSample: 100, endSample: 500,
			laneOrder: ['lane-a', 'lane-b'],
			lanes: [{ id: 'lane-a' }, { id: 'lane-b' }],
			takes: [
				{
					id: 'take-a', laneId: 'lane-a', sourceId: 'take-source-a',
					startSample: 100, endSample: 500, sourceStartSample: 10,
				},
				{
					id: 'take-b', laneId: 'lane-b', sourceId: 'take-source-b',
					startSample: 125, endSample: 475, sourceStartSample: 20,
				},
			],
			compRegions: [
				{ id: 'region-a', takeId: 'take-a', startSample: 100, endSample: 300 },
				{ id: 'region-b', takeId: 'take-b', startSample: 300, endSample: 475 },
			],
		}],
	});
}

function idFactory() {
	const counts = new Map<string, number>();
	return (prefix = 'id'): string => {
		const count = (counts.get(prefix) || 0) + 1;
		counts.set(prefix, count);
		return `${prefix}-copy-${String(count)}`;
	};
}

test('V17 range copy clips take geometry and retains take-owned session source roots', () => {
	const clipboard = createClipboardDescriptor(project(), {
		startFrame: 150, endFrame: 450, trackIds: ['track-a'],
	});
	assert.equal(clipboard.schemaVersion, 4);
	assert.deepEqual(clipboard.takeGroups, [{
		key: 'group-a', sourceSequenceId: 'main-sequence', sourceTrackId: 'track-a',
		startOffsetFrame: 0, endOffsetFrame: 300,
		laneOrder: ['lane-a', 'lane-b'],
		lanes: [{ key: 'lane-a' }, { key: 'lane-b' }],
		takes: [
			{
				key: 'take-a', laneKey: 'lane-a', sourceId: 'take-source-a',
				startOffsetFrame: 0, endOffsetFrame: 300, sourceStartFrame: 60,
			},
			{
				key: 'take-b', laneKey: 'lane-b', sourceId: 'take-source-b',
				startOffsetFrame: 0, endOffsetFrame: 300, sourceStartFrame: 45,
			},
		],
		compRegions: [
			{ key: 'region-a', takeKey: 'take-a', startOffsetFrame: 0, endOffsetFrame: 150 },
			{ key: 'region-b', takeKey: 'take-b', startOffsetFrame: 150, endOffsetFrame: 300 },
		],
	}]);
	assert.deepEqual(collectAudioEditorClipboardSourceIds(clipboard), [
		'take-source-a', 'take-source-b',
	]);
	const session = createAudioEditorSessionClipboard(project(), { descriptor: clipboard });
	assert.deepEqual(session.sources.map(({ id }) => id), ['take-source-a', 'take-source-b']);
});

test('one serializable paste restores a canonical, independently identified take graph', () => {
	const source = project();
	const clipboard = createClipboardDescriptor(source, {
		startFrame: 150, endFrame: 450, trackIds: ['track-a'],
	});
	const command = preparePasteCommand(clipboard, {
		atFrame: 600, project: source,
	}, idFactory());
	const pasted = applyEditorCommand(source, command as AudioEditorCommand, { now: NOW });
	assert.equal(pasted.revision, source.revision + 1);
	assert.equal(pasted.takeGroups.length, 2);
	assert.deepEqual(pasted.takeGroups[1], {
		id: 'take-group-copy-1', sequenceId: 'main-sequence', trackId: 'track-a',
		startSample: 600, endSample: 900,
		laneOrder: ['take-lane-copy-1', 'take-lane-copy-2'],
		lanes: [{ id: 'take-lane-copy-1' }, { id: 'take-lane-copy-2' }],
		takes: [
			{
				id: 'take-copy-1', laneId: 'take-lane-copy-1', sourceId: 'take-source-a',
				startSample: 600, endSample: 900, sourceStartSample: 60,
			},
			{
				id: 'take-copy-2', laneId: 'take-lane-copy-2', sourceId: 'take-source-b',
				startSample: 600, endSample: 900, sourceStartSample: 45,
			},
		],
		compRegions: [
			{ id: 'comp-region-copy-1', takeId: 'take-copy-1', startSample: 600, endSample: 750 },
			{ id: 'comp-region-copy-2', takeId: 'take-copy-2', startSample: 750, endSample: 900 },
		],
	});
	assert.deepEqual(source.takeGroups.map(({ id }) => id), ['group-a']);
});

test('a take comp is not pasted into a project at another sample rate', () => {
	// A take states no source length of its own: what it reads is defined by its
	// timeline extent. Scaling that extent for another project rate therefore
	// rewrites which audio the comp covers — silently when the scaled span still
	// fits the source, and as an internal "exceeds source bounds" failure of the
	// whole paste when it does not. Conforming the take's media is a larger
	// contract than a paste, so the paste refuses and says what to do instead.
	const target = structuredClone(project()) as unknown as Record<string, unknown>;
	const clipboard = {
		schemaVersion: 4,
		takeGroups: [{
			key: 'group-a', sourceSequenceId: 'main-sequence', sourceTrackId: 'track-a',
			startOffsetFrame: 0, endOffsetFrame: 5,
			laneOrder: ['lane-a'],
			lanes: [{ key: 'lane-a' }],
			takes: [{
				key: 'take-a', laneKey: 'lane-a', sourceId: 'take-source-a',
				startOffsetFrame: 0, endOffsetFrame: 5, sourceStartFrame: 0,
			}],
			compRegions: [
				{ key: 'region-a', takeKey: 'take-a', startOffsetFrame: 0, endOffsetFrame: 3 },
				{ key: 'region-b', takeKey: 'take-a', startOffsetFrame: 3, endOffsetFrame: 5 },
			],
		}],
	} as unknown as AudioEditorClipboard;
	const command: Record<string, unknown> = {};
	prepareTakeCompClipboardPasteIds(clipboard, command, idFactory());
	const before = structuredClone(target.takeGroups);

	assert.throws(() => stageTakeCompClipboardPaste(target, clipboard, command, 'reject', 1 / 12, {
		placementFrameBySequenceId: new Map([['main-sequence', 600]]),
	}), /another sample rate/iu);
	assert.deepEqual(target.takeGroups, before, 'the refusal happens before any mutation');

	// At the project's own rate the same paste lands, unscaled.
	const pasted: Record<string, unknown> = {};
	prepareTakeCompClipboardPasteIds(clipboard, pasted, idFactory());
	stageTakeCompClipboardPaste(target, clipboard, pasted, 'reject', 1, {
		placementFrameBySequenceId: new Map([['main-sequence', 600]]),
	})();
	assert.deepEqual((target.takeGroups as readonly Record<string, unknown>[])[1], {
		id: 'take-group-copy-1', sequenceId: 'main-sequence', trackId: 'track-a',
		startSample: 600, endSample: 605,
		laneOrder: ['take-lane-copy-1'],
		lanes: [{ id: 'take-lane-copy-1' }],
		takes: [{
			id: 'take-copy-1', laneId: 'take-lane-copy-1', sourceId: 'take-source-a',
			startSample: 600, endSample: 605, sourceStartSample: 0,
		}],
		compRegions: [
			{ id: 'comp-region-copy-1', takeId: 'take-copy-1', startSample: 600, endSample: 603 },
			{ id: 'comp-region-copy-2', takeId: 'take-copy-1', startSample: 603, endSample: 605 },
		],
	});
});

test('V4 normalization is closed, bounded, and refuses incomplete identity authority', () => {
	const clipboard = createClipboardDescriptor(project(), {
		startFrame: 150, endFrame: 450, trackIds: ['track-a'],
	});
	const unknown = structuredClone(clipboard) as unknown as Record<string, unknown>;
	unknown.surprise = true;
	assert.throws(() => normalizeAudioEditorClipboardDescriptor(unknown), /unsupported field|exact fields/iu);

	const dangling = structuredClone(clipboard);
	(dangling.takeGroups?.[0] as unknown as { takes: Array<{ laneKey: string }> }).takes[0]!.laneKey = 'missing';
	assert.throws(
		() => normalizeAudioEditorClipboardDescriptor(dangling),
		/missing take lane|references missing lane/iu,
	);

	const command = preparePasteCommand(clipboard, { atFrame: 600, project: project() }, idFactory());
	delete (command as unknown as { takeIds?: unknown }).takeIds;
	assert.throws(
		() => applyEditorCommand(project(), command as AudioEditorCommand, { now: NOW }),
		/paste\.takeIds/iu,
	);
});
