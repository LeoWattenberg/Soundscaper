/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { MediaRepository } from '../src/common/editor/storage/media-repository.ts';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';
import { OpfsRepository } from '../src/common/editor/storage/opfs-repository.ts';

test('whole-blob media writes are refused during maintenance', async () => {
	const media = repository();
	const maintenance = media.beginAssetMaintenance();
	await assert.rejects(
		media.writeAsset('blocked', new Blob(['blocked'])),
		/Media asset storage is under maintenance/u,
	);
	maintenance.release();
});

test('maintenance aborts an admitted whole-blob media write before publication', async () => {
	let releaseWrite!: () => void;
	let markWriteStarted!: () => void;
	const writeStarted = new Promise<void>((resolve) => { markWriteStarted = resolve; });
	const writeGate = new Promise<void>((resolve) => { releaseWrite = resolve; });
	const files = new Map<string, Blob>();
	const directory = opfsDirectory(files, async () => {
		markWriteStarted();
		await writeGate;
	});
	const media = repository(directory);
	const write = media.writeAsset('racing', new Blob(['racing']));
	await writeStarted;

	const maintenance = media.beginAssetMaintenance();
	const aborting = maintenance.abortActive();
	releaseWrite();
	await assert.rejects(write, { name: 'AbortError' });
	await aborting;
	assert.equal(await media.getAssetMetadata('racing'), null);
	assert.equal(files.size, 0);
	maintenance.release();
});

function repository(opfsRoot: FileSystemDirectoryHandle | null = null): MediaRepository {
	const memory = getMemoryDatabase(`media-write-maintenance-${String(Date.now())}-${String(Math.random())}`);
	return new MediaRepository(
		{ memory, database: async () => null },
		new OpfsRepository({ preferOpfs: opfsRoot !== null, opfsRoot }),
	);
}

function opfsDirectory(
	files: Map<string, Blob>,
	writeBody: (body: Blob) => Promise<void>,
): FileSystemDirectoryHandle {
	const directory = {
		async getDirectoryHandle() { return directory; },
		async getFileHandle(path: string, options: Readonly<{ create?: boolean }> = {}) {
			if (!files.has(path) && !options.create) throw new Error('missing');
			if (!files.has(path)) files.set(path, new Blob());
			return {
				async createWritable() {
					return {
						async write(body: Blob) { await writeBody(body); files.set(path, body); },
						async close() {},
						async abort() { files.delete(path); },
					};
				},
				async getFile() { return files.get(path) as Blob; },
			};
		},
		async removeEntry(path: string) { files.delete(path); },
	};
	return directory as unknown as FileSystemDirectoryHandle;
}
