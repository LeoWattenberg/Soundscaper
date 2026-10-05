/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeEditorExportSettings } from '../src/common/editor/controller/export/export-settings.ts';
import { createExportDialogInitialSettings } from '../src/common/editor/ui/export-dialog-initial-settings.ts';
import { createExportDialogRequest } from '../src/common/editor/ui/export-dialog-model.js';
import { exportDialogHasChapterLabels } from '../src/common/editor/ui/export-dialog-embedded-chapters.ts';

test('embedded label chapters are an explicit opt-in in settings and the export dialog', () => {
	assert.equal(normalizeEditorExportSettings({}, 48_000).embedLabelChapters, false);
	assert.equal(createExportDialogInitialSettings({ sampleRate: 48_000 }).embedLabelChapters, false);
	assert.equal(normalizeEditorExportSettings({ embedLabelChapters: true }, 48_000).embedLabelChapters, true);
	for (const embedLabelChapters of ['true', 1, null]) {
		assert.equal(normalizeEditorExportSettings({ embedLabelChapters }, 48_000).embedLabelChapters, false);
	}
});

test('the dialog attaches embedded chapters only for an opted-in supported mixed delivery', () => {
	const initial = createExportDialogInitialSettings({ sampleRate: 48_000 });
	for (const format of ['mp3', 'aac-m4a']) {
		assert.equal(Object.hasOwn(createExportDialogRequest({ ...initial, format }), 'embedLabelChapters'), false);
		assert.equal(createExportDialogRequest({ ...initial, format, embedLabelChapters: true }).embedLabelChapters, true);
	}
	const chosen = { ...initial, format: 'mp3', embedLabelChapters: true };
	for (const settings of [
		{ ...chosen, format: 'wav' },
		{ ...chosen, format: 'opus' },
		{ ...chosen, format: 'video-mp4' },
		{ ...chosen, mode: 'stems' },
		{ ...chosen, mode: 'chapters' },
		{ ...chosen, masteringSequenceId: 'album' },
	]) {
		assert.equal(Object.hasOwn(createExportDialogRequest(settings), 'embedLabelChapters'), false);
	}
	assert.equal(Object.hasOwn(createExportDialogRequest(chosen, { desktop: true }), 'embedLabelChapters'), false);
});

test('chapter embedding sees labels on every label track, independent of the split-export track', () => {
	assert.equal(exportDialogHasChapterLabels({ tracks: [
		{ type: 'label', labels: [] },
		{ type: 'label', labels: [{ title: 'Intro', startFrame: 0, endFrame: 0 }] },
	] }), true);
	for (const project of [null, {}, { tracks: [null, { type: 'audio', labels: ['a'] }, { type: 'label', labels: [] }] }]) {
		assert.equal(exportDialogHasChapterLabels(project), false);
	}
});
