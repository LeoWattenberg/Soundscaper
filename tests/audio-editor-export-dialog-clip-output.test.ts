/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { ENGLISH_COPY, GERMAN_COPY } from '../src/common/i18n/catalogs.js';
import { createExportDialogInitialSettings } from '../src/common/editor/ui/export-dialog-initial-settings.ts';
import { createExportDialogRequest } from '../src/common/editor/ui/export-dialog-model.js';
import {
	conformExportDialogOutput,
	exportDialogOutputOptions,
	exportDialogOutputSettings,
	exportDialogOutputValue,
} from '../src/common/editor/ui/export-dialog-output-options.ts';

const OUTPUT_CONTEXT = Object.freeze({
	hasSelection: false, hasLoop: false, audioClipCount: 2,
	labelChapterCount: 0, markerChapterCount: 0, singleFileOnly: false,
	masteringSequences: [],
});

test('the clip output names one file per clip in English and German', () => {
	assert.equal(ENGLISH_COPY.exportOutputClips, 'Individual clips (split by clips)');
	assert.equal(GERMAN_COPY.exportOutputClips, 'Einzelne Clips (nach Clips getrennt)');
	assert.deepEqual(exportDialogOutputOptions(ENGLISH_COPY, OUTPUT_CONTEXT).find(({ value }) => value === 'clips'), {
		value: 'clips', label: ENGLISH_COPY.exportOutputClips, disabled: false,
	});
});

test('clip output choices use the whole project and clear an old mastering sequence', () => {
	const settings = exportDialogOutputSettings('clips');
	assert.deepEqual(settings, {
		mode: 'clips', chapterSource: 'labels', range: 'project', masteringSequenceId: '',
	});
	assert.equal(exportDialogOutputValue(settings), 'clips');
	assert.deepEqual(conformExportDialogOutput({
		...settings, range: 'selection', masteringSequenceId: 'old-sequence',
	}), settings);
});

test('clips are unavailable for single-file formats or a project without deliverable audio clips', () => {
	for (const context of [
		{ ...OUTPUT_CONTEXT, singleFileOnly: true },
		{ ...OUTPUT_CONTEXT, audioClipCount: 0 },
	]) {
		assert.equal(exportDialogOutputOptions(ENGLISH_COPY, context)
			.find(({ value }) => value === 'clips')?.disabled, true);
	}
});

test('clip requests omit an old mix loudness target and binaural render and carry no tail', () => {
	const request = createExportDialogRequest({
		...createExportDialogInitialSettings({ sampleRate: 48_000 }),
		...exportDialogOutputSettings('clips'),
		loudnessNormalization: 'ebu-r128', binaural: true, includeTail: true,
	});
	assert.equal(request.mode, 'clips');
	assert.equal(request.range, 'project');
	assert.equal(request.includeTail, false);
	assert.equal(Object.hasOwn(request, 'loudnessNormalization'), false);
	assert.equal(Object.hasOwn(request, 'binaural'), false);
});
