/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { BlobReader, Uint8ArrayWriter, ZipReader } from '@zip.js/zip.js/index-native.js';
import { exportPhotoCatalogArchiveV4 } from '../src/lightscaper/archive/catalog-archive-export-v4.ts';
import { assertPhotoCatalogPackManifestV4 } from '../src/lightscaper/archive/catalog-archive-contract-v4.ts';
import { digestScapeBytes } from '../src/common/editor/scape-byte-stream.ts';
import { createImageDevelopPresetV1 } from '../src/common/editor/imaging/image-develop-preset-v1.ts';
import { copyImageDevelopSettingsV1 } from '../src/common/editor/imaging/image-develop-settings-v1.ts';
import { defaultImageDevelopStateV1 } from '../src/common/editor/imaging/image-develop-state-v1.ts';
import { normalizePhotoDevelopPresetRowV1 } from '../src/lightscaper/storage/photo-develop-presets-v1.ts';
import { savedArchiveRootV3, savedArchiveDefinitionV3, savedArchiveStateV3 } from './helpers/lightscaper-saved-collection-archive-fixture.ts';
import { stackArchiveRecord } from './helpers/lightscaper-stack-archive-fixture.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { deferred } from './helpers/async-test-control.ts';

function presetRow(partial = false) {
	return normalizePhotoDevelopPresetRowV1({ schemaVersion: 1, kind: 'photo-develop-presets', catalogId: 'catalog-1', revision: 37,
		presets: [createImageDevelopPresetV1({ schemaVersion: 1, id: 'preset', name: 'Evening 界 📷',
			settings: copyImageDevelopSettingsV1({ schemaVersion: 1, develop: defaultImageDevelopStateV1(),
				selection: { effectTypes: partial ? ['tone-ladder-v1'] : 'all', geometry: !partial, localAdjustments: !partial } }) })] }, 'catalog-1');
}
async function entries(blob: Blob) {
	const reader = new ZipReader(new BlobReader(blob), { useWebWorkers: false }), values = new Map<string, Uint8Array>();
	try { for (const entry of await reader.getEntries()) if (!entry.directory) values.set(entry.filename, await entry.getData(new Uint8ArrayWriter())); }
	finally { await reader.close(); }
	return values;
}
function destination(onClose?: () => void) {
	const events: string[] = [];
	const writable = new WritableStream<Uint8Array>({ write() { events.push('write'); }, close() { events.push('close'); onClose?.(); }, abort() { events.push('abort'); } });
	return { writable, events };
}

for (const partial of [false, true]) test(`archive4 emits authenticated ${partial ? 'partial' : 'full'} preset content alongside unchanged photo, stack and saved packs`, async () => {
	const row = presetRow(partial), saved = savedArchiveDefinitionV3();
	const result = await exportPhotoCatalogArchiveV4(savedArchiveRootV3(), [photoArchiveFixture(1), photoArchiveFixture(2)],
		[stackArchiveRecord()], savedArchiveStateV3(1), [saved], row);
	assert.ok(result.blob); assert.equal(result.manifest.project.schemaVersion, 4); assertPhotoCatalogPackManifestV4(result.document, result.manifest);
	assert.deepEqual(result.document.developPresetPack, { id: 'develop-presets', entry: 'assets/develop-presets-v1.bin', revision: 37, presetCount: 1 });
	assert.deepEqual(result.manifest.assets.map(asset => asset.kind), ['photo-catalog-pack', 'photo-stack-pack', 'photo-smart-collection-pack', 'photo-develop-preset-pack']);
	const bodies = await entries(result.blob), bytes = bodies.get('assets/develop-presets-v1.bin'); assert.ok(bytes);
	assert.deepEqual(JSON.parse(new TextDecoder().decode(bytes)), row);
	assert.equal(result.manifest.assets.at(-1)?.sha256, digestScapeBytes(bytes)); assert.equal(result.manifest.assets.at(-1)?.size, bytes.byteLength);
	assert.deepEqual(JSON.parse(new TextDecoder().decode(bodies.get('project.json'))), result.document);
	assert.equal('presets' in result.document, false); assert.deepEqual(result.document.catalog, savedArchiveRootV3());
});

test('archive4 preserves physical absence versus a positive retained empty row', async () => {
	for (const row of [null, { ...presetRow(), revision: 91, presets: [] }]) {
		const result = await exportPhotoCatalogArchiveV4(savedArchiveRootV3(0), [], [], null, [], row); assert.ok(result.blob);
		const bodies = await entries(result.blob);
		assert.equal(bodies.has('assets/develop-presets-v1.bin'), row !== null);
		assert.deepEqual(result.document.developPresetPack, row === null ? null
			: { id: 'develop-presets', entry: 'assets/develop-presets-v1.bin', revision: 91, presetCount: 0 });
		assertPhotoCatalogPackManifestV4(result.document, result.manifest);
	}
});

test('foreign, malformed and accessor preset rows refuse before photo enumeration or destination acquisition', async () => {
	let reads = 0, getters = 0;
	const photos = { async *[Symbol.asyncIterator]() { reads++; yield photoArchiveFixture(); } };
	for (const row of [{ ...presetRow(), catalogId: 'foreign' }, { ...presetRow(), revision: 0 },
		Object.defineProperty({ ...presetRow() }, 'presets', { get() { getters++; return []; } })]) {
		const target = destination();
		await assert.rejects(exportPhotoCatalogArchiveV4(savedArchiveRootV3(1), photos, [], null, [], row, { writable: target.writable }));
		assert.deepEqual(target.events, []); assert.equal(target.writable.locked, false);
	}
	assert.equal(reads, 0); assert.equal(getters, 0);
});

