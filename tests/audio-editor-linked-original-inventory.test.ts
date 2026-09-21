/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	linkedOriginalManagedKinds,
	readBoundedLinkedOriginalBindingRows,
} from '../src/common/editor/storage/linked-original-inventory.ts';

const BINDING = Object.freeze({
	schemaVersion: 2,
	kind: 'audio',
	projectId: 'inventory-project',
	sourceId: 'inventory-source',
	storageKey: 'inventory-storage',
	locatorId: 'locator_inventory_0001',
	locatorRevision: 'revision_inventory_0001',
	mimeType: 'audio/wav',
	byteLength: 64,
	sha256: '0'.repeat(64),
	sourceShape: Object.freeze({
		frameCount: 16,
		channelCount: 1,
		sampleRate: 48_000,
		originalSampleRate: 48_000,
		sampleFormat: 'float32',
		chunkFrames: 16,
	}),
	bindingToken: 'binding_inventory_0001',
	boundAt: '2026-09-21T00:00:00.000Z',
});

test('managed linked-original kinds are one shared closed, deduplicated authority', () => {
	assert.deepEqual([...linkedOriginalManagedKinds(undefined)], ['audio', 'video']);
	assert.deepEqual([...linkedOriginalManagedKinds(['video'])], ['video']);
	assert.throws(() => linkedOriginalManagedKinds([]), /non-empty array/u);
	assert.throws(() => linkedOriginalManagedKinds(['audio', 'audio']), /duplicate/u);
	assert.throws(() => linkedOriginalManagedKinds(['audio', 'image']), /audio or video/u);
});

test('bounded linked-original enumeration validates, freezes, and keys every row', async () => {
	const rows = await readBoundedLinkedOriginalBindingRows(
		cursorStore([BINDING]),
		1,
		{
			enumerationError: 'test enumeration failed',
			limitError: 'test inventory limit exceeded',
		},
	);
	assert.deepEqual(rows, [{
		key: '["inventory-project","inventory-source"]',
		binding: BINDING,
	}]);
	assert.ok(Object.isFrozen(rows));
	assert.ok(Object.isFrozen(rows[0]));

	await assert.rejects(
		readBoundedLinkedOriginalBindingRows(cursorStore([BINDING, BINDING]), 1, {
			enumerationError: 'test enumeration failed',
			limitError: 'test inventory limit exceeded',
		}),
		/test inventory limit exceeded/u,
	);
});

test('bounded linked-original enumeration preserves caller-specific transport wording', async () => {
	await assert.rejects(
		readBoundedLinkedOriginalBindingRows(failingStore(), 1, {
			enumerationError: 'startup binding enumeration failed',
			limitError: 'startup inventory limit exceeded',
		}),
		/startup binding enumeration failed/u,
	);
});

function cursorStore(values: readonly unknown[]): IDBObjectStore {
	return {
		openCursor: () => {
			const request = {} as IDBRequest<IDBCursorWithValue | null>;
			let index = 0;
			const advance = (): void => {
				queueMicrotask(() => {
					Object.defineProperty(request, 'result', {
						configurable: true,
						value: index < values.length ? {
							primaryKey: '["inventory-project","inventory-source"]',
							value: {
								key: '["inventory-project","inventory-source"]',
								projectId: 'inventory-project',
								binding: values[index],
							},
							continue: () => { index += 1; advance(); },
						} : null,
					});
					request.onsuccess?.(new Event('success'));
				});
			};
			advance();
			return request;
		},
	} as IDBObjectStore;
}

function failingStore(): IDBObjectStore {
	return {
		openCursor: () => {
			const request = {} as IDBRequest<IDBCursorWithValue | null>;
			queueMicrotask(() => request.onerror?.(new Event('error')));
			return request;
		},
	} as IDBObjectStore;
}
