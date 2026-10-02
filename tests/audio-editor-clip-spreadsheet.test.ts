/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { applyEditorCommand } from '../src/common/editor/commands.js';
import { createVideoClip, createVideoSource, createVideoTrack } from '../src/common/editor/project-media-factory.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { createEditorHistory, executeEditorCommand, undoEditorCommand } from '../src/common/editor/history.js';
import {
	CLIP_SPREADSHEET_COLUMNS, getClipSpreadsheetRows, isClipSpreadsheetCellEditable, planClipSpreadsheetEdits,
	type ClipSpreadsheetEdit,
} from '../src/common/editor/clip-spreadsheet.ts';
import { createGroupedEditorActions } from '../src/common/editor/controller/composition/action-facade.ts';
import { createActionFacadeRuntime } from './helpers/action-facade-runtime-fixture.ts';
import { createClipSpreadsheetAction } from '../src/common/editor/controller/composition/internal/clip-spreadsheet-action.ts';

function fixture() {
	let project = createCurrentAudioEditorProject({ id: 'spreadsheet-project', sampleRate: 48_000 });
	project = applyEditorCommand(project, { type: 'batch', commands: [
		{ type: 'source/add', source: { id: 'source', storageKey: 'source', name: 'Voice.wav', sampleRate: 44_100, originalSampleRate: 44_100, frameCount: 441_000, channelCount: 2 } },
		{ type: 'track/add', track: { id: 'track', name: 'Voice' } },
		{ type: 'clip/add', trackId: 'track', clip: { id: 'first', title: 'First', sourceId: 'source', timelineStartFrame: 48_000, sourceStartFrame: 44_100, sourceDurationFrames: 88_200, durationFrames: 96_000, fadeInFrames: 12_000, fadeOutFrames: 24_000, envelope: [{ frame: 0, value: 1 }, { frame: 48_000, value: 0.5 }, { frame: 96_000, value: 1 }] } },
		{ type: 'clip/add', trackId: 'track', clip: { id: 'second', title: 'Second', sourceId: 'source', timelineStartFrame: 192_000, sourceStartFrame: 0, sourceDurationFrames: 44_100, durationFrames: 48_000 } },
	] });
	return project;
}

function change(project: ReturnType<typeof fixture>, edits: readonly ClipSpreadsheetEdit[]) {
	const command = planClipSpreadsheetEdits(project, edits);
	assert.ok(command);
	return applyEditorCommand(project, command);
}

test('spreadsheet projects sample rates into seconds and keeps rows stable after moving clips', () => {
	const project = fixture();
	const rows = getClipSpreadsheetRows(project);
	assert.deepEqual(rows.map(row => row.id), ['first', 'second']);
	assert.equal(rows[0]?.cells.position, '1');
	assert.equal(rows[0]?.cells.offset, '1');
	assert.equal(rows[0]?.cells.duration, '2');
	assert.equal(rows[0]?.cells.source, 'Voice.wav');
	assert.equal(rows[0]?.cells.sampleRate, '44100');
	assert.equal(rows[0]?.cells.channels, '2');
	const next = change(project, [{ clipId: 'first', column: 'position', value: '5' }]);
	assert.deepEqual(getClipSpreadsheetRows(next).map(row => row.id), ['first', 'second']);
});

test('whole-row roundtrips and equivalent numeric values do not create history', () => {
	const project = fixture();
	const rows = getClipSpreadsheetRows(project);
	const edits = rows.flatMap(row => CLIP_SPREADSHEET_COLUMNS.map(column => ({ clipId: row.id, column: column.id, value: row.cells[column.id] })));
	assert.equal(planClipSpreadsheetEdits(project, edits), null);
	assert.equal(planClipSpreadsheetEdits(project, [{ clipId: 'first', column: 'position', value: '1.0000' }]), null);
	assert.throws(() => planClipSpreadsheetEdits(project, [{ clipId: 'first', column: 'source', value: 'Other.wav' }]), /read.only/i);
});

test('a mixed-cell paste commits once and undo restores every clip', () => {
	const project = fixture();
	const command = planClipSpreadsheetEdits(project, [
		{ clipId: 'first', column: 'name', value: 'Renamed' },
		{ clipId: 'first', column: 'position', value: '4' },
		{ clipId: 'second', column: 'position', value: '1' },
		{ clipId: 'second', column: 'pitch', value: '3.5' },
		{ clipId: 'second', column: 'reversed', value: 'TRUE' },
	]);
	assert.ok(command);
	const history = executeEditorCommand(createEditorHistory(project), command);
	assert.equal(history.undoStack.length, 1);
	const rows = getClipSpreadsheetRows(history.present);
	assert.equal(rows[0]?.cells.name, 'Renamed');
	assert.equal(rows[1]?.cells.pitch, '3.5');
	assert.equal(rows[1]?.cells.reversed, 'true');
	assert.deepEqual(getClipSpreadsheetRows(undoEditorCommand(history).present), getClipSpreadsheetRows(project));
});

