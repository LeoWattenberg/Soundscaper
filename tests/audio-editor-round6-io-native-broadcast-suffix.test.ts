/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { acceptsFile, mimeTypeForPath, validateFileChoice } from '../desktop/validation.js';
import { createAudioEditorFileService } from '../src/common/editor/file-service.js';
import { inspectAiffBlobPcm } from '../src/common/editor/aiff-pcm-chunk-reader.ts';
import { inspectWavBlobPcm } from '../src/common/editor/wav-import.js';
import { nativeSidecarFixture } from './helpers/framescaper-native-sidecar-fixture.ts';

// The established production fixture is unchanged BWF MetaEdit output over
// an ordinary one-second Python wave recording. BWF is its conventional suffix.
const recording = Buffer.from((await readFile(new URL('./fixtures/bwfmetaedit-ixml-clock.wav.base64', import.meta.url), 'utf8')).trim(), 'base64');
const aifc = Buffer.from((await readFile(new URL('./fixtures/python-uncompressed.aif.base64', import.meta.url), 'utf8')).trim(), 'base64');

for (const format of [
	{ extension: 'BWF', bytes: recording, type: 'audio/wav', rate: 48_000 },
	{ extension: 'AIFC', bytes: aifc, type: 'audio/aiff', rate: 8_000 },
]) for (const purpose of ['project', 'media', 'audio']) {
	test(`the ordinary native ${purpose} picker reads ${format.extension} through its existing selected range`, async () => {
		const native = await nativeSidecarFixture(`production-take.${format.extension}`, format.bytes);
		try {
			const service = createAudioEditorFileService({ bridge: native.bridge, fetch: native.fetch });
			const descriptors = await service.chooseFiles({ purpose, multiple: false });
			assert.equal(descriptors.length, 1);
			assert.equal(descriptors[0].readProfile, 'selected-range-v1');
			assert.equal(descriptors[0].mimeType, format.type);
			assert.ok(validateFileChoice({ purpose }).filters[0].extensions.includes(format.extension.toLowerCase()));
			await service.withReadDescriptors(descriptors, {}, async (files: readonly Blob[]) => {
				if (format.extension === 'BWF') {
					const descriptor = await inspectWavBlobPcm(files[0]);
					assert.equal(descriptor.sampleRate, format.rate);
					assert.equal(descriptor.frameCount, format.rate);
					assert.ok(descriptor.ixml?.rawXml.includes('<NOTE>Clean boom take</NOTE>'));
				} else {
					const descriptor = await inspectAiffBlobPcm(files[0]);
					assert.ok(descriptor);
					assert.equal(descriptor.container, 'aifc');
					assert.equal(descriptor.sampleRate, format.rate);
					assert.equal(descriptor.frameCount, format.rate);
				}
			});
			assert.equal(native.releases.length, 1);
		} finally { await native.close(); }
	});
}

test('the existing WAV suffix and unrelated native refusals retain their admission', () => {
	assert.equal(acceptsFile('media', '/production/take.wav'), true);
	assert.equal(mimeTypeForPath('/production/take.wav'), 'audio/wav');
	assert.equal(acceptsFile('media', '/production/take.bin'), false);
	assert.equal(acceptsFile('video', '/production/take.bwf'), false);
	assert.equal(acceptsFile('labels', '/production/take.bwf'), false);
});
