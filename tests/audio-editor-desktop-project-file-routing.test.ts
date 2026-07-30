/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createScapeArchiveByteSource } from '../src/common/editor/scape-archive-byte-source.ts';
import {
	DESKTOP_READ_PROFILE_MATERIALIZED,
	DESKTOP_READ_PROFILE_SCAPE_RANGE,
} from '../src/common/editor/desktop-read-profile.ts';
import { createAudioEditorFileService } from '../src/common/editor/file-service.js';
import { withDesktopProjectReadDescriptor } from '../src/common/editor/ui/workspace/desktop-project-file-routing.ts';

const SCAPE_MIME_TYPE = 'application/vnd.soundscaper.scape+zip';

test('desktop Scape descriptors use the range scope without whole-file materialization', async () => {
	const source = createScapeArchiveByteSource({
		size: 1,
		read: () => Uint8Array.of(1),
	});
	const calls: string[] = [];
	const descriptor = Object.freeze({
		readProfile: DESKTOP_READ_PROFILE_SCAPE_RANGE,
		name: 'project.SCAPE',
		mimeType: SCAPE_MIME_TYPE,
	});
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
		const descriptor = Object.freeze({
			readProfile: DESKTOP_READ_PROFILE_MATERIALIZED,
			name,
		});
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

test('desktop project profile mismatches fail before fetch and release their capability', async () => {
	const released: string[] = [];
	let fetchCalls = 0;
	let consumerCalls = 0;
	const service = createAudioEditorFileService({
		bridge: { async releaseRead(id: string) { released.push(id); } },
		fetch: async () => {
			fetchCalls += 1;
			throw new Error('must not fetch');
		},
	});
	const mismatches = [
		{
			id: 'range-mismatch',
			readProfile: DESKTOP_READ_PROFILE_SCAPE_RANGE,
			url: 'soundscaper-app://bundle/_desktop/read/scape-range-v1/range-mismatch/project.scape',
			name: 'project.scape',
			size: 1,
			mimeType: 'application/zip',
		},
		{
			id: 'materialized-mismatch',
			readProfile: DESKTOP_READ_PROFILE_MATERIALIZED,
			url: 'soundscaper-app://bundle/_desktop/read/materialized-v1/materialized-mismatch/project.scape',
			name: 'project.scape',
			size: 1,
			mimeType: SCAPE_MIME_TYPE,
		},
		{
			id: 'missing-profile',
			url: 'soundscaper-app://bundle/_desktop/read/materialized-v1/missing-profile/project.aup4',
			name: 'project.aup4',
			size: 1,
			mimeType: 'application/vnd.audacity.aup4',
		},
	];

	for (const descriptor of mismatches) {
		await assert.rejects(withDesktopProjectReadDescriptor(service, descriptor, {
			openMaterialized: async () => { consumerCalls += 1; },
			openScape: async () => { consumerCalls += 1; },
		}), /profile|canonical.*Scape|Scape.*descriptor|valid desktop read descriptor/iu);
	}
	assert.equal(fetchCalls, 0);
	assert.equal(consumerCalls, 0);
	assert.deepEqual(released, ['range-mismatch', 'materialized-mismatch', 'missing-profile']);
});

function namedBlob(name: string): Blob & Readonly<{ name: string }> {
	const blob = new Blob([name]);
	Object.defineProperty(blob, 'name', { value: name });
	return blob as Blob & Readonly<{ name: string }>;
}
