/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { importPhotoCatalogArchiveV4 } from '../src/lightscaper/archive/catalog-archive-import-v4.ts';
import { exportPhotoCatalogArchiveV1 } from '../src/lightscaper/archive/catalog-archive-export.ts';
import { exportPhotoCatalogArchiveV2 } from '../src/lightscaper/archive/catalog-archive-export-v2.ts';
import { savedArchiveFixtureV3, savedArchiveRootV3, savedArchiveDefinitionV3, savedArchiveReaderV3 } from './helpers/lightscaper-saved-collection-archive-fixture.ts';
import { rewriteStackArchive, editStackArchiveDocument, stackArchiveFailure } from './helpers/lightscaper-stack-archive-fixture.ts';
import { developPresetArchiveRow as row, developPresetArchiveFixture as archive, developPresetArchiveDestination as destination } from './helpers/lightscaper-develop-preset-archive-fixture.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

test('V4 delivers exact full preset bodies alongside unchanged photos/stacks/saved definitions before one publish', async () => {
	const target = destination(), expected = row(Number.MAX_SAFE_INTEGER, 16);
	assert.deepEqual(await importPhotoCatalogArchiveV4(await archive(expected), async (root, state, pack) => {
		assert.deepEqual(root, savedArchiveRootV3()); assert.equal(state?.revision, 31);
		assert.deepEqual(pack, { id: 'develop-presets', entry: 'assets/develop-presets-v1.bin', revision: Number.MAX_SAFE_INTEGER, presetCount: 16 });
		assert.ok(Object.isFrozen(pack)); return target.stage;
	}), savedArchiveRootV3());
	assert.deepEqual(target.row, expected); assert.deepEqual([...target.saved.values()], [savedArchiveDefinitionV3()]);
	assert.deepEqual(target.photos.get('photo-1')?.bytes, new Uint8Array([1, 2, 3]));
	assert.equal(target.photos.get('photo-1')?.photo.revision, 13); assert.equal(target.stacks.get('stack-1')?.revision, 3);
	assert.deepEqual(target.events, ['photo:photo-1', 'photo:photo-2', 'stack:stack-1', 'saved:saved-1', 'presets', 'publish']);
});

test('V1–V3 absence and V4 absence versus retained positive empty row remain exact', async () => {
	const legacy = [await exportPhotoCatalogArchiveV1(savedArchiveRootV3(0), []),
		await exportPhotoCatalogArchiveV2(savedArchiveRootV3(0), [], [])];
	for (const bytes of [...legacy.map(result => result.blob!), await savedArchiveFixtureV3(), await archive(null)]) {
		const target = destination(); await importPhotoCatalogArchiveV4(bytes, async (_root, _state, pack) => {
			assert.equal(pack, null); return target.stage;
		}); assert.equal(target.row, null); assert.equal(target.events.includes('presets'), false); assert.equal(target.events.at(-1), 'publish');
	}
	const target = destination(); await importPhotoCatalogArchiveV4(await archive(row(99, 0)), async (_root, _state, pack) => {
		assert.equal(pack?.revision, 99); assert.equal(pack?.presetCount, 0); return target.stage;
	}); assert.deepEqual(target.row, row(99, 0));
});

test('Authenticated header/count/foreign/future/digest corruption refuses and never publishes', async () => {
	for (const [value, header] of [[row(), { revision: 92, presetCount: 2 }], [row(), { revision: 91, presetCount: 1 }],
		[{ ...row(), catalogId: 'foreign' }, undefined], [{ ...row(), schemaVersion: 2 }, undefined]] as const) {
		const target = destination(); await assert.rejects(importPhotoCatalogArchiveV4(await archive(value, header), async () => target.stage));
		assert.equal(target.events.includes('presets'), false); assert.equal(target.events.at(-1), 'rollback'); assert.equal(target.photos.size, 0);
	}
	const source = await rewriteStackArchive(await archive(), entries => {
		const bytes = entries.get('assets/develop-presets-v1.bin')!; bytes[bytes.length - 1]! ^= 1;
	});
	const target = destination(); await assert.rejects(importPhotoCatalogArchiveV4(source, async () => target.stage));
	assert.equal(target.events.includes('publish'), false); assert.equal(target.row, null);
});

	test('Legacy profiles cannot smuggle preset authority and future/invalid manifests refuse before stage creation', async () => {
	const old = await savedArchiveFixtureV3(), legacy1 = await exportPhotoCatalogArchiveV1(savedArchiveRootV3(0), []),
		legacy2 = await exportPhotoCatalogArchiveV2(savedArchiveRootV3(0), [], []);
	for (const [version, original] of [[1, legacy1.blob!], [2, legacy2.blob!], [3, old], [5, old]] as const) {
		const source = await rewriteStackArchive(original, entries => editStackArchiveDocument(entries, document => {
			document.schemaVersion = version; document.developPresetPack = null;
		}));
		await assert.rejects(importPhotoCatalogArchiveV4(source, async () => { assert.fail('Invalid profile acquired a stage'); }));
	}
});

