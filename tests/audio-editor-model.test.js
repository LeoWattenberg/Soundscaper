import test from 'node:test';
import assert from 'node:assert/strict';
import {
	prepareRangeReplacementCommand,
} from '../src/common/editor/commands.js';
import { createEffect } from '../src/common/editor/effects.js';
import {
	AUDIO_EDITOR_HISTORY_LIMIT,
	canRedo,
	canUndo,
	createEditorHistory,
	executeEditorCommand,
	redoEditorCommand,
	undoEditorCommand,
} from '../src/common/editor/history.js';
import {
	findClip,
	validateAudioEditorProject,
} from '../src/common/editor/project.js';
import {
	collectHistorySourceIds,
	compactEditorHistorySourceMetadata,
	evictUnreferencedSourceCaches,
} from '../src/common/editor/retention.js';
import {
	AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION,
} from '../src/common/editor/project-current.ts';
import {
	NOW,
	apply,
	createFixture,
} from './helpers/audio-editor-model-harness.js';

test('audio editor projects use the normalized, frame-accurate current document', () => {
	const project = createFixture();
	assert.equal(project.schemaVersion, AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION);
	assert.equal(project.sampleRate, 48_000);
	assert.equal(project.masterChannels, 2);
	assert.deepEqual(project.tracks.map((track) => track.clipIds), [[], []]);
	assert.equal(project.revision, 3);
	assert.equal(validateAudioEditorProject(project), true);
	assert.throws(() => apply(project, { type: 'clip/add', trackId: 'track-1', clip: {
		id: 'bad', sourceId: 'source-1', timelineStartFrame: 0.5, sourceStartFrame: 0, durationFrames: 100,
	} }), /safe integer greater than or equal to 0/);
});

test('effect racks validate their core studio parameters and audio tracks can be armed independently', () => {
	let project = createFixture();
	const compressor = createEffect('compressor', { id: 'compressor-1' });
	assert.equal(compressor.params.threshold, -24);
	assert.equal(createEffect('eq', { id: 'eq-1' }).params.bands.length, 4);
	assert.throws(() => createEffect('delay', { id: 'bad', params: { feedback: 1 } }), /between 0 and 0.95/);

	project = apply(project, { type: 'effect/add', scope: 'track', trackId: 'track-1', effect: compressor });
	project = apply(project, { type: 'effect/add', scope: 'track', trackId: 'track-1', effect: createEffect('delay', { id: 'delay-1' }) });
	project = apply(project, { type: 'effect/reorder', scope: 'track', trackId: 'track-1', effectId: 'delay-1', toIndex: 0 });
	project = apply(project, { type: 'effect/update', scope: 'track', trackId: 'track-1', effectId: 'delay-1', changes: { enabled: false } });
	assert.deepEqual(project.tracks[0].effects.map((effect) => [effect.id, effect.enabled]), [['delay-1', false], ['compressor-1', true]]);

	project = apply(project, { type: 'track/update', trackId: 'track-1', changes: { armed: true } });
	project = apply(project, { type: 'track/update', trackId: 'track-2', changes: { armed: true } });
	project = apply(project, { type: 'track/add', track: { id: 'track-3', name: 'Room', armed: true } });
	assert.deepEqual(project.tracks.map((track) => track.armed), [true, true, true]);
	assert.equal(validateAudioEditorProject(project), true);
});

test('mixer group and send buses persist validated routing and clean up removed buses', () => {
	let project = createFixture();
	project = apply(project, {
		type: 'mixer/bus-add', busType: 'group', bus: { id: 'group-vocals', name: 'Vocals', gain: 0.8 },
	});
	project = apply(project, {
		type: 'mixer/bus-add', busType: 'send', bus: { id: 'send-reverb', name: 'Reverb' },
	});
	project = apply(project, {
		type: 'mixer/route-update', trackId: 'track-1', changes: {
			groupId: 'group-vocals', sends: { 'send-reverb': 0.25 },
		},
	});
	project = apply(project, {
		type: 'effect/add', scope: 'send', busId: 'send-reverb', effect: createEffect('reverb', { id: 'send-reverb-effect' }),
	});
	assert.deepEqual(project.mixer.routes['track-1'], {
		groupId: 'group-vocals', sends: { 'send-reverb': 0.25 },
	});
	assert.equal(project.mixer.groups[0].gain, 0.8);
	assert.equal(project.mixer.sends[0].effects[0].type, 'reverb');
	assert.equal(validateAudioEditorProject(project), true);
	assert.throws(() => apply(project, {
		type: 'mixer/route-update', trackId: 'track-2', changes: { groupId: 'missing' },
	}), /Unknown group bus/);

	project = apply(project, { type: 'mixer/bus-remove', busType: 'group', busId: 'group-vocals' });
	project = apply(project, { type: 'mixer/bus-remove', busType: 'send', busId: 'send-reverb' });
	assert.deepEqual(project.mixer.routes['track-1'], { groupId: null, sends: {} });
	assert.equal(validateAudioEditorProject(project), true);
});

