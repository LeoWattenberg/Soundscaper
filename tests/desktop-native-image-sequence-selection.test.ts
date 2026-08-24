/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
	FRAMESCAPER_NATIVE_IMAGE_SEQUENCE_MAXIMUM_ACTIVE_SELECTIONS,
	FRAMESCAPER_NATIVE_IMAGE_SEQUENCE_MAXIMUM_ACTIVE_SELECTIONS_PER_OWNER,
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
	await unlink(first);
	await symlink(duplicate, first);
	await assert.rejects(() => broker.read(owner, {
		selectionId: selected.selectionId, fileId: selected.files[0]!.fileId,
		offset: 0, length: 1,
	}), /changed|symbolic|ELOOP/iu,
	'opening the selected pathname never follows a replacement symbolic link');
});

test('the image-sequence broker bounds retained selections per owner and globally', async () => {
	assert.equal(FRAMESCAPER_NATIVE_IMAGE_SEQUENCE_MAXIMUM_ACTIVE_SELECTIONS, 8);
	assert.equal(FRAMESCAPER_NATIVE_IMAGE_SEQUENCE_MAXIMUM_ACTIVE_SELECTIONS_PER_OWNER, 2);
	const directory = await mkdtemp(join(tmpdir(), 'framescaper-image-sequence-capacity-'));
	const frame = join(directory, 'shot.0001.png');
	await writeFile(frame, Uint8Array.from([1, 2, 3]));
	let opaque = 0;
	let chooserCalls = 0;
	const broker = new FramescaperNativeImageSequenceSelectionBroker({
		selectFiles: async () => { chooserCalls += 1; return [frame]; },
		mintOpaqueId: () => `${(++opaque).toString(16).padStart(40, '0')}`,
	});
	const owner = Object.freeze({ id: 'one-owner' });
	const first = await broker.select(owner);
	const second = await broker.select(owner);
	assert.ok(first && second);
	await assert.rejects(() => broker.select(owner), /capacity/u);
	assert.equal(chooserCalls, 2, 'capacity is reserved before opening another chooser');
	assert.equal(await broker.release(owner, { selectionId: first.selectionId }), true);
	assert.ok(await broker.select(owner));

	broker.dispose();
	const globalBroker = new FramescaperNativeImageSequenceSelectionBroker({
		selectFiles: async () => [frame],
		mintOpaqueId: () => `${(++opaque).toString(16).padStart(40, '0')}`,
	});
	for (let index = 0; index < FRAMESCAPER_NATIVE_IMAGE_SEQUENCE_MAXIMUM_ACTIVE_SELECTIONS;
		index += 1) {
		assert.ok(await globalBroker.select(Object.freeze({ index })));
	}
	await assert.rejects(
		() => globalBroker.select(Object.freeze({ index: 99 })), /capacity/u,
	);
});