test('speed uses source rate, scales envelopes, and caps existing fades to the new duration', () => {
	const project = fixture();
	const next = change(project, [{ clipId: 'first', column: 'speed', value: '8' }]);
	const clip = next.clips.find((item: { id: string }) => item.id === 'first');
	assert.ok(clip);
	assert.ok(Array.isArray(clip.envelope));
	assert.equal(clip.durationFrames, 12_000);
	assert.equal(clip.sourceDurationFrames, 88_200);
	assert.equal(clip.fadeOutFrames, 12_000);
	assert.deepEqual(clip.envelope.map((point: { frame: number }) => point.frame), [0, 6000, 12000]);
	assert.equal(clip.renderCacheRevision, Number(project.clips[0].renderCacheRevision) + 1);
});

test('duration trims source samples while a combined speed and duration paste stays coherent', () => {
	const project = fixture();
	const trimmed = change(project, [{ clipId: 'first', column: 'duration', value: '1' }]);
	assert.equal(trimmed.clips[0].sourceDurationFrames, 44_100);
	assert.equal(trimmed.clips[0].speedRatio, 1);
	const next = change(project, [
		{ clipId: 'first', column: 'offset', value: '0.5' },
		{ clipId: 'first', column: 'duration', value: '1.5' },
		{ clipId: 'first', column: 'speed', value: '2' },
	]);
	assert.equal(next.clips[0].sourceStartFrame, 22_050);
	assert.equal(next.clips[0].sourceDurationFrames, 132_300);
	assert.equal(next.clips[0].durationFrames, 72_000);
});

test('invalid pasted data is refused without changing the project', () => {
	const project = fixture();
	const before = structuredClone(project);
	for (const [column, value] of [
		['pitch', '13'], ['speed', '0'], ['gain', '25'], ['offset', '9.5'],
		['duration', '-1'], ['fadeIn', '3'], ['position', 'Infinity'], ['inverted', 'maybe'],
	] as const) {
		assert.throws(() => change(project, [
			{ clipId: 'second', column: 'name', value: 'Should not commit' },
			{ clipId: 'first', column, value },
		]));
	}
	assert.deepEqual(project, before);
});

test('spreadsheet action rejects stale targets and blocked edits and commits only meaningful changes', () => {
	const project = fixture();
	const state = { readOnly: false };
	const commands: unknown[] = [];
	const apply = createClipSpreadsheetAction({ getProject: () => project, state, commit: command => commands.push(command) });
	assert.throws(() => apply('old-project', [{ clipId: 'first', column: 'name', value: 'Renamed' }]), /project/i);
	state.readOnly = true;
	assert.throws(() => apply(project.id, [{ clipId: 'first', column: 'name', value: 'Renamed' }]), /editing/i);
	state.readOnly = false;
	apply(project.id, [{ clipId: 'first', column: 'position', value: '1.00' }]);
	assert.equal(commands.length, 0);
	apply(project.id, [{ clipId: 'first', column: 'name', value: 'Renamed' }, { clipId: 'second', column: 'pitch', value: '2' }]);
	assert.equal(commands.length, 1);
});


test('explicit unchanged duration remains authoritative in a simultaneous speed paste', () => {
	const next = change(fixture(), [
		{ clipId: 'first', column: 'duration', value: '2' },
		{ clipId: 'first', column: 'speed', value: '2' },
	]);
	assert.equal(next.clips[0].durationFrames, 96_000);
	assert.equal(next.clips[0].sourceDurationFrames, 176_400);
});

test('linked timing and locked rows cannot bypass their existing editing boundaries', () => {
	const project = fixture();
	const grouped = applyEditorCommand(project, { type: 'clip/group', clipIds: ['first', 'second'], groupId: 'group' });
	assert.throws(() => planClipSpreadsheetEdits(grouped, [{ clipId: 'first', column: 'position', value: '2' }]), /Ungroup|unlink/);
	const locked = applyEditorCommand(project, { type: 'track/update', trackId: 'track', changes: { locked: true } });
	assert.equal(getClipSpreadsheetRows(locked)[0]?.editable, false);
	assert.throws(() => planClipSpreadsheetEdits(locked, [{ clipId: 'first', column: 'gain', value: '-6' }]), /read.only/i);
});

