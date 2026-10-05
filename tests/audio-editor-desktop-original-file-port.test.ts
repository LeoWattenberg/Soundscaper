/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioEditorFileService } from '../src/common/editor/file-service.js';
import { desktopOriginalFileFor, registerDesktopOriginalFile, releaseDesktopOriginalFile, retainDesktopOriginalFile } from '../src/common/editor/desktop-original-file-port.ts';

const original = Object.freeze({ id: 'a'.repeat(48), name: 'original.wav' });

test('original file capabilities are opaque, validated and tied to the imported object', () => {
	const file = new Blob(['audio']);
	assert.equal(desktopOriginalFileFor(file), null);
	registerDesktopOriginalFile(file, original);
	assert.deepEqual(desktopOriginalFileFor(file), original);
	assert.equal(desktopOriginalFileFor(new Blob(['audio'])), null);
	for (const value of [null, {}, { ...original, id: '/tmp/audio.wav' }, { ...original, name: '../audio.wav' }]) {
		const candidate = new Blob();
		registerDesktopOriginalFile(candidate, value);
		assert.equal(desktopOriginalFileFor(candidate), null);
	}
});

test('desktop materialization retains the overwrite capability after the read is released', async () => {
	const released: string[] = [];
	const service = createAudioEditorFileService({
		bridge: { releaseRead: async (id: string) => { released.push(id); } },
		fetch: async () => new Response('audio', { headers: { 'Content-Length': '5' } }),
	});
	const file = await service.openReadDescriptor({
		id: 'b'.repeat(64), name: original.name, size: 5, mimeType: 'audio/wav',
		readProfile: 'materialized-v1', url: 'scape-file://read/audio', originalFile: original,
	});
	assert.deepEqual(desktopOriginalFileFor(file), original);
	assert.deepEqual(released, ['b'.repeat(64)]);
});

test('desktop overwrite targets use the existing transactional writer without a save dialog', async () => {
	const calls: unknown[] = [];
	const service = createAudioEditorFileService({ bridge: {
		prepareOriginalOverwrite: async (id: string) => { calls.push(['prepare', id]); return { id: 'save', name: original.name }; },
		releaseOriginalFile: async (id: string) => { calls.push(['release', id]); },
		chooseSaveTarget: () => { throw new Error('Overwrite must not open the save dialog.'); },
		beginWrite: async () => ({ writeId: 'write', chunkSize: 100 }),
		writeChunk: async (request: { offset: number; bytes: Uint8Array }) => ({ nextOffset: request.offset + request.bytes.byteLength }),
		finishWrite: async () => ({ byteLength: 5 }),
	} });
	const target = await service.prepareOriginalOverwrite(original.id);
	const result = await service.saveFile({ purpose: 'audio', target, suggestedName: 'project-mix.wav', blob: new Blob(['audio']) });
	assert.ok('method' in result);
	assert.equal(result.method, 'desktop');
	assert.equal(result.fileName, original.name);
	await service.releaseOriginalFile(original.id);
	assert.deepEqual(calls, [['prepare', original.id], ['release', original.id]]);
});

test('original-file release callbacks retire the capability once', async () => {
	const released: string[] = [];
	registerDesktopOriginalFile(new Blob(), original, async (id) => { released.push(id); });
	await releaseDesktopOriginalFile(original);
	await releaseDesktopOriginalFile(original);
	assert.deepEqual(released, [original.id]);
});

test('browser and older desktop bridges do not offer original-file overwrite', () => {
	for (const bridge of [null, {}]) {
		const service = createAudioEditorFileService({ bridge });
		assert.equal(service.originalOverwriteAvailable, false);
	}
});

test('scoped reads release unused overwrite authorities, including unmaterialized failures', async () => {
	const released: string[] = [];
	const service = createAudioEditorFileService({
		bridge: { releaseRead: async () => true, releaseOriginalFile: async (id: string) => { released.push(id); } },
		fetch: async () => new Response('audio', { headers: { 'Content-Length': '5' } }),
	});
	const descriptor = { id: 'c'.repeat(64), name: original.name, size: 5,
		mimeType: 'audio/wav', readProfile: 'materialized-v1', url: 'scape-file://read/audio', originalFile: original };
	await service.withReadDescriptors([descriptor], {}, async () => undefined);
	assert.deepEqual(released, [original.id]);
	await assert.rejects(service.withReadDescriptors([{ ...descriptor, readProfile: 'invalid' }], {}, async () => undefined));
	assert.deepEqual(released, [original.id, original.id]);
	await service.withReadDescriptors([descriptor], {}, async () => { retainDesktopOriginalFile(original); });
	assert.deepEqual(released, [original.id, original.id]);
	await releaseDesktopOriginalFile(original);
	assert.deepEqual(released, [original.id, original.id, original.id]);
});
