/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { DIRECT_PCM_MAXIMUM_FILE_BYTES, openDirectPcmDestination } from '../src/common/editor/controller/export/internal/direct/direct-pcm-export.ts';
import { prepareDirectWavDestination } from '../src/common/editor/controller/export/internal/direct/direct-wav-export.ts';
import { directPlan, createPreparedStream } from './helpers/direct-pcm-export-fixture.ts';
import { inspectWavLayout } from '../src/common/editor/wav.js';

test('direct PCM warning confirms before creating the destination and aborts rejected saves', async () => {
	for (const accept of [true, false]) {
		const destination = createPreparedStream();
		let warnings = 0;
		const opening = openDirectPcmDestination(destination.prepared, DIRECT_PCM_MAXIMUM_FILE_BYTES + 2, 'WAV', 'exact', {}, {
			async confirmFileSizeWarning(warning) {
				warnings++;
				assert.equal(warning.thresholdBytes, DIRECT_PCM_MAXIMUM_FILE_BYTES);
				assert.equal(destination.admissions.length, 0);
				return accept;
			},
		});
		if (accept) {
			assert.ok((await opening).destination);
			assert.deepEqual(destination.admissions, [[DIRECT_PCM_MAXIMUM_FILE_BYTES + 2, 'exact']]);
		} else {
			await assert.rejects(opening, { name: 'AbortError' });
			assert.equal(destination.admissions.length, 0);
			assert.equal(destination.abortCalls(), 1);
		}
		assert.equal(warnings, 1);
	}
});

test('exact RF64 plans above 65 GiB remain eligible for a confirmed direct save', async () => {
	const base = {
		...directPlan(), cart: null, channelCount: 1,
		encoding: { bitDepth: 16, floatingPoint: false, sampleFormat: 'int16' },
		ixml: null, markers: [], metadata: {}, outputFrames: 34_896_609_241,
		outputs: [{ fileName: 'large.wav', trackId: 'track' }],
	};
	const layout = inspectWavLayout({ totalFrames: base.outputFrames, channelCount: 1, sampleRate: base.sampleRate, bitDepth: 16, float: false });
	assert.equal(layout.container, 'rf64');
	assert.equal(layout.byteLength, DIRECT_PCM_MAXIMUM_FILE_BYTES + 2);
	const destination = createPreparedStream();
	let warnings = 0;
	const preparation = await prepareDirectWavDestination({ prepareSave: () => destination.prepared }, {
		...base, outputFileBytesPerRender: layout.byteLength,
	}, {
		async confirmFileSizeWarning() { warnings++; return true; },
	}, new AbortController().signal);
	assert.ok(preparation.destination);
	assert.equal(warnings, 1);
	assert.deepEqual(destination.admissions, [[layout.byteLength, 'exact']]);
	await preparation.destination.abort();
});
