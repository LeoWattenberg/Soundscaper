/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAudioEditorProjectV9 } from '../src/common/editor/project-v9.ts';
import { createScapeArchiveByteSource } from '../src/common/editor/scape-archive-byte-source.ts';
import {
	exportScapeProject,
	importScapeProject,
	inspectScapeProject,
} from '../src/common/editor/scape-project.js';
import { createProjectStore } from '../src/common/editor/storage.js';

test('project inspection and import share the bounded archive byte-source path', async () => {
	const sourceStore = memoryStore('scape-project-byte-source-export');
	const targetStore = memoryStore('scape-project-byte-source-import');
	const project = createAudioEditorProjectV9({
		id: 'byte-source-project',
		title: 'Byte source project',
		now: '2026-07-30T00:00:00.000Z',
	});
	const exported = await exportScapeProject(project, sourceStore);
	assert.ok(exported.blob instanceof Blob);
	const archiveBytes = new Uint8Array(await exported.blob.arrayBuffer());
	const ranges: Array<Readonly<{ length: number; offset: number }>> = [];
	const source = createScapeArchiveByteSource({
		size: archiveBytes.byteLength,
		maximumReadBytes: 64,
		read: ({ offset, length }) => {
			ranges.push(Object.freeze({ length, offset }));
			return archiveBytes.slice(offset, offset + length);
		},
	});

	assert.deepEqual(
		await inspectScapeProject(source),
		await inspectScapeProject(exported.blob),
	);
	const imported = await importScapeProject(source, targetStore);
	assert.equal(imported.project.id, project.id);
	assert.equal((await targetStore.loadProject(project.id))?.title, project.title);
	assert.ok(ranges.length > 1);
	assert.ok(ranges.every(({ length }) => length <= 64));
	assert.ok(ranges.every(({ length }) => length < archiveBytes.byteLength));
});

test('project archive entry points reject unbranded byte-source lookalikes', async () => {
	const fakeSource = {
		maximumReadBytes: 1,
		size: 1,
		read: async () => Uint8Array.of(0),
	};

	await assert.rejects(
		inspectScapeProject(fakeSource),
		/trusted \.scape archive byte source/iu,
	);
	await assert.rejects(
		importScapeProject(fakeSource, memoryStore('scape-project-unbranded')),
		/trusted \.scape archive byte source/iu,
	);
});

function memoryStore(prefix: string): ReturnType<typeof createProjectStore> {
	return createProjectStore({
		indexedDB: null,
		databaseName: `${prefix}-${String(Date.now())}-${String(Math.random())}`,
	});
}
