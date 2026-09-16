/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioEditorFileService } from '../src/common/editor/file-service.js';

test('desktop destination copy reports acknowledged progress and completion after publication', async () => {
	const events: (readonly [string, number?])[] = [];
	const service = createAudioEditorFileService({ bridge: {
		async chooseSaveTarget() { return { id: 'progress-target', name: 'mix.wav' }; },
		async beginWrite() { return { writeId: 'progress-write', chunkSize: 2 }; },
		async writeChunk({ offset, bytes }: { offset: number; bytes: Uint8Array }) { events.push(['ack', offset + bytes.length]); return { nextOffset: offset + bytes.length }; },
		async finishWrite() { events.push(['finish']); return { byteLength: 4 }; },
	} });
	await service.saveFile({ purpose: 'audio', suggestedName: 'mix.wav', blob: new Blob([Uint8Array.of(1, 2, 3, 4)]),
		onProgress: (fraction: number) => { events.push(['progress', fraction]); } });
	assert.deepEqual(events, [['progress', 0], ['ack', 2], ['progress', 0.5], ['ack', 4], ['progress', 0.999], ['finish'], ['progress', 1]]);
});
