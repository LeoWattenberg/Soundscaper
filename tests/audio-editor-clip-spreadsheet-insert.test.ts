/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { applyEditorCommand } from '../src/common/editor/commands.js';
import { createCurrentAudioEditorProject, validateCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { createAudioSource } from '../src/common/editor/project-media-factory.ts';
import { createEditorHistory, executeEditorCommand, undoEditorCommand } from '../src/common/editor/history.js';
import { getClipSpreadsheetRows, planClipSpreadsheetEdits } from '../src/common/editor/clip-spreadsheet.ts';
import {
	findMissingClipSpreadsheetSources, planClipSpreadsheetInsert,
	type ClipSpreadsheetNewRow,
} from '../src/common/editor/clip-spreadsheet-insert.ts';

function fixture() {
	return applyEditorCommand(createCurrentAudioEditorProject({ id: 'insert-project', sampleRate: 48_000 }), {
		type: 'batch', commands: [
			{ type: 'source/add', source: { id: 'source', storageKey: 'source', name: 'Voice.wav', sampleRate: 44_100, originalSampleRate: 44_100, frameCount: 441_000, channelCount: 2 } },
			{ type: 'track/add', track: { id: 'existing-track', name: 'Existing' } },
			{ type: 'clip/add', trackId: 'existing-track', clip: { id: 'existing-clip', sourceId: 'source', durationFrames: 48_000, sourceDurationFrames: 44_100 } },
		],
	});
}
function idFactory() { let sequence = 0; return (prefix: string): string => `${prefix}-insert-${String(++sequence)}`; }
function insert(project: ReturnType<typeof fixture>, rows: readonly ClipSpreadsheetNewRow[]) {
	const command = planClipSpreadsheetInsert(project, rows, { createId: idFactory() });
	assert.ok(command);
	const next = applyEditorCommand(project, command);
	assert.equal(validateCurrentAudioEditorProject(next), true);
	return next;
}

test('new spreadsheet rows create clips with native source timing and every editable property', () => {
	const project = insert(fixture(), [{
		name: 'Verse', track: 'Existing', source: 'Voice.wav', position: '2.5', offset: '1', duration: '1.5',
		pitch: '3', speed: '2', gain: '-6', fadeIn: '0.1', fadeOut: '0.2', reversed: 'TRUE', inverted: 'yes', sampleRate: '44100', channels: '2',
	}]);
	const row = getClipSpreadsheetRows(project)[1];
	assert.ok(row);
	assert.deepEqual(row.cells, {
		name: 'Verse', track: 'Existing', source: 'Voice.wav', position: '2.5', offset: '1', duration: '1.5',
		pitch: '3', speed: '2', gain: '-6', fadeIn: '0.1', fadeOut: '0.2', reversed: 'true', inverted: 'true', sampleRate: '44100', channels: '2',
	});
	const clip = project.clips[1];
	assert.equal(clip.sourceStartFrame, 44_100);
	assert.equal(clip.sourceDurationFrames, 132_300);
	assert.equal(clip.durationFrames, 72_000);
	assert.equal(project.tracks.length, 1);
});

test('new track names are created once and blank track names default to the source name', () => {
	const project = insert(fixture(), [
		{ source: 'source', track: 'New track', duration: '1' },
		{ source: 'Voice.wav', track: 'New track', position: '1', duration: '1' },
		{ source: 'Voice.wav', offset: '2', speed: '2' },
	]);
	assert.deepEqual(project.tracks.map((track: { name: string }) => track.name), ['Existing', 'New track', 'Voice.wav']);
	assert.ok(Array.isArray(project.tracks[1].clipIds));
	assert.equal(project.tracks[1].clipIds.length, 2);
	const row = getClipSpreadsheetRows(project)[3];
	assert.equal(row?.cells.duration, '4');
	assert.equal(row?.cells.name, 'Voice.wav');
});

test('missing source discovery validates row fields before returning unique disk references', () => {
	const project = fixture();
	assert.deepEqual(findMissingClipSpreadsheetSources(project, [
		{ source: 'Voice.wav' }, { source: '/music/missing.wav', duration: '2' }, { source: '/music/missing.wav' }, { source: 'other.wav' },
	]), ['/music/missing.wav', 'other.wav']);
	for (const row of [
		{ source: '' }, { source: 'missing.wav', pitch: '13' }, { source: 'missing.wav', speed: '0' },
		{ source: 'missing.wav', duration: '-1' }, { source: 'missing.wav', position: 'Infinity' },
		{ source: 'missing.wav', reversed: 'maybe' }, { source: 'missing.wav', gain: '25' },
		{ source: 'missing.wav', sampleRate: '1.5' }, { source: 'missing.wav', channels: '0' },
		{ source: 'missing.wav', duration: '1', fadeOut: '2' },
		{ source: 'missing.wav', position: '1e15' }, { source: 'missing.wav', duration: '0.00000001' },
	]) assert.throws(() => findMissingClipSpreadsheetSources(project, [row]));
	assert.throws(() => planClipSpreadsheetInsert(project, [{ source: 'missing.wav' }], { createId: idFactory() }), /source.*missing|missing.*source/i);
});

test('source and track ambiguity require explicit IDs and locked tracks remain protected', () => {
	const project = applyEditorCommand(fixture(), { type: 'batch', commands: [
		{ type: 'source/add', source: { id: 'other-source', storageKey: 'other-source', name: 'Voice.wav', sampleRate: 44_100, frameCount: 441_000, channelCount: 2 } },
		{ type: 'track/add', track: { id: 'other-track', name: 'Existing' } },
	] });
	assert.throws(() => findMissingClipSpreadsheetSources(project, [{ source: 'Voice.wav' }]), /ambiguous/i);
	assert.throws(() => findMissingClipSpreadsheetSources(project, [{ source: 'source', track: 'Existing' }]), /ambiguous/i);
	assert.equal(insert(project, [{ source: 'source', track: 'existing-track' }]).clips.length, 2);
	const locked = applyEditorCommand(fixture(), { type: 'track/update', trackId: 'existing-track', changes: { locked: true } });
	assert.throws(() => findMissingClipSpreadsheetSources(locked, [{ source: 'missing.wav', track: 'Existing' }]), /locked/i);
});

test('source bounds and metadata mismatches reject the whole insertion without changing the project', () => {
	const project = fixture();
	const before = structuredClone(project);
	for (const row of [
		{ source: 'source', offset: '9', duration: '2' }, { source: 'source', offset: '10' },
		{ source: 'source', duration: '0.00000001' }, { source: 'source', sampleRate: '48000' }, { source: 'source', channels: '1' },
	]) assert.throws(() => insert(project, [{ source: 'source', duration: '1' }, row]));
	assert.deepEqual(project, before);
});

test('prepared imported sources and all rows belong to a single undo step', () => {
	const project = fixture();
	const source = createAudioSource({ id: 'imported', storageKey: 'imported', name: 'Fresh.wav', sampleRate: 32_000, frameCount: 160_000, channelCount: 1 });
	const command = planClipSpreadsheetInsert(project, [{ source: '/disk/Fresh.wav', track: 'Imported', offset: '1', duration: '2' }], {
		createId: idFactory(), additionalSources: [source], resolvedSourceIds: { '/disk/Fresh.wav': source.id },
	});
	assert.ok(command);
	const history = executeEditorCommand(createEditorHistory(project), command);
	assert.equal(validateCurrentAudioEditorProject(history.present), true);
	assert.equal(history.undoStack.length, 1);
	assert.ok(Array.isArray(history.present.sources));
	assert.equal(history.present.sources.length, 2);
	assert.ok(Array.isArray(history.present.clips));
	assert.equal(history.present.clips.length, 2);
	assert.equal(getClipSpreadsheetRows(history.present)[1]?.cells.source, 'Fresh.wav');
	const restored = undoEditorCommand(history).present;
	assert.ok(Array.isArray(restored.sources));
	assert.ok(Array.isArray(restored.tracks));
	assert.ok(Array.isArray(restored.clips));
	assert.equal(restored.sources.length, 1);
	assert.equal(restored.tracks.length, 1);
	assert.equal(restored.clips.length, 1);
});

test('existing edits and new rows compose into the same atomic command', () => {
	const project = fixture();
	const edit = planClipSpreadsheetEdits(project, [{ clipId: 'existing-clip', column: 'name', value: 'Renamed' }]);
	const addition = planClipSpreadsheetInsert(project, [{ source: 'source', track: 'Existing', duration: '2' }], { createId: idFactory() });
	assert.ok(edit && addition);
	const history = executeEditorCommand(createEditorHistory(project), { type: 'batch', commands: [edit, addition] });
	assert.equal(history.undoStack.length, 1);
	assert.ok(Array.isArray(history.present.clips));
	assert.equal(history.present.clips.length, 2);
	assert.equal(getClipSpreadsheetRows(history.present)[0]?.cells.name, 'Renamed');
	assert.deepEqual(getClipSpreadsheetRows(undoEditorCommand(history).present), getClipSpreadsheetRows(project));
	assert.equal(planClipSpreadsheetInsert(project, [], { createId: idFactory() }), null);
});

test('new tracks use the project sample rate while source spans retain their native rate', () => {
	const source = createAudioSource({ id: 'source', storageKey: 'source', name: 'Mixed.wav', sampleRate: 44_100, frameCount: 88_200, channelCount: 1 });
	const project = createCurrentAudioEditorProject({ id: 'low-rate', sampleRate: 16_000, sources: [source] });
	const next = insert(project, [{ source: 'source', duration: '1' }]);
	assert.equal(next.clips[0].durationFrames, 16_000);
	assert.equal(next.clips[0].sourceDurationFrames, 44_100);
	const spectrogram = next.tracks[0].spectrogram as Readonly<{ maximumFrequency: number }>;
	assert.equal(spectrogram.maximumFrequency, 8_000);
});

test('invalid imported identities and non-audio targets are refused', () => {
	const project = fixture();
	const source = createAudioSource({ id: 'source', storageKey: 'other', name: 'Other.wav', sampleRate: 48_000, frameCount: 48_000, channelCount: 1 });
	assert.throws(() => planClipSpreadsheetInsert(project, [{ source: 'source' }], { createId: idFactory(), additionalSources: [source] }), /source ID/i);
	assert.throws(() => planClipSpreadsheetInsert(project, [{ source: 'source' }], { createId: () => 'source' }), /fresh stable IDs/i);
	const labelProject = applyEditorCommand(project, { type: 'track/add', track: { type: 'label', id: 'labels', name: 'Labels' } });
	assert.throws(() => findMissingClipSpreadsheetSources(labelProject, [{ source: 'source', track: 'Labels' }]), /audio track/i);
	const videoSourceProject = { ...project, sources: [{ ...source, kind: 'video' }] };
	assert.throws(() => findMissingClipSpreadsheetSources(videoSourceProject, [{ source: 'source' }]), /audio source/i);
});
