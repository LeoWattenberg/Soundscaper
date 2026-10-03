/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioEditorFileService } from '../src/common/editor/file-service.js';
import { externalMediaFileReference } from '../src/common/editor/desktop-external-media.ts';
import { prepareAttributedImportOptions } from '../src/common/editor/controller/import/internal/imported-source-provenance.ts';
import { normalizeProjectImportOptions } from '../src/common/editor/controller/import/internal/project-import-options.ts';

test('desktop selected files carry their reference through read cleanup and import attribution', async () => {
	const captured: unknown[] = [], released: string[] = [];
	const id = 'a'.repeat(64), token = 'native-external-reference';
	const service = createAudioEditorFileService({
		bridge: {
			captureExternalMedia: async (value: unknown) => { captured.push(value); return token; },
			releaseRead: async (value: string) => { released.push(value); },
		},
		fetch: async () => new Response('original', { headers: { 'Content-Length': '8' } }),
	});
	const file = await service.openReadDescriptor({ id, name: 'original.mp3', size: 8, mimeType: 'audio/mpeg',
		readProfile: 'materialized-v1', url: 'https://example.invalid/original' });
	assert.deepEqual(captured, [id]);
	assert.deepEqual(released, [id]);
	assert.equal(externalMediaFileReference(file), token);
	await service.captureExternalMediaFile(file);
	assert.deepEqual(captured, [id], 'the original capability is retired and must not be requested again');
	const options = await prepareAttributedImportOptions(file, normalizeProjectImportOptions({}, 'Invalid timeline position.'), () => 'attribution');
	assert.equal(options.externalMedia?.reference, token);
	assert.equal(options.externalMedia?.byteLength, 8);
	assert.match(options.externalMedia!.sha256, /^[a-f0-9]{64}$/u);
});

test('desktop drops capture the actual File while browser and generated files remain unreferenced', async () => {
	const file = new File(['external'], 'dropped.mp3');
	const generated = new File(['generated'], 'generated.wav');
	const service = createAudioEditorFileService({ bridge: {
		captureExternalMedia: async (value: unknown) => value === file ? 'dropped-file-reference' : null,
	} });
	await service.captureExternalMediaFile(file);
	await service.captureExternalMediaFile(generated);
	assert.equal(externalMediaFileReference(file), 'dropped-file-reference');
	assert.equal(externalMediaFileReference(generated), null);
	const browser = createAudioEditorFileService({ bridge: null });
	const browserFile = new File(['browser'], 'browser.wav');
	await browser.captureExternalMediaFile(browserFile);
	assert.equal(externalMediaFileReference(browserFile), null);
});