test('master and bus row envelopes and collapsed state update through undoable mixer commands', () => {
	let project = createFixture();
	project = apply(project, {
		type: 'mixer/bus-add', busType: 'group', bus: { id: 'group-output', name: 'Output' },
	});
	assert.deepEqual(project.master.envelope, []);
	assert.equal(project.master.collapsed, true);
	assert.deepEqual(project.mixer.groups[0].envelope, []);
	assert.equal(project.mixer.groups[0].collapsed, true);

	let history = createEditorHistory(project);
	history = executeEditorCommand(history, {
		type: 'master/update',
		changes: { envelope: [{ frame: 0, value: 0.5 }, { frame: 4_800, value: 1 }], collapsed: false },
	}, { now: NOW });
	history = executeEditorCommand(history, {
		type: 'mixer/bus-update', busType: 'group', busId: 'group-output',
		changes: { envelope: [{ frame: 2_400, value: 0.25 }], collapsed: false },
	}, { now: NOW });
	assert.deepEqual(history.present.master.envelope, [
		{ frame: 0, value: 0.5 },
		{ frame: 4_800, value: 1 },
	]);
	assert.equal(history.present.master.collapsed, false);
	assert.deepEqual(history.present.mixer.groups[0].envelope, [{ frame: 2_400, value: 0.25 }]);
	assert.equal(history.present.mixer.groups[0].collapsed, false);

	history = undoEditorCommand(history, { now: NOW });
	assert.deepEqual(history.present.mixer.groups[0].envelope, []);
	assert.equal(history.present.mixer.groups[0].collapsed, true);
	history = undoEditorCommand(history, { now: NOW });
	assert.deepEqual(history.present.master.envelope, []);
	assert.equal(history.present.master.collapsed, true);
	history = redoEditorCommand(history, { now: NOW });
	history = redoEditorCommand(history, { now: NOW });
	assert.equal(history.present.master.collapsed, false);
	assert.equal(history.present.mixer.groups[0].collapsed, false);

	assert.throws(() => apply(history.present, {
		type: 'master/update', changes: { envelope: [{ frame: 0, value: -1 }] },
	}), /master\.envelope\[0\]\.value/);
	assert.throws(() => apply(history.present, {
		type: 'mixer/bus-update', busType: 'group', busId: 'group-output',
		changes: { envelope: [{ frame: 10, value: 1 }, { frame: 9, value: 1 }] },
	}), /strictly increasing frames/);
});

test('session history caps snapshots, clears redo on edits, and keeps revisions monotonic', () => {
	let history = createEditorHistory(createFixture());
	for (let index = 0; index < AUDIO_EDITOR_HISTORY_LIMIT + 5; index += 1) {
		history = executeEditorCommand(history, { type: 'project/rename', title: `Project ${index}` }, { now: NOW });
	}
	assert.equal(history.undoStack.length, 200);
	assert.equal(canUndo(history), true);
	const revision = history.present.revision;
	history = undoEditorCommand(history, { now: NOW });
	assert.equal(history.present.title, 'Project 203');
	assert.equal(history.present.revision, revision + 1);
	assert.equal(canRedo(history), true);
	history = redoEditorCommand(history, { now: NOW });
	assert.equal(history.present.title, 'Project 204');
	assert.equal(history.present.revision, revision + 2);
	history = executeEditorCommand(history, { type: 'project/rename', title: 'New branch' }, { now: NOW });
	assert.equal(canRedo(history), false);
});

test('source retention follows present, undo, and redo clip roots and evicts only unreachable caches', () => {
	let project = createFixture({ frameCount: 1_000 });
	project = apply(project, { type: 'clip/add', trackId: 'track-1', clip: {
		id: 'original-clip', sourceId: 'source-1', timelineStartFrame: 0, sourceStartFrame: 0, durationFrames: 1_000,
	} });
	let history = createEditorHistory(project);
	const replacement = prepareRangeReplacementCommand(project, {
		trackId: 'track-1', startFrame: 0, endFrame: 1_000,
		source: {
			id: 'processed-source', storageKey: 'processed-source', name: 'processed.wav', mimeType: 'audio/wav',
			frameCount: 1_000, channelCount: 2,
		},
		clipId: 'processed-clip',
	});
	history = compactEditorHistorySourceMetadata(executeEditorCommand(history, replacement, { now: NOW }));
	assert.deepEqual(history.present.sources.map((source) => source.id), ['processed-source']);
	assert.deepEqual(history.undoStack[0].project.sources.map((source) => source.id), ['source-1']);
	assert.deepEqual([...collectHistorySourceIds(history)].sort(), ['processed-source', 'source-1']);

	const buffers = new Map([['source-1', {}], ['processed-source', {}], ['stale-source', {}]]);
	const peaks = new Map([['source-1', {}], ['processed-source', {}], ['stale-source', {}]]);
	assert.deepEqual(evictUnreferencedSourceCaches(buffers, peaks, collectHistorySourceIds(history)), ['stale-source']);
	assert.deepEqual([...buffers.keys()].sort(), ['processed-source', 'source-1']);

	history = compactEditorHistorySourceMetadata(undoEditorCommand(history, { now: NOW }));
	assert.deepEqual(history.present.sources.map((source) => source.id), ['source-1']);
	assert.deepEqual(history.redoStack[0].project.sources.map((source) => source.id), ['processed-source']);
	history = compactEditorHistorySourceMetadata(redoEditorCommand(history, { now: NOW }));
	assert.equal(findClip(history.present, 'processed-clip').sourceId, 'processed-source');
	assert.equal(validateAudioEditorProject(history.present), true);

	history = compactEditorHistorySourceMetadata(undoEditorCommand(history, { now: NOW }));
	history = compactEditorHistorySourceMetadata(executeEditorCommand(history, { type: 'project/rename', title: 'Branched' }, { now: NOW }));
	assert.deepEqual([...collectHistorySourceIds(history)], ['source-1']);
	assert.equal(history.redoStack.length, 0);
	assert.deepEqual(evictUnreferencedSourceCaches(buffers, peaks, collectHistorySourceIds(history)), ['processed-source']);
});
