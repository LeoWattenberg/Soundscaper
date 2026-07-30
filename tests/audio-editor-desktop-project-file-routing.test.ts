/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createScapeArchiveByteSource } from '../src/common/editor/scape-archive-byte-source.ts';
import { withDesktopProjectReadDescriptor } from '../src/common/editor/ui/workspace/desktop-project-file-routing.ts';

test('desktop Scape descriptors use the range scope without whole-file materialization', async () => {
	const source = createScapeArchiveByteSource({
		size: 1,
		read: () => Uint8Array.of(1),
	});
	const calls: string[] = [];
	const descriptor = Object.freeze({ name: 'project.SCAPE' });
	const service = {
		async withScapeReadDescriptor(
			received: unknown,
			_request: Readonly<Record<string, never>>,
			consume: (input: typeof source) => Promise<string>,
		) {
			calls.push('range');
			assert.equal(received, descriptor);
			return consume(source);
		},
		async withReadDescriptors() {
			calls.push('materialize');
			throw new Error('Scape must not materialize');
		},
	};

	const result = await withDesktopProjectReadDescriptor(
		service,
		descriptor,
		{
			openMaterialized: async () => { throw new Error('Scape must not materialize'); },
			openScape: async (input) => {
				calls.push('consume');
				assert.equal(input, source);
				return 'opened';
			},
		},
	);
	assert.equal(result, 'opened');
	assert.deepEqual(calls, ['range', 'consume']);
});

test('desktop Audacity descriptors retain named whole-file materialization', async () => {
	for (const name of ['legacy.aup3', 'exchange.AUP4']) {
		const calls: string[] = [];
		const descriptor = Object.freeze({ name });
		const file = namedBlob(name);
		const service = {
			async withScapeReadDescriptor() {
				calls.push('range');
				throw new Error('Audacity must not use Scape ranges');
			},
			async withReadDescriptors(
				received: readonly unknown[],
				_request: Readonly<Record<string, never>>,
				consume: (files: readonly Blob[]) => Promise<string>,
			) {
				calls.push('materialize');
				assert.deepEqual(received, [descriptor]);
				return consume([file]);
			},
		};

		const result = await withDesktopProjectReadDescriptor(
			service,
			descriptor,
			{
				openMaterialized: async (input) => {
					calls.push('consume');
					assert.equal(input, file);
					return name;
				},
				openScape: async () => { throw new Error('Audacity must not use Scape ranges'); },
			},
		);
		assert.equal(result, name);
		assert.deepEqual(calls, ['materialize', 'consume']);
	}
});

function namedBlob(name: string): Blob & Readonly<{ name: string }> {
	const blob = new Blob([name]);
	Object.defineProperty(blob, 'name', { value: name });
	return blob as Blob & Readonly<{ name: string }>;
}
