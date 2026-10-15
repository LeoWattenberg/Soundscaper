/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createPhotoLibrarySessionCurrentV1 } from '../src/lightscaper/photo-library-session-runtime-current-v1.ts';
import { createPhotoLibraryDevelopSettingsSessionForProfileV1 } from '../src/lightscaper/controller/internal/photo-library-develop-settings-session-kernel-v1.ts';
import type { PhotoLibraryDevelopSettingsSessionHostCurrentV1 } from '../src/lightscaper/controller/photo-library-develop-settings-session-current-v1.ts';
import type { PhotoLibraryDevelopSettingsPortCurrentV1, PhotoLibraryDevelopBatchRequestCurrentV1 } from '../src/common/editor/photo-library-develop-settings-port-current-v1.ts';
import { copyImageDevelopSettingsV4 } from '../src/common/editor/imaging/image-develop-settings-v4.ts';
import { normalizeImageDevelopStateV4 } from '../src/common/editor/imaging/image-develop-state-v4.ts';
import { repairSettingsFixture, brushSettingsRecipe, SETTINGS_TIME } from './helpers/lightscaper-repair-settings-current-fixture.ts';
import { repairRecipe } from './helpers/lightscaper-repair-raster-export-current-fixture.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

type Fixture = Awaited<ReturnType<typeof repairSettingsFixture>>;
const FULL = Object.freeze({ effectTypes: 'all' as const, geometry: true, localAdjustments: true, repairs: true, rawDevelopment: true });
const RAW_ONLY = Object.freeze({ effectTypes: [] as readonly string[], geometry: false, localAdjustments: false, repairs: false, rawDevelopment: true });
function recipe(mode: 'canonical' | 'headroom' | 'recovery' = 'recovery', base: unknown = repairRecipe()) {
	assert.ok(base && typeof base === 'object');
	return normalizeImageDevelopStateV4({ ...base, processVersion: 4, rawDevelopment: { schemaVersion: 1, mode } });
}
function child(value: { readonly develop: unknown }): Readonly<PhotoLibraryDevelopSettingsPortCurrentV1> {
	assert.ok(value.develop && typeof value.develop === 'object');
	const data = Object.getOwnPropertyDescriptor(value.develop, 'settingsCurrent'); assert.ok(data && Object.hasOwn(data, 'value'));
	const port: unknown = data.value; assert.ok(port && typeof port === 'object');
	for (const name of ['copy', 'copySelected', 'merge', 'adjust', 'applyBatch']) assert.equal(typeof Object.getOwnPropertyDescriptor(port, name)?.value, 'function');
	return port as Readonly<PhotoLibraryDevelopSettingsPortCurrentV1>;
}
function source(f: Fixture, develop = recipe()) {
	const photo = f.photos[0]!; return { schemaVersion: 3 as const, catalogId: photo.catalogId, photoId: photo.id,
		versionId: photo.activeVersionId, revision: photo.revision, develop };
}
function batch(f: Fixture, action: PhotoLibraryDevelopBatchRequestCurrentV1['action'], indexes = [1]): PhotoLibraryDevelopBatchRequestCurrentV1 {
	return { schemaVersion: 3, catalogId: f.photos[0]!.catalogId,
		targets: indexes.map(index => ({ photoId: f.photos[index]!.id, versionId: f.photos[index]!.activeVersionId, expectedRevision: f.photos[index]!.revision })),
		action, label: 'RAW source settings', createdAt: SETTINGS_TIME };
}
function observe<Value>(work: Promise<Value>) { return work.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error })); }

// These cases prove real selected catalog/Original/settings publication. The
// fixture's PNG Original is deliberately unchanged; RAW pixel evaluation and
// camera suitability belong to the independent native decoder/render tests.
test('Current native settings translate wire3 into Packet4 and persist exact source-processing metadata through native target save/reopen', async () => {
	const f = await repairSettingsFixture(); let reopened: Awaited<ReturnType<typeof createPhotoLibrarySessionCurrentV1>> | undefined;
	try {
		const port = child(f.session), before = await f.inspect(), develop = recipe();
		const packet = port.copy({ schemaVersion: 3, develop, selection: FULL });
		assert.equal(packet.schemaVersion, 4); assert.deepEqual(packet.develop, develop); assert.deepEqual(packet.selection, FULL);
		assert.deepEqual(port.merge({ schemaVersion: 3, target: f.photos[1]!.versions[0]!.develop, settings: packet }), develop);
		const receipt = await port.applyBatch(batch(f, { kind: 'paste', settings: packet }));
		assert.equal(receipt.schemaVersion, 3); assert.equal(receipt.outcomes[0]!.status, 'applied');
		const after = await f.inspect(); assert.deepEqual(normalizeImageDevelopStateV4(after[1]!.photo.versions[0]!.develop), develop);
		assert.deepEqual(after[0], before[0]); assert.deepEqual(after.map(row => row.bytes), before.map(row => row.bytes));
		const current = after[1]!.photo, unchanged = await port.applyBatch({ ...batch(f, { kind: 'relative', effectType: 'tone-ladder-v1', changes: { exposure: 0 } }),
			targets: [{ photoId: current.id, versionId: current.activeVersionId, expectedRevision: current.revision }] });
		assert.equal(unchanged.outcomes[0]!.status, 'unchanged'); assert.deepEqual(await f.inspect(), after);
		await f.session.close(); reopened = await createPhotoLibrarySessionCurrentV1(f.options);
		const snapshot = await reopened.develop.read({ schemaVersion: 3, photoId: after[1]!.photo.id });
		assert.equal(snapshot.schemaVersion, 3); assert.deepEqual(normalizeImageDevelopStateV4(snapshot.develop), develop);
		assert.deepEqual(await f.inspect(), after);
	} finally { await reopened?.close(); await f.close(); }
});

