/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { digestScapeBytes } from '../src/common/editor/scape-byte-stream.ts';
import { ScapeExpandedByteBudget } from '../src/common/editor/scape-expanded-byte-budget.ts';
import type { ScapeArchiveEntry, ScapeAssetDescriptor } from '../src/common/editor/scape-archive-envelope.ts';
import { readPhotoDevelopPresetPackEntryV1 } from '../src/lightscaper/archive/develop-preset-pack-entry-v1.ts';

const row = { schemaVersion: 1, kind: 'photo-develop-presets', catalogId: 'catalog', revision: 91, presets: [] };
const bytes = new TextEncoder().encode(JSON.stringify(row));
function fixture(before = async () => {}, after = async () => {}) {
	let joined = false;
	const entry: ScapeArchiveEntry = { filename: 'assets/develop-presets-v1.bin', directory: false, encrypted: false,
		compressionMethod: 0, compressedSize: bytes.byteLength, uncompressedSize: bytes.byteLength,
		async getData(writable) {
			await before(); const writer = writable.getWriter();
			try { await writer.write(bytes); await writer.close(); }
			finally { writer.releaseLock(); await after(); joined = true; }
		},
	};
	const descriptor: ScapeAssetDescriptor = { sourceId: 'develop-presets', entry: entry.filename, kind: 'photo-develop-preset-pack',
		encoding: 'lightscaper-develop-presets-json-v1', size: bytes.byteLength, sha256: digestScapeBytes(bytes) };
	return { entry, descriptor, get joined() { return joined; } };
}

test('The authenticated entry stages one detached row and joins extraction before reporting success', async () => {
	const f = fixture(); let deliveries = 0;
	assert.equal(await readPhotoDevelopPresetPackEntryV1(f.entry, f.descriptor, new ScapeExpandedByteBudget(10_485_760), 'catalog', async actual => {
		deliveries++; assert.deepEqual(actual, row); assert.notEqual(actual, row);
	}), 1);
	assert.equal(deliveries, 1); assert.equal(f.joined, true);
});

test('A wrong digest refuses after provisional delivery, and descriptor bounds refuse before extraction', async () => {
	const f = fixture(); let deliveries = 0;
	await assert.rejects(readPhotoDevelopPresetPackEntryV1(f.entry, { ...f.descriptor, sha256: '0'.repeat(64) },
		new ScapeExpandedByteBudget(10_485_760), 'catalog', async () => { deliveries++; }), /digest|sha/iu);
	assert.equal(deliveries, 1); assert.equal(f.joined, true);
	for (const size of [0, 10_485_761]) {
		const bounded = fixture(async () => { assert.fail('Invalid descriptor acquired extraction'); });
		assert.throws(() => readPhotoDevelopPresetPackEntryV1(bounded.entry, { ...bounded.descriptor, size },
			new ScapeExpandedByteBudget(10_485_760), 'catalog', async () => {}));
	}
});

test('Opaque native abort during held authenticated extraction joins the actual writer without inspecting the reason', async () => {
	let enter!: () => void, release!: () => void;
	const entered = new Promise<void>(resolve => { enter = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
	const f = fixture(async () => { enter(); await held; });
	let inspected = 0, settled = false, failure: unknown;
	const reason = new Proxy({}, { get() { inspected++; throw new Error('Opaque get'); },
		getPrototypeOf() { inspected++; throw new Error('Opaque prototype'); } });
	const stop = new AbortController();
	const work = readPhotoDevelopPresetPackEntryV1(f.entry, f.descriptor, new ScapeExpandedByteBudget(10_485_760), 'catalog',
		async () => { assert.fail('Cancelled row published'); }, stop.signal);
	const done = work.then(() => { settled = true; }, (error: unknown) => { failure = error; settled = true; });
	await entered; stop.abort(reason); await Promise.resolve(); assert.equal(settled, false);
	release(); await done;
	assert.equal(failure, reason); assert.equal(f.joined, true); assert.equal(inspected, 0);
});
