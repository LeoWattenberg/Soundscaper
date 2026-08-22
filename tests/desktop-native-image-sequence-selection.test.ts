/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
	FramescaperNativeImageSequenceSelectionBroker,
} from '../desktop/native-image-sequence-selection.ts';

test('the image-sequence broker exposes pathless exact bounded range reads to its owner', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'framescaper-image-sequence-'));
	const first = join(directory, 'shot.0001.png');
	const second = join(directory, 'shot.0002.png');
	await writeFile(first, Uint8Array.from([1, 2, 3, 4]));
	await writeFile(second, Uint8Array.from([5, 6, 7]));
	const owner = Object.freeze({ id: 'renderer-owner' });
	const broker = new FramescaperNativeImageSequenceSelectionBroker({
		selectFiles: async () => [first, second],
		mintOpaqueId: (() => {
			let value = 0;
			return () => `${(++value).toString(16).padStart(40, '0')}`;
		})(),
	});

	const selected = await broker.select(owner);
	assert.ok(selected);
	assert.deepEqual(Object.keys(selected).sort(), ['files', 'selectionId']);
	assert.equal(JSON.stringify(selected).includes(directory), false);
	assert.deepEqual(selected.files.map(({ name, byteLength }) => ({ name, byteLength })), [
		{ name: 'shot.0001.png', byteLength: 4 },
		{ name: 'shot.0002.png', byteLength: 3 },
	]);
	const bytes = await broker.read(owner, {
		selectionId: selected.selectionId,
		fileId: selected.files[0]!.fileId,
		offset: 1,
		length: 2,
	});
	assert.deepEqual([...bytes], [2, 3]);
	await assert.rejects(() => broker.read({}, {
		selectionId: selected.selectionId,
		fileId: selected.files[0]!.fileId,
		offset: 0,
		length: 1,
	}), /owner/u);
	assert.equal(await broker.release(owner, { selectionId: selected.selectionId }), true);
	await assert.rejects(() => broker.read(owner, {
		selectionId: selected.selectionId,
		fileId: selected.files[0]!.fileId,
		offset: 0,
		length: 1,
	}), /unavailable/u);
});

test('the image-sequence broker refuses changed, linked, duplicate, and mixed-format selections', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'framescaper-image-sequence-hostile-'));
	const first = join(directory, 'shot.0001.png');
	const duplicate = join(directory, 'other.0001.png');
	await writeFile(first, Uint8Array.from([1, 2, 3]));
	await writeFile(duplicate, Uint8Array.from([1, 2, 3]));
	const owner = Object.freeze({ id: 'renderer-owner' });
	const broker = new FramescaperNativeImageSequenceSelectionBroker({
		selectFiles: async () => [first], mintOpaqueId: () => 'a'.repeat(40),
	});
	const selected = await broker.select(owner);
	assert.ok(selected);
	await writeFile(first, Uint8Array.from([9, 9, 9]));
	await assert.rejects(() => broker.read(owner, {
		selectionId: selected.selectionId, fileId: selected.files[0]!.fileId,
		offset: 0, length: 1,
	}), /changed/u);

	for (const paths of [[first, first], [first, duplicate]]) {
		const hostile = new FramescaperNativeImageSequenceSelectionBroker({
			selectFiles: async () => paths, mintOpaqueId: () => 'b'.repeat(40),
		});
		await assert.rejects(() => hostile.select(owner), /duplicate|one sequence/u);
	}
});