test('RAW source selection is independent of repairs and omitted RAW selection plus relative actions preserve target source policy', async () => {
	const f = await repairSettingsFixture();
	try {
		const port = child(f.session), target = recipe('headroom'), donor = recipe();
		const selected = port.copy({ schemaVersion: 3, develop: donor, selection: RAW_ONLY });
		const merged = normalizeImageDevelopStateV4(port.merge({ schemaVersion: 3, target, settings: selected }));
		assert.equal(merged.rawDevelopment.mode, 'recovery'); assert.deepEqual(merged.repairs, target.repairs); assert.deepEqual(merged.effects, target.effects);
		const unselected = port.copy({ schemaVersion: 3, develop: donor, selection: { ...FULL, rawDevelopment: false } });
		assert.equal(normalizeImageDevelopStateV4(port.merge({ schemaVersion: 3, target, settings: unselected })).rawDevelopment.mode, 'headroom');
		const adjusted = normalizeImageDevelopStateV4(port.adjust({ schemaVersion: 3, target, effectType: 'tone-ladder-v1', changes: { exposure: 1 } }));
		assert.deepEqual(adjusted.rawDevelopment, target.rawDevelopment); assert.deepEqual(adjusted.repairs, target.repairs);
		assert.throws(() => Reflect.apply(port.copy, port, [{ schemaVersion: 4, develop: donor, selection: FULL }]), RangeError);
		assert.equal(f.saved.length, 0);
	} finally { await f.close(); }
});

test('Selected dirty process4 copy retains same-child Packet4 brush proof and actual native paste performs no brush installation', async () => {
	const f = await repairSettingsFixture(); let foreign: Awaited<ReturnType<typeof createPhotoLibrarySessionCurrentV1>> | undefined;
	try {
		const port = child(f.session), installed = await f.installBrush(), draft = recipe('recovery', brushSettingsRecipe(installed.reference));
		const before = await f.inspect(), packet = await port.copySelected({ ...source(f, draft), selection: FULL });
		assert.equal(packet.schemaVersion, 4); assert.deepEqual(packet.develop, draft); assert.ok(f.borrowed.length > 0);
		const cloned: unknown = structuredClone(packet);
		assert.throws(() => Reflect.apply(port.merge, port, [{ schemaVersion: 3, target: f.photos[1]!.versions[0]!.develop, settings: cloned }]));
		await assert.rejects(Reflect.apply(port.applyBatch, port, [{ ...batch(f, { kind: 'paste', settings: packet }), action: { kind: 'paste', settings: cloned } }]) as Promise<unknown>);
		foreign = await createPhotoLibrarySessionCurrentV1(f.options);
		await assert.rejects(child(foreign).applyBatch(batch(f, { kind: 'paste', settings: packet })));
		let installs = 0;
		f.native.observeTransactions((_tx, stores, mode) => { if (mode === 'readwrite' && [...(typeof stores === 'string' ? [stores] : stores)].includes('analysis')) installs++; });
		const receipt = await port.applyBatch(batch(f, { kind: 'paste', settings: packet })); assert.equal(receipt.outcomes[0]!.status, 'applied');
		const after = await f.inspect(); assert.deepEqual(normalizeImageDevelopStateV4(after[1]!.photo.versions[0]!.develop), draft);
		assert.deepEqual(after[0], before[0]); assert.deepEqual(after.map(row => row.bytes), before.map(row => row.bytes));
		assert.equal(installs, 0); assert.ok(f.borrowed.every(bytes => bytes.every(byte => byte === 0)));
	} finally { await foreign?.close(); await f.close(); }
});

