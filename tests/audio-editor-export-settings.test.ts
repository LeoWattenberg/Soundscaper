import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeEditorExportSettings } from '../src/common/editor/controller/export-settings.ts';

test('export settings normalize formats, codec controls, and project defaults deterministically', () => {
	assert.deepEqual(normalizeEditorExportSettings({}, 48_000), {
		mode: 'mix',
		range: 'project',
		format: 'wav',
		bitDepth: 24,
		sampleFormat: 'int24',
		dither: 'triangular',
		bitRate: undefined,
		quality: undefined,
		compressionLevel: undefined,
		sampleRate: 48_000,
		channelMapping: 'preserve',
		metadata: {},
		extension: undefined,
		mimeType: undefined,
		customArguments: undefined,
		includeTail: true,
		measureLoudness: false,
		loudnessNormalization: null,
	});

	const opus = normalizeEditorExportSettings({
		mode: 'stems',
		range: 'selection',
		format: 'opus',
		bitDepth: 32,
		bitRate: '96',
		sampleRate: '44100',
		includeTail: false,
	}, 48_000);
	assert.equal(opus.mode, 'stems');
	assert.equal(opus.format, 'opus');
	assert.equal(opus.sampleFormat, 'float32');
	assert.equal(opus.dither, 'none');
	assert.equal(opus.bitRate, 96);
	assert.equal(opus.sampleRate, 44_100);
	assert.equal(opus.includeTail, false);
});

test('unknown values cannot escape the supported export inventory', () => {
	const value = normalizeEditorExportSettings({
		mode: 'unknown',
		range: 'unknown',
		format: 'executable',
		bitDepth: 12,
		quality: 'not-a-number',
		compressionLevel: 'not-a-number',
	}, 96_000);
	assert.equal(value.mode, 'mix');
	assert.equal(value.range, 'project');
	assert.equal(value.format, 'wav');
	assert.equal(value.bitDepth, 24);
	assert.equal(value.sampleRate, 96_000);
});

test('BW64 export is mix-only and carries broadcast and ADM metadata', () => {
	const bext = { description: 'Immersive master' };
	const adm = { mode: 'authored' };
	const value = normalizeEditorExportSettings({
		mode: 'stems',
		format: 'bw64',
		bext,
		adm,
	}, 48_000);
	assert.equal(value.mode, 'mix');
	assert.equal(value.format, 'bw64');
	assert.equal(value.bext, bext);
	assert.equal(value.adm, adm);
	assert.equal(normalizeEditorExportSettings({ format: 'bw64', bitDepth: 20 }, 48_000).sampleFormat, 'int20');
});
