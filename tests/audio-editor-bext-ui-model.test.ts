import test from 'node:test';
import assert from 'node:assert/strict';

import {
	createBextMetadataEditorValue,
	normalizeBextMetadataEditorValue,
} from '../src/common/editor/ui/bext-metadata-editor-model.ts';

test('BEXT editor defaults derive identity and UTC origination fields from the project', () => {
	assert.deepEqual(createBextMetadataEditorValue({
		title: 'Field recording',
		createdAt: '2026-07-28T18:19:20.987Z',
		metadata: {
			title: 'Episode 4',
			artist: 'Soundscaper Unit',
			bext: null,
		},
	}), {
		version: 2,
		description: 'Episode 4',
		originator: 'Soundscaper Unit',
		originatorReference: '',
		originationDate: '2026-07-28',
		originationTime: '18:19:20',
		timeReference: '0',
		umid: '',
		loudnessValue: null,
		loudnessRange: null,
		maxTruePeakLevel: null,
		maxMomentaryLoudness: null,
		maxShortTermLoudness: null,
		codingHistory: '',
	});
});

test('BEXT editor defaults make Unicode project identity safe for the ASCII file fields', () => {
	const value = createBextMetadataEditorValue({
		title: 'Café München',
		createdAt: '2026-07-28T18:19:20.987Z',
		metadata: { artist: 'Große Bühne', bext: null },
	});
	assert.equal(value.description, 'Cafe Munchen');
	assert.equal(value.originator, 'Grosse Buhne');
});

test('BEXT editor preserves initialized metadata while presenting version 2', () => {
	const initialized = normalizeBextMetadataEditorValue({
		version: 1,
		description: 'Location mix',
		originator: 'Unit A',
		originatorReference: 'REF-99',
		originationDate: '2026-07-27',
		originationTime: '23:59:58',
		timeReference: '9007199254740993',
		umid: '060A2B34',
		loudnessValue: -23,
		loudnessRange: 7.4,
		maxTruePeakLevel: -1.2,
		maxMomentaryLoudness: -18.5,
		maxShortTermLoudness: -20.1,
		codingHistory: 'A=PCM,F=48000,W=24,M=stereo,T=Soundscaper',
	});

	assert.equal(initialized.version, 2);
	assert.equal(initialized.timeReference, '9007199254740993');
	assert.equal(initialized.loudnessValue, -23);
	assert.equal(initialized.codingHistory, 'A=PCM,F=48000,W=24,M=stereo,T=Soundscaper');
});

test('BEXT editor normalization preserves invalid TimeReference text for validation without replacing the origin', () => {
	const normalized = normalizeBextMetadataEditorValue({
		description: 42,
		timeReference: 'not-a-sample-count',
		loudnessValue: Number.NaN,
		loudnessRange: '',
	});

	assert.equal(normalized.description, '42');
	assert.equal(normalized.timeReference, 'not-a-sample-count');
	assert.equal(normalized.loudnessValue, null);
	assert.equal(normalized.loudnessRange, null);
	assert.equal(normalizeBextMetadataEditorValue({
		timeReference: '18446744073709551616',
	}).timeReference, '18446744073709551616');
});