test('source edits reconcile hidden trim extents before command validation', () => {
	const project = applyEditorCommand(fixture(), { type: 'clip/transform-many', transforms: [
		{ clipId: 'first', changes: { trimStartFrames: 44_100, trimEndFrames: 308_700 } },
	] });
	const slipped = change(project, [{ clipId: 'first', column: 'offset', value: '0' }]);
	assert.equal(slipped.clips[0].trimStartFrames, 0);
	assert.equal(slipped.clips[0].trimEndFrames, 352_800);
	const extended = change(project, [{ clipId: 'first', column: 'duration', value: '3' }]);
	assert.equal(extended.clips[0].trimStartFrames, 44_100);
	assert.equal(extended.clips[0].trimEndFrames, 264_600);
});

test('duration trims retain automation timing and interpolate the new boundary', () => {
	const next = change(fixture(), [{ clipId: 'first', column: 'duration', value: '0.75' }]);
	assert.deepEqual(next.clips[0].envelope, [{ frame: 0, value: 1 }, { frame: 36_000, value: 0.625 }]);
	const combined = change(fixture(), [
		{ clipId: 'first', column: 'duration', value: '0.75' },
		{ clipId: 'first', column: 'speed', value: '2' },
	]);
	assert.deepEqual(combined.clips[0].envelope, [{ frame: 0, value: 1 }, { frame: 24_000, value: 0.5 }, { frame: 36_000, value: 0.75 }]);
});


test('products without audio effect editing cannot invoke spreadsheet mutations', () => {
	const actions = createGroupedEditorActions(createActionFacadeRuntime(false));
	assert.throws(() => actions.clip.editSpreadsheet('project', [{ clipId: 'clip', column: 'pitch', value: '2' }]), /does not support audioEffects/);
});


test('video rows show source offsets in video frames per second and remain read-only', () => {
	const rate = { num: 24, den: 1 };
	const source = createVideoSource({
		id: 'video-source', name: 'Camera.mp4', storageKey: 'video-source', sampleFrameCount: 960_000,
		sourceFrameCount: 480, frameRate: rate, width: 1920, height: 1080, videoCodec: 'h264',
	});
	const clip = createVideoClip({
		id: 'video', sourceId: source.id, sequenceId: 'main', sequenceStartFrame: 24,
		sequenceFrameCount: 48, sourceInFrame: 240, sourceFrameCount: 48,
	}, { projectSampleRate: 48_000, sequence: { id: 'main', rate }, source });
	const project = createCurrentAudioEditorProject({
		id: 'video-project', sampleRate: 48_000, sources: [source], clips: [clip],
		tracks: [createVideoTrack({ id: 'video-track', clipIds: [clip.id] })],
		sequences: [{ id: 'main', rate, trackIds: ['video-track'] }], primarySequenceId: 'main',
	});
	const row = getClipSpreadsheetRows(project)[0];
	assert.equal(row?.editable, false);
	assert.equal(row?.cells.position, '1');
	assert.equal(row?.cells.duration, '2');
	assert.equal(row?.cells.offset, '10');
	assert.throws(() => planClipSpreadsheetEdits(project, [{ clipId: 'video', column: 'name', value: 'Changed' }]), /read.only/i);
});


test('linked pitch reports the speed-derived pitch and is edited through speed', () => {
	const base = fixture();
	const project = { ...base, clips: base.clips.map((clip: { id: string }) => clip.id === 'first'
		? { ...clip, linkPitchAndTempo: true, speedRatio: 2, pitchCents: 300 } : clip) };
	const row = getClipSpreadsheetRows(project)[0];
	assert.ok(row);
	assert.equal(row.cells.pitch, '12');
	assert.equal(row.pitchLinked, true);
	assert.equal(isClipSpreadsheetCellEditable(row, 'pitch'), false);
	assert.equal(isClipSpreadsheetCellEditable(row, 'speed'), true);
	assert.throws(() => planClipSpreadsheetEdits(project, [{ clipId: 'first', column: 'pitch', value: '3' }]), /read.only/i);
});

test('gain display suppresses conversion noise and equivalent spreadsheet formatting stays a no-op', () => {
	const project = change(fixture(), [{ clipId: 'first', column: 'gain', value: '-6' }]);
	assert.equal(getClipSpreadsheetRows(project)[0]?.cells.gain, '-6');
	assert.equal(planClipSpreadsheetEdits(project, [{ clipId: 'first', column: 'gain', value: '-6.000' }]), null);
	const maximum = change(project, [{ clipId: 'first', column: 'gain', value: String(20 * Math.log10(16)) }]);
	const row = getClipSpreadsheetRows(maximum)[0];
	assert.ok(row);
	assert.equal(planClipSpreadsheetEdits(maximum, [{ clipId: 'first', column: 'gain', value: `${row.cells.gain}0` }]), null);
	assert.equal(planClipSpreadsheetEdits(maximum, CLIP_SPREADSHEET_COLUMNS.map(column => ({ clipId: row.id, column: column.id, value: row.cells[column.id] }))), null);
});
