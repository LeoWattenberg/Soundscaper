import assert from 'node:assert/strict';
import test from 'node:test';

import {
	LABEL_EXPORT_DIALOG_FORMATS,
	createLabelExportRequest,
	listLabelExportTracks,
	toggleLabelExportTrack,
} from '../src/common/editor/ui/label-export-dialog-model.ts';

const project = {
	tracks: [
		{ id: 'audio', type: 'audio', name: 'Audio', clipIds: [] },
		{ id: 'markers', type: 'label', name: 'Markers', labels: [{ id: 'one' }] },
		{ id: 'captions', type: 'label', name: 'Captions', labels: [{ id: 'two' }, { id: 'three' }] },
	],
};

test('label export dialog exposes the supported formats and label tracks only', () => {
	assert.deepEqual(LABEL_EXPORT_DIALOG_FORMATS, [
		{ id: 'txt', labelKey: 'exportLabelsTxt' },
		{ id: 'srt', labelKey: 'exportLabelsSrt' },
		{ id: 'vtt', labelKey: 'exportLabelsVtt' },
		{ id: 'json', labelKey: 'exportLabelsPodcastJson' },
	]);
	assert.deepEqual(listLabelExportTracks(project), [
		{ id: 'markers', name: 'Markers', labelCount: 1 },
		{ id: 'captions', name: 'Captions', labelCount: 2 },
	]);
});

test('label export requests retain project track order and reject empty selections', () => {
	const tracks = listLabelExportTracks(project);
	assert.deepEqual(createLabelExportRequest('vtt', ['captions', 'stale', 'markers', 'captions'], tracks), {
		format: 'vtt',
		trackIds: ['markers', 'captions'],
	});
	assert.deepEqual(toggleLabelExportTrack(['markers', 'captions'], 'markers', false), ['captions']);
	assert.deepEqual(toggleLabelExportTrack(['captions'], 'markers', true), ['captions', 'markers']);
	assert.throws(() => createLabelExportRequest('txt', [], tracks), /label track/i);
	assert.throws(() => createLabelExportRequest('csv', ['markers'], tracks), /format/i);
});