test('preset body admission detaches before a held original permits caller mutation', async () => {
	const entered = deferred<void>(), release = deferred<void>(), row = structuredClone(presetRow()), expected = structuredClone(row);
	async function* photos() { entered.resolve(); await release.promise; yield photoArchiveFixture(); }
	const work = exportPhotoCatalogArchiveV4(savedArchiveRootV3(1), photos(), [], null, [], row);
	try {
		await entered.promise; Reflect.set(row, 'revision', 99); Reflect.set(row.presets[0]!.identity, 'name', 'Later caller change'); release.resolve();
		const result = await work; assert.ok(result.blob);
		const bodies = await entries(result.blob);
		assert.deepEqual(JSON.parse(new TextDecoder().decode(bodies.get('assets/develop-presets-v1.bin'))), expected);
	} finally { release.resolve(); await work; }
});

test('final source verification runs before close and failed verification aborts the acquired destination', async () => {
	const target = destination(), failure = new Error('Preset row drift'), events = target.events;
	await assert.rejects(exportPhotoCatalogArchiveV4(savedArchiveRootV3(0), [], [], null, [], presetRow(), {
		writable: target.writable, async verifySource() { events.push('verify'); throw failure; },
	}));
	assert.ok(events.indexOf('verify') > events.indexOf('write')); assert.equal(events.includes('close'), false);
	assert.equal(events.at(-1), 'abort'); assert.equal(target.writable.locked, false);
});

test('a native close ACK remains complete when cancellation arrives synchronously with close', async () => {
	const stop = new AbortController(), reason = Object.freeze({ closed: true }), target = destination(() => { stop.abort(reason); });
	const result = await exportPhotoCatalogArchiveV4(savedArchiveRootV3(0), [], [], null, [], presetRow(), { writable: target.writable, signal: stop.signal });
	assert.equal(result.document.developPresetPack?.revision, 37); assert.equal(result.document.schemaVersion, 4); assert.ok(result.byteLength > 0);
	assert.equal(target.events.at(-1), 'close'); assert.equal(target.events.includes('abort'), false); assert.equal(target.writable.locked, false);
});

for (const phase of ['before-output', 'before-close'] as const) test(`opaque ${phase} native cancellation retains its reason without reflection`, async () => {
	let inspections = 0;
	const reason = new Proxy({}, { get() { inspections++; throw new Error('Opaque read'); }, getPrototypeOf() { inspections++; throw new Error('Opaque prototype'); } });
	const stop = new AbortController(), target = destination();
	if (phase === 'before-output') stop.abort(reason);
	let failure: unknown;
	await exportPhotoCatalogArchiveV4(savedArchiveRootV3(0), [], [], null, [], null, {
		writable: target.writable, signal: stop.signal, async verifySource() { stop.abort(reason); },
	}).catch((error: unknown) => { failure = error; });
	assert.equal(failure, reason); assert.equal(inspections, 0); assert.equal(target.events.includes('close'), false);
	assert.equal(target.events.includes('abort'), phase === 'before-close'); assert.equal(target.writable.locked, false);
});

test('a genuine AbortError without an observed native cancellation keeps its cleanup classification', async () => {
	const primary = new DOMException('Caller source aborted', 'AbortError'), cleanup = new Error('Abort cleanup failed');
	const writable = new WritableStream<Uint8Array>({ write() {}, abort() { throw cleanup; } });
	let failure: unknown;
	await exportPhotoCatalogArchiveV4(savedArchiveRootV3(0), [], [], null, [], null,
		{ writable, async verifySource() { throw primary; } }).catch((error: unknown) => { failure = error; });
	assert.ok(failure instanceof AggregateError); assert.equal(failure.name, 'AbortError');
	assert.ok((failure.errors as unknown[]).includes(primary)); assert.ok((failure.errors as unknown[]).includes(cleanup));
	assert.equal(writable.locked, false);
});

for (const companion of ['stacks', 'saved'] as const) test(`opaque ${companion} cancellation preserves a distinct iterator retirement failure`, async () => {
	const stop = new AbortController(), target = destination(); let inspections = 0, retirements = 0;
	const reason = new Proxy({}, { get() { inspections++; throw new Error('Opaque read'); }, getPrototypeOf() { inspections++; throw new Error('Opaque prototype'); } });
	const cleanup = new Error('Iterator retirement failed');
	const source = { [Symbol.asyncIterator]() { return {
		async next() { stop.abort(reason); return { done: true as const, value: undefined }; },
		async return(): Promise<never> { retirements++; throw cleanup; },
	}; } };
	let failure: unknown;
	await exportPhotoCatalogArchiveV4(savedArchiveRootV3(0), [], companion === 'stacks' ? source : [],
		companion === 'saved' ? savedArchiveStateV3(0) : null, companion === 'saved' ? source : [], null,
		{ writable: target.writable, signal: stop.signal }).catch((error: unknown) => { failure = error; });
	assert.equal(inspections, 0); assert.equal(retirements, 1); assert.ok(failure instanceof AggregateError);
	assert.equal(failure.name, 'AbortError');
	const flattened = (value: unknown): unknown[] => value === reason || value === cleanup ? [value]
		: value instanceof AggregateError ? (value.errors as unknown[]).flatMap(flattened) : [value];
	assert.ok(flattened(failure).includes(reason)); assert.ok(flattened(failure).includes(cleanup));
	assert.equal(target.events.includes('close'), false); assert.equal(target.events.at(-1), 'abort'); assert.equal(target.writable.locked, false);
});
