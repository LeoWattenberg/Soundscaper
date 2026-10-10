/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createFreesoundUploadQueue } from '../src/common/editor/ui/workspace/freesound-upload-queue.ts';

const wave = Uint8Array.from(Buffer.from((await readFile(new URL('./fixtures/bwfmetaedit-ixml-clock.wav.base64', import.meta.url), 'utf8')).trim(), 'base64'));
const aifc = Uint8Array.from(Buffer.from((await readFile(new URL('./fixtures/python-uncompressed.aif.base64', import.meta.url), 'utf8')).trim(), 'base64'));

for (const input of [
	{ extension: 'wav', bytes: wave, converts: false },
	{ extension: 'bwf', bytes: wave, converts: true },
	{ extension: 'aifc', bytes: aifc, converts: true },
]) test(`the published Freesound file queue admits an ordinary association-free ${input.extension} recording`, async () => {
	const prepared: string[] = [];
	const uploads: File[] = [];
	const queue = createFreesoundUploadQueue({
		prepareFile: async file => {
			prepared.push(file.name);
			assert.deepEqual(new Uint8Array(await file.arrayBuffer()), input.bytes);
			return new File([wave.buffer], 'production-take.wav', { type: 'audio/wav' });
		},
		upload: async file => {
			uploads.push(file);
			return { uploadFilename: file.name };
		},
		describe: async () => ({ status: 'submitted' }),
		createId: () => 'production-upload',
	});
	queue.enqueueFiles([new File([input.bytes.buffer], `production-take.${input.extension}`)]);
	while (queue.getSnapshot().active) await new Promise<void>(resolve => setImmediate(resolve));
	assert.deepEqual(prepared, input.converts ? [`production-take.${input.extension}`] : []);
	assert.equal(uploads.length, 1);
	assert.equal(uploads[0]?.name, 'production-take.wav');
	assert.equal(uploads[0]?.type, 'audio/wav');
	assert.deepEqual(queue.getSnapshot().items.map(({ status }) => status), ['ready-to-publish']);
});