test('Held preset consumption and actual ZIP close both join before publication, cancellation rolls back', async () => {
	for (const cancel of [false, true]) {
		const target = destination(), entered = deferred<void>(), release = deferred<void>(), closed = deferred<void>(), leave = deferred<void>(), stop = new AbortController();
		const source = await archive(); let failure: unknown;
		const work = importPhotoCatalogArchiveV4(source, async () => ({ ...target.stage,
			async writeDevelopPresets(value) { entered.resolve(); await release.promise; await target.stage.writeDevelopPresets(value); },
		}), { signal: stop.signal, readerFactories: { blob: savedArchiveReaderV3(async () => { closed.resolve(); await leave.promise; }) } });
		const done = work.catch((error: unknown) => { failure = error; });
		await entered.promise; assert.equal(await remainsPending(work), true); assert.equal(target.events.includes('publish'), false);
		if (cancel) stop.abort(new DOMException('Cancelled held row', 'AbortError'));
		release.resolve(); await closed.promise; assert.equal(await remainsPending(work), true); assert.equal(target.events.includes('publish'), false);
		leave.resolve(); await done;
		if (cancel) { assert.ok(failure); assert.equal(target.events.at(-1), 'rollback'); }
		else { assert.equal(failure, undefined); assert.equal(target.events.at(-1), 'publish'); }
	}
});

test('Native publication ACK wins late cancellation and pre-ACK rollback keeps distinct failures', async () => {
	const target = destination(), stop = new AbortController();
	await importPhotoCatalogArchiveV4(await archive(), async () => ({ ...target.stage,
		async publish() { await target.stage.publish(); stop.abort(new DOMException('Late', 'AbortError')); },
	}), { signal: stop.signal }); assert.equal(target.events.at(-1), 'publish');
	const broken = destination();
	await assert.rejects(importPhotoCatalogArchiveV4(await archive(), async () => ({ ...broken.stage,
		async writeDevelopPresets() { throw new Error('preset write failed'); }, async rollback() { throw new Error('rollback failed'); },
	})), error => stackArchiveFailure(error, /preset write failed/u) && stackArchiveFailure(error, /rollback failed/u));
});

test('Opaque cancellation after stage acquisition retains a distinct rollback failure without inspecting the reason', async () => {
	const stop = new AbortController(), cleanup = new Error('Rollback failed'); let inspected = 0, failure: unknown;
	const reason = new Proxy({}, { get() { inspected++; throw new Error('Reason value inspected'); },
		getPrototypeOf() { inspected++; throw new Error('Reason prototype inspected'); } });
	try {
		await importPhotoCatalogArchiveV4(await archive(), async () => {
			stop.abort(reason); return { ...destination().stage, async rollback() { throw cleanup; } };
		}, { signal: stop.signal });
	} catch (error) { failure = error; }
	assert.equal(inspected, 0); assert.ok(failure instanceof AggregateError);
	assert.deepEqual(failure.errors.length, 2); assert.equal(failure.errors[0], reason); assert.equal(failure.errors[1], cleanup);
	assert.equal(failure.name, 'AbortError');
});

test('Unobserved native AbortError preserves legacy cleanup classification', async () => {
	const primary = new DOMException('Destination refused', 'AbortError'), cleanup = new Error('Rollback failed');
	await assert.rejects(importPhotoCatalogArchiveV4(await archive(), async () => ({ ...destination().stage,
		async writeDevelopPresets() { throw primary; }, async rollback() { throw cleanup; },
	})), error => error instanceof AggregateError && error.name === 'AbortError'
		&& error.errors[0] === primary && error.errors[1] === cleanup);
});
