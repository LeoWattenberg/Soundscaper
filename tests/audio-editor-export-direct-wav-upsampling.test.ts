/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createEditorExportService } from '../src/common/editor/controller/export/internal/export-service.ts';
import { inspectWavLayout } from '../src/common/editor/wav.js';
import { createDirectPcmExportFixture, createPreparedStream, directPlan } from './helpers/direct-pcm-export-fixture.ts';

test('direct WAV upsampling captures at project rate before converting and keeps the audio clock running', async () => {
	const sampleRate = 384_000;
	const byteLength = inspectWavLayout({
		container: 'auto', sampleRate, channelCount: 2, totalFrames: 2,
		bitDepth: 24, float: false, metadata: {}, markers: [], ixml: null,
	}).byteLength;
	const plan = {
		...directPlan({ sampleRate, outputFileBytesPerRender: byteLength }),
		cart: null, ixml: null, markers: [], metadata: {},
	};
	const fixture = createDirectPcmExportFixture(plan, {
		encoderFinalByteLength: byteLength,
		encoderInitialChunks: [new Uint8Array(byteLength - 3)],
	});
	const destination = createPreparedStream();
	fixture.setPrepared(destination.prepared);
	await createEditorExportService(fixture.runtime).handleExportAction('export', { useFileSystemAccess: true });

	assert.equal(fixture.renderRequests[0].suspendForBackpressure, false);
	assert.ok(fixture.calls.includes('temporary:create'));
	assert.ok(fixture.calls.includes('temporary:remove'));
	assert.ok(fixture.calls.indexOf('render:done') < fixture.calls.indexOf('encoder:write:1'));
	assert.equal(destination.commitCalls(), 1);
	assert.deepEqual(fixture.errors, []);
});