test('Selected process4 Copy joins held genuine brush reads during exact opaque cancellation', async () => {
	const f = await repairSettingsFixture(), entered = deferred<void>(), release = deferred<void>(), stop = new AbortController(), reason = Proxy.revocable({}, {}); reason.revoke();
	let work: Promise<unknown> | undefined;
	try {
		const port = child(f.session), installed = await f.installBrush(), draft = recipe('recovery', brushSettingsRecipe(installed.reference));
		f.hooks.borrowedBrush = async () => { entered.resolve(); await release.promise; };
		work = port.copySelected({ ...source(f, draft), selection: FULL }, { signal: stop.signal }); const watched = observe(work);
		await Promise.race([entered.promise, watched.then(() => { throw new Error('Actual brush read never entered.'); })]);
		stop.abort(reason.proxy); assert.equal(await remainsPending(work), true); release.resolve();
		const outcome = await watched; assert.ok(!outcome.ok); assert.ok(Object.is(outcome.error, reason.proxy));
		assert.ok(f.borrowed.every(bytes => bytes.every(byte => byte === 0))); assert.equal(f.saved.length, 0);
	} finally { release.resolve(); await Promise.allSettled([work]); await f.close(); }
});

test('Current process4 batch detaches requests before native ACK, preserves applied slot through opaque cancellation and leaves later targets untouched', async () => {
	const f = await repairSettingsFixture(), entered = deferred<void>(), release = deferred<void>(), stop = new AbortController(), reason = Proxy.revocable({}, {}); reason.revoke();
	let work: ReturnType<PhotoLibraryDevelopSettingsPortCurrentV1['applyBatch']> | undefined;
	try {
		const port = child(f.session), before = await f.inspect(), packet = port.copy({ schemaVersion: 3, develop: recipe(), selection: FULL });
		const input = batch(f, { kind: 'paste', settings: packet }, [0, 1]);
		f.hooks.afterSave = async () => { entered.resolve(); await release.promise; };
		work = port.applyBatch(input, { signal: stop.signal }); const watched = observe(work);
		await Promise.race([entered.promise, watched.then(() => { throw new Error('Actual native settings ACK never entered.'); })]);
		Reflect.set(input.targets[1]!, 'photoId', 'replacement'); stop.abort(reason.proxy); assert.equal(await remainsPending(work), true);
		release.resolve(); const result = await work;
		assert.equal(result.schemaVersion, 3); assert.equal(result.completion, 'cancelled');
		assert.deepEqual(result.outcomes.map(row => row.status), ['applied', 'not-attempted']); assert.equal(result.outcomes[1]!.photoId, before[1]!.photo.id);
		const after = await f.inspect(); assert.equal(after[0]!.photo.revision, before[0]!.photo.revision + 1);
		assert.equal(normalizeImageDevelopStateV4(after[0]!.photo.versions[0]!.develop).rawDevelopment.mode, 'recovery');
		assert.deepEqual(after[1], before[1]); assert.deepEqual(after.map(row => row.bytes), before.map(row => row.bytes));
	} finally { release.resolve(); await Promise.allSettled([work]); await f.close(); }
});

test('Permanent current3 settings keep Through3/Packet3 and reject future metadata before native writer or selected initialization', async () => {
	const f = await repairSettingsFixture(); let mutations = 0, operations = 0;
	const host: PhotoLibraryDevelopSettingsSessionHostCurrentV1 = {
		repository: { async loadPhoto() { assert.fail('Permanent3 future input cannot load a selected Photo.'); } },
		async ready() { assert.fail('Permanent3 future input cannot initialize.'); },
		async operation() { operations++; assert.fail('Permanent3 future input cannot enter selected lifetime.'); },
		async mutate() { mutations++; assert.fail('Permanent3 future input cannot acquire writer.'); },
		async withPhoto() { assert.fail('Permanent3 future input cannot open a command owner.'); },
		async verifyPhotoResources() { assert.fail('Permanent3 future input cannot borrow resources.'); },
		async verifyDevelopResources() { assert.fail('Permanent3 future input cannot borrow draft resources.'); },
	};
	try {
		const fixed = createPhotoLibraryDevelopSettingsSessionForProfileV1('current3', host), develop = recipe();
		assert.throws(() => Reflect.apply(fixed.copy, fixed, [{ schemaVersion: 3, develop, selection: FULL }]));
		await assert.rejects(Reflect.apply(fixed.copySelected, fixed, [{ ...source(f, develop), selection: FULL }]) as Promise<unknown>);
		const packet = copyImageDevelopSettingsV4({ schemaVersion: 4, develop, selection: FULL });
		await assert.rejects(Reflect.apply(fixed.applyBatch, fixed, [batch(f, { kind: 'paste', settings: packet })]) as Promise<unknown>);
		assert.equal(mutations, 0); assert.equal(operations, 0); assert.equal(f.saved.length, 0);
	} finally { await f.close(); }
});
