/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	AIFF_MAXIMUM_FILE_BYTES,
	createAiffStreamEncoder,
	encodeAiff,
	inspectAiffLayout,
} from '../src/common/editor/aiff.js';
import { createExportPlan } from '../src/common/editor/export.js';
import {
	createCurrentAudioEditorProject,
} from '../src/common/editor/project-current.ts';

test('AIFF layout reports exact integer PCM geometry shared by the encoder', () => {
	const layout = inspectAiffLayout({
		sampleRate: 44_100,
		channelCount: 2,
		totalFrames: 2,
		sampleFormat: 'int16',
	});
	assert.deepEqual(layout, {
		container: 'aiff',
		byteLength: 62,
		headerByteLength: 54,
		formSize: 54,
		dataByteLength: 8,
		dataPadByteLength: 0,
		trailingByteLength: 0,
	});
	const encoded = encodeAiff([
		Float32Array.of(-1, 1),
		Float32Array.of(0.5, -0.5),
	], { sampleRate: 44_100, sampleFormat: 'int16', dither: 'none' });
	assert.ok(encoded instanceof Uint8Array);
	assert.equal(encoded.byteLength, layout.byteLength);
	assert.equal(new DataView(encoded.buffer).getUint32(4, false), layout.formSize);
});

test('AIFF layout accounts for odd PCM padding and trailing metadata once', () => {
	const options = {
		channelCount: 1,
		totalFrames: 1,
		sampleFormat: 'int24',
		dither: 'none',
		metadata: { title: 'Äther', comments: 'Exact AIFF layout' },
	} as const;
	const layout = inspectAiffLayout(options);
	assert.equal(layout.container, 'aiff');
	assert.equal(layout.headerByteLength, 54);
	assert.equal(layout.dataByteLength, 3);
	assert.equal(layout.dataPadByteLength, 1);
	assert.ok(layout.trailingByteLength > 8);
	assert.equal(layout.byteLength, 54 + 3 + 1 + layout.trailingByteLength);

	const encoder = createAiffStreamEncoder({ ...options, collect: false });
	encoder.write([Float32Array.of(0.25)]);
	const finalized = encoder.finalize();
	assert.ok(!(finalized instanceof Uint8Array));
	assert.equal(finalized.byteLength, layout.byteLength);
	assert.equal(finalized.padBytes, layout.dataPadByteLength);
	assert.equal(finalized.metadataBytes, layout.trailingByteLength);
	assert.equal(new DataView(finalized.header.buffer).getUint32(4, false), layout.formSize);
});

test('AIFF-C float layout includes its extended header and matches encoded bytes', () => {
	const layout = inspectAiffLayout({
		channelCount: 1,
		totalFrames: 1,
		sampleFormat: 'float32',
	});
	assert.deepEqual(layout, {
		container: 'aifc',
		byteLength: 96,
		headerByteLength: 92,
		formSize: 88,
		dataByteLength: 4,
		dataPadByteLength: 0,
		trailingByteLength: 0,
	});
	const encoded = encodeAiff([Float32Array.of(1.25)], { sampleFormat: 'float32' });
	assert.ok(encoded instanceof Uint8Array);
	assert.equal(encoded.byteLength, layout.byteLength);
	assert.equal(String.fromCharCode(...encoded.subarray(8, 12)), 'AIFC');
});

test('AIFF layout enforces the unsigned 32-bit FORM boundary without PCM allocation', () => {
	const maximumFrames = 2_147_483_624;
	const maximum = inspectAiffLayout({
		channelCount: 1,
		totalFrames: maximumFrames,
		sampleFormat: 'int16',
	});
	assert.equal(AIFF_MAXIMUM_FILE_BYTES, 0xffff_ffff + 8);
	assert.equal(maximum.byteLength, AIFF_MAXIMUM_FILE_BYTES - 1);
	assert.equal(maximum.formSize, 0xffff_fffe);
	assert.throws(
		() => inspectAiffLayout({
			channelCount: 1,
			totalFrames: maximumFrames + 1,
			sampleFormat: 'int16',
		}),
		/32-bit FORM size/iu,
	);
});

test('AIFF export plans expose the exact encoder file size', () => {
	const project = createCurrentAudioEditorProject({
		id: 'exact-aiff-layout',
		title: 'Exact AIFF layout',
		now: '2026-07-30T00:00:00.000Z',
		sampleRate: 48_000,
		masterChannels: 2,
	});
	const options = {
		format: 'aiff',
		range: { startFrame: 0, endFrame: 48_001 },
		includeTail: false,
		sampleRate: 44_100,
		channelCount: 1,
		sampleFormat: 'int24',
		metadata: { title: 'Planned AIFF' },
		date: '2026-07-30',
	} as const;
	const plan = createExportPlan(project, options);
	const layout = inspectAiffLayout({
		sampleRate: plan.sampleRate,
		channelCount: plan.channelCount,
		totalFrames: plan.outputFrames,
		sampleFormat: plan.encoding.sampleFormat,
		metadata: plan.metadata,
	});
	assert.equal(plan.outputFileBytesPerRender, layout.byteLength);
	assert.equal(plan.requiredTemporaryBytes, layout.byteLength);
	assert.equal(plan.outputs[0].fileName, 'Exact-AIFF-layout-mix-2026-07-30.aiff');

	const floatPlan = createExportPlan(project, { ...options, sampleFormat: 'float32' });
	const floatLayout = inspectAiffLayout({
		sampleRate: floatPlan.sampleRate,
		channelCount: floatPlan.channelCount,
		totalFrames: floatPlan.outputFrames,
		sampleFormat: floatPlan.encoding.sampleFormat,
		metadata: floatPlan.metadata,
	});
	assert.equal(floatLayout.container, 'aifc');
	assert.equal(floatPlan.outputFileBytesPerRender, floatLayout.byteLength);
	assert.equal(floatPlan.requiredTemporaryBytes, floatLayout.byteLength);
});
