/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import {
	createDocumentMasteringSequenceSnapshot,
} from '../src/common/editor/controller/document-mastering-sequence-snapshot.ts';
import { normalizeEditorExportSettings } from '../src/common/editor/controller/export-settings.ts';
import { createExportDialogRequest } from '../src/common/editor/ui/export-dialog-model.js';

const NOW = '2026-08-18T00:00:00.000Z';

function annotation(id: string, name: string, startFrame: number, endFrame: number, sequenceId: string) {
	return {
		id, sequenceId, name, kind: 'region', anchor: 'sample',
		startFrame, endFrame, color: 'auto', batchId: null, opaqueExtensions: {},
	};
}

function albumProject(entries: readonly unknown[], regionIds = ['r-one', 'r-two']) {
	const base = createSoundscaperProject({
		id: 'album', title: 'Album', now: NOW, revision: 0,
		tracks: [{ type: 'audio', id: 'a1', name: 'A1' }],
	} as never);
	const sequenceId = base.primarySequenceId;
	return createSoundscaperProject({
		id: 'album', title: 'Album', now: NOW, revision: 0,
		tracks: [{ type: 'audio', id: 'a1', name: 'A1' }],
		primarySequenceId: sequenceId,
		sequences: base.sequences,
		timelineAnnotations: [
			...(regionIds.includes('r-one') ? [annotation('r-one', 'One', 0, 480_000, sequenceId)] : []),
			...(regionIds.includes('r-two') ? [annotation('r-two', 'Two', 700_000, 1_180_000, sequenceId)] : []),
		],
		masteringSequences: [{ id: 'album-order', sequenceId, name: 'Album order', entries }],
	} as never);
}

const ORDER = [
	{ id: 'e1', annotationId: 'r-one', title: 'Overture', metadata: { isrc: 'GBAYE0000123' } },
	{ id: 'e2', annotationId: 'r-two', gapBeforeFrames: 96_000, fadeOutFrames: 48_000 },
];

test('the snapshot carries each sequence with its entries and delivered length', () => {
	const snapshot = createDocumentMasteringSequenceSnapshot(albumProject(ORDER));

	assert.equal(snapshot.sequences.length, 1);
	const [sequence] = snapshot.sequences;
	assert.equal(sequence.name, 'Album order');
	assert.equal(sequence.deliverable, true);
	assert.equal(sequence.totalFrames, 1_056_000);
	assert.deepEqual(sequence.entries.map(({ title }) => title), ['Overture', 'Two']);
	assert.deepEqual(sequence.entries[0].metadata, { isrc: 'GBAYE0000123' });
	assert.equal(sequence.entries[1].gapBeforeFrames, 96_000);
	assert.deepEqual(snapshot.regions.map(({ id }) => id), ['r-one', 'r-two'],
		'the regions an entry may point at travel with the sequences');
});

test('a sequence whose region went missing is shown with the reason, not hidden', () => {
	// Hiding it would hide the only place the operator can fix it.
	const snapshot = createDocumentMasteringSequenceSnapshot(albumProject(ORDER, ['r-one']));
	const [sequence] = snapshot.sequences;

	assert.equal(sequence.deliverable, false);
	assert.equal(sequence.totalFrames, null, 'an unresolved length is absent, not short');
	assert.equal(sequence.entries.length, 2, 'and the entry is still there');
	assert.equal(sequence.entries[1].durationFrames, null);
	assert.ok(sequence.issues.some(({ code }) => code === 'mastering-sequence.region-missing'));
});

test('a document that cannot hold sequences reports none rather than failing', () => {
	assert.deepEqual(createDocumentMasteringSequenceSnapshot({ schemaVersion: 21 }).sequences, []);
	assert.deepEqual(createDocumentMasteringSequenceSnapshot(null).sequences, []);
});

test('a delivery is a sequence only when one was asked for', () => {
	assert.equal(normalizeEditorExportSettings({}, 48_000).masteringSequenceId, null);
	assert.equal(
		normalizeEditorExportSettings({ masteringSequenceId: 'album-order' }, 48_000).masteringSequenceId,
		'album-order',
	);
	assert.equal(normalizeEditorExportSettings({ masteringSequenceId: '' }, 48_000).masteringSequenceId, null);
	assert.equal(normalizeEditorExportSettings({ masteringSequenceId: 7 }, 48_000).masteringSequenceId, null);
});

test('the export dialog carries the chosen sequence into the request, and nothing when none', () => {
	const dialogSettings = {
		mode: 'mix', range: 'project', format: 'wav', sampleFormat: 'int24',
		bitRate: '192', compressionLevel: '5', sampleRate: '48000', channelMapping: 'preserve',
		dither: 'triangular', quality: '5', customExtension: '', customMimeType: '',
		customArguments: '', includeTail: true,
	};
	assert.equal(
		(createExportDialogRequest({ ...dialogSettings, masteringSequenceId: 'album-order' }, {}) as
			Record<string, unknown>).masteringSequenceId,
		'album-order',
	);
	assert.equal(
		Object.hasOwn(createExportDialogRequest({ ...dialogSettings, masteringSequenceId: '' }, {}), 'masteringSequenceId'),
		false,
	);
});
