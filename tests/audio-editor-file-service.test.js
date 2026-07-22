import assert from 'node:assert/strict';
import test from 'node:test';

import { createAudioEditorFileService } from '../src/common/editor/file-service.js';

test('desktop file service streams acknowledged chunks and applies backpressure', async () => {
	const calls = [];
	let activeWrite = false;
	const bridge = {
		async chooseSaveTarget(request) {
			calls.push(['choose', request]);
			return { id: 'target-1', name: 'mix.wav' };
		},
		async beginWrite(request) {
			calls.push(['begin', request]);
			return { writeId: 'write-1', chunkSize: 700_000 };
		},
		async writeChunk(request) {
			assert.equal(activeWrite, false);
			activeWrite = true;
			await Promise.resolve();
			calls.push(['chunk', request.offset, request.bytes.byteLength]);
			activeWrite = false;
			return { nextOffset: request.offset + request.bytes.byteLength };
		},
		async finishWrite(writeId) {
			calls.push(['finish', writeId]);
			return { byteLength: 1_500_001 };
		},
	};
	const service = createAudioEditorFileService({ bridge });
	const result = await service.saveFile({
		purpose: 'audio',
		suggestedName: 'mix.wav',
		mimeType: 'audio/wav',
		blob: new Blob([new Uint8Array(1_500_001)]),
	});

	assert.deepEqual(calls, [
		['choose', { purpose: 'audio', suggestedName: 'mix.wav', mimeType: 'audio/wav' }],
		['begin', { targetId: 'target-1', size: 1_500_001 }],
		['chunk', 0, 700_000],
		['chunk', 700_000, 700_000],
		['chunk', 1_400_000, 100_001],
		['finish', 'write-1'],
	]);
	assert.deepEqual(result, { method: 'desktop', fileName: 'mix.wav', size: 1_500_001 });
});

test('desktop file service aborts a desynchronized write without publishing it', async () => {
	const aborted = [];
	const service = createAudioEditorFileService({
		bridge: {
			async chooseSaveTarget() { return { id: 'target-2', name: 'labels.vtt' }; },
			async beginWrite() { return { writeId: 'write-2', chunkSize: 10 }; },
			async writeChunk() { return { nextOffset: 9 }; },
			async finishWrite() { throw new Error('must not finish'); },
			async abortWrite(writeId) { aborted.push(writeId); },
		},
	});

	await assert.rejects(() => service.saveFile({
		purpose: 'labels',
		suggestedName: 'labels.vtt',
		text: 'WEBVTT\n',
		mimeType: 'text/vtt',
	}), /lost synchronization/);
	assert.deepEqual(aborted, ['write-2']);
});

test('desktop read descriptors become named files and are always released', async () => {
	const released = [];
	const service = createAudioEditorFileService({
		bridge: { async releaseRead(id) { released.push(id); } },
		fetch: async () => new Response(new Blob(['SQLite format 3'], { type: 'application/x-audacity-project' })),
	});
	const file = await service.openReadDescriptor({
		id: 'read-1',
		url: 'soundscaper-app://read/read-1',
		name: 'Session.aup4',
		mimeType: 'application/x-audacity-project',
		lastModified: 123,
	});

	assert.equal(file.name, 'Session.aup4');
	assert.equal(file.lastModified, 123);
	assert.equal(await file.text(), 'SQLite format 3');
	assert.deepEqual(released, ['read-1']);
});

test('browser file service preserves anchor-download behavior', async () => {
	const anchors = [];
	const revoked = [];
	const service = createAudioEditorFileService({
		bridge: null,
		document: {
			body: { append(anchor) { anchors.push(anchor); } },
			createElement() {
				return { click() { this.clicked = true; }, remove() { this.removed = true; } };
			},
		},
		urlApi: {
			createObjectURL: () => 'blob:download',
			revokeObjectURL: (url) => revoked.push(url),
		},
		setTimeout: (callback) => callback(),
	});
	const result = await service.saveFile({ purpose: 'preset', suggestedName: 'voice.json', text: '{}' });

	assert.deepEqual(result, { method: 'download', fileName: 'voice.json', size: 2 });
	assert.equal(anchors[0].href, 'blob:download');
	assert.equal(anchors[0].download, 'voice.json');
	assert.equal(anchors[0].clicked, true);
	assert.equal(anchors[0].removed, true);
	assert.deepEqual(revoked, ['blob:download']);
});
