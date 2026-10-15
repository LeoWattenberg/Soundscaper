/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { repairPresetsFixture } from './helpers/lightscaper-repair-presets-current-fixture.ts';
import { defaultImageDevelopStateV1 } from '../src/common/editor/imaging/image-develop-state-v1.ts';
import { normalizeImageDevelopStateV4 } from '../src/common/editor/imaging/image-develop-state-v4.ts';
import { copyImageDevelopSettingsV4 } from '../src/common/editor/imaging/image-develop-settings-v4.ts';
import { copyImageDevelopSelectedSettingsV4 } from '../src/common/editor/imaging/image-develop-settings-selected-v4.ts';
import { copyImageDevelopSelectedSettingsV3 } from '../src/common/editor/imaging/image-develop-settings-selected-v3.ts';
import type { ImageDevelopSelectionV4 } from '../src/common/editor/imaging/image-develop-settings-contract-v4.ts';
import type { PhotoLibraryDevelopPresetCurrentV1 } from '../src/common/editor/photo-library-develop-presets-port-current-v1.ts';
import { readPhotoDevelopPresetForProfileV1, preparePhotoDevelopPresetBatchCurrentKernelV1 } from '../src/lightscaper/storage/internal/photo-develop-presets-kernel-v1.ts';
import { capturePhotoDevelopPresetsArchiveCurrentV1 } from '../src/lightscaper/storage/photo-develop-presets-archive-current-v1.ts';
import { capturePhotoDevelopPresetsArchiveForProfileV1 } from '../src/lightscaper/storage/internal/photo-develop-presets-archive-kernel-v1.ts';
import { LUT_BODY } from './helpers/lightscaper-lut-archive-fixture.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

type Fixture = Awaited<ReturnType<typeof repairPresetsFixture>>;
const FULL: ImageDevelopSelectionV4 = { effectTypes: 'all', geometry: true, localAdjustments: true, repairs: true, rawDevelopment: true };
function child(f: Fixture) { const port = f.session.develop.presetsCurrent; assert.ok(port); return port; }
function recipe(f: Fixture) {
	const old = f.source().develop;
	return normalizeImageDevelopStateV4({ ...old, processVersion: 4, repairs: old.processVersion === 3 ? old.repairs : { schemaVersion: 1, spots: [] },
		rawDevelopment: { schemaVersion: 1, mode: 'recovery' } });
}
function preset(f: Fixture, id = 'raw-recovery', develop = recipe(f), selection: ImageDevelopSelectionV4 = FULL) {
	const settings = copyImageDevelopSelectedSettingsV4({ schemaVersion: 4, develop, selection });
	return child(f).create({ schemaVersion: 3, id, name: `Saved ${id}`, settings });
}
function write(f: Fixture, value: PhotoLibraryDevelopPresetCurrentV1 = preset(f), expectedRevision = 0, signal?: AbortSignal) {
	return child(f).write({ schemaVersion: 3, catalogId: f.root.id, command: { type: 'save', expectedRevision, preset: value } }, signal ? { signal } : {});
}
async function resourceRecipe(f: Fixture) {
	const brush = (await f.installBrush([255, 0, 128])).reference, unused = (await f.installBrush([0, 96, 255])).reference;
	const luts = f.session.cubeLuts; assert.ok(luts); const lut = (await luts.importFile(new Blob([new Uint8Array(LUT_BODY)]))).reference;
	const base = recipe(f), develop = normalizeImageDevelopStateV4({ ...base,
		effects: [...base.effects, { id: 'retained-lut', type: 'cube-lut-profile-v1', enabled: false, params: { lut } }],
		masks: [...base.masks, { schemaVersion: 2, kind: 'matte', id: 'retained-paint', name: 'Retained brush',
			inputs: [{ name: 'Paint', kind: 'alpha', sourceRef: brush.storageKey }, { name: 'Unused', kind: 'alpha', sourceRef: unused.storageKey }],
			nodes: [{ id: 'alpha', kind: 'alpha', inputName: 'Paint' }], outputNodeId: 'alpha' }] });
	return { develop, brush, unused, lut };
}

test('actual selected Current preset child saves and reopens an explicit recovery packet4 at the existing native settings key', async () => {
	const f = await repairPresetsFixture();
	let reopened: Awaited<ReturnType<Fixture['reopen']>> | undefined;
	try {
		const cap = f.session.develop.presetsCurrent; assert.ok(cap);
		const develop = normalizeImageDevelopStateV4({ ...defaultImageDevelopStateV1(), processVersion: 4,
			repairs: { schemaVersion: 1, spots: [] }, rawDevelopment: { schemaVersion: 1, mode: 'recovery' } });
		const settings = copyImageDevelopSettingsV4({ schemaVersion: 4, develop,
			selection: { effectTypes: 'all', geometry: true, localAdjustments: true, repairs: true, rawDevelopment: true } });
		const preset = cap.create({ schemaVersion: 3, id: 'raw-recovery', name: 'Recover sensor highlights', settings });
		const ack = await cap.write({ schemaVersion: 3, catalogId: f.root.id, command: { type: 'save', expectedRevision: 0, preset } });
		assert.equal(ack.snapshot.revision, 1); assert.deepEqual(ack.notices, []);
		const body = await cap.read({ schemaVersion: 3, catalogId: f.root.id, presetId: preset.identity.id, expectedRevision: 1 });
		assert.deepEqual(body.preset, preset); assert.deepEqual(body.preset.settings.develop, develop);
		assert.equal(Object.getOwnPropertyDescriptor(await f.row() as object, 'schemaVersion')?.value, 4);
		reopened = await f.reopen(); const next = reopened.develop.presetsCurrent; assert.ok(next);
		assert.deepEqual(await next.read({ schemaVersion: 3, catalogId: f.root.id, presetId: preset.identity.id, expectedRevision: 1 }), body);
	} finally { await reopened?.close(); await f.close(); }
});

test('Current create preserves an explicit old Packet3 while Packet4 remains a distinct saved successor', async () => {
	const f = await repairPresetsFixture();
	try {
		const settings = copyImageDevelopSelectedSettingsV3({ schemaVersion: 3, develop: f.source().develop,
			selection: { effectTypes: 'all', geometry: true, localAdjustments: true, repairs: true } });
		const old = child(f).create({ schemaVersion: 3, id: 'old-preset', name: 'Unchanged old preset', settings });
		assert.equal(old.schemaVersion, 3); assert.deepEqual(old.settings, settings); await write(f, old);
		const oldRow = await f.row(); assert.equal(Object.getOwnPropertyDescriptor(oldRow as object, 'schemaVersion')?.value, 3);
		const current = preset(f); assert.equal(current.schemaVersion, 4); await write(f, current, 1);
		const retained = await child(f).read({ schemaVersion: 3, catalogId: f.root.id, presetId: old.identity.id, expectedRevision: 2 });
		assert.deepEqual(retained.preset, old); assert.equal(Object.getOwnPropertyDescriptor(await f.row() as object, 'schemaVersion')?.value, 4);
	} finally { await f.close(); }
});

test('native Current preset4 retains complete brush/LUT closure, advertises partial RAW selection, and leaves Photo Originals unchanged', async () => {
	const f = await repairPresetsFixture();
	try {
		const { develop } = await resourceRecipe(f), before = await f.inspect(), value = preset(f, 'resources', develop);
		await write(f, value); const saved = await child(f).read({ schemaVersion: 3, catalogId: f.root.id, presetId: value.identity.id, expectedRevision: 1 });
		assert.deepEqual(saved.preset.settings.develop, develop); assert.deepEqual(await f.inspect(), before);
		assert.equal((await child(f).list({ schemaVersion: 3, catalogId: f.root.id })).presets[0]!.scope, 'full');
		await write(f, preset(f, 'without-source', develop, { ...FULL, rawDevelopment: false }), 1);
		const menu = await child(f).list({ schemaVersion: 3, catalogId: f.root.id });
		assert.equal(menu.presets.find(value => value.id === 'without-source')!.scope, 'partial');
		assert.ok(f.borrowed.length > 0); assert.ok(f.borrowed.every(bytes => bytes.every(byte => byte === 0)));
		assert.throws(() => child(f).serialize(saved.preset)); assert.throws(() => child(f).parse(JSON.stringify(saved.preset)));
	} finally { await f.close(); }
});

test('fixed native current3 refuses Row4 while Current archive capture binds its complete retained row digest', async () => {
	const f = await repairPresetsFixture();
	try {
		const value = preset(f); await write(f, value); const before = await f.row();
		await assert.rejects(readPhotoDevelopPresetForProfileV1('current3', f.settings, f.root.id, value.identity.id, 1));
		await assert.rejects(capturePhotoDevelopPresetsArchiveForProfileV1('current3', f.settings, f.root.id));
		const capture = await capturePhotoDevelopPresetsArchiveCurrentV1(f.settings, f.root.id);
		assert.deepEqual(capture.row, before); await capture.verify();
		assert.equal(capture.row!.schemaVersion, 4); await f.writeRow({ ...capture.row, revision: 2 });
		await assert.rejects(capture.verify(), { code: 'DEVELOP_PRESET_REVISION_CONFLICT' });
	} finally { await f.close(); }
});

test('native preset4 write captures the complete request before yielding and equal saves produce no extra CAS', async () => {
	const f = await repairPresetsFixture();
	try {
		const expected = preset(f), mutable = structuredClone(expected), work = write(f, mutable);
		if (mutable.settings.develop.processVersion !== 4) assert.fail('Expected process4.');
		Reflect.set(mutable.settings.develop.rawDevelopment, 'mode', 'canonical'); Reflect.set(mutable.identity, 'name', 'Changed after capture');
		const ack = await work; assert.equal(ack.snapshot.revision, 1);
		const stored = await child(f).read({ schemaVersion: 3, catalogId: f.root.id, presetId: expected.identity.id, expectedRevision: 1 });
		assert.deepEqual(stored.preset, expected); const count = f.writes.length;
		assert.equal((await write(f, expected, 1)).snapshot.revision, 1); assert.equal(f.writes.length, count);
		await assert.rejects(write(f, expected, 0), { code: 'DEVELOP_PRESET_REVISION_CONFLICT' });
		assert.equal(f.writes.length, count);
	} finally { await f.close(); }
});

test('Current batch binding authenticates every retained disabled LUT and unused brush before unrelated no-op publication', async () => {
	for (const kind of ['lut', 'brush'] as const) {
		const f = await repairPresetsFixture();
		try {
			const clean = preset(f, 'clean'); await write(f, clean);
			const resources = await resourceRecipe(f); await write(f, preset(f, 'retained', resources.develop), 1);
			const binding = await preparePhotoDevelopPresetBatchCurrentKernelV1(f.settings, f.root.id, 'clean', 2, { resources: f.resources });
			assert.deepEqual(binding.preset, clean); await binding.recheck();
			await f.corruptResource(kind === 'lut' ? resources.lut.storageKey : resources.unused.storageKey); const before = await f.row(), count = f.writes.length;
			await assert.rejects(preparePhotoDevelopPresetBatchCurrentKernelV1(f.settings, f.root.id, 'clean', 2, { resources: f.resources }));
			await assert.rejects(write(f, clean, 2)); assert.equal(f.writes.length, count); assert.deepEqual(await f.row(), before);
			assert.ok(f.borrowed.every(bytes => bytes.every(byte => byte === 0)));
		} finally { await f.close(); }
	}
});

test('Current preset4 Close joins held native brush authentication and publishes no provisional row', async () => {
	const f = await repairPresetsFixture(), entered = deferred<void>(), release = deferred<void>();
	const pending: { work?: ReturnType<typeof write>; closing?: Promise<void> } = {};
	try {
		const resources = await resourceRecipe(f), value = preset(f, 'held', resources.develop); f.borrowed.splice(0);
		f.hooks.borrowedBrush = async () => { entered.resolve(); await release.promise; };
		pending.work = write(f, value); void pending.work.catch(() => undefined);
		assert.equal(await Promise.race([entered.promise.then(() => true), pending.work.then(() => false, () => false)]), true);
		pending.closing = f.session.close(); assert.equal(f.session.close(), pending.closing); assert.equal(await remainsPending(pending.closing), true);
		assert.equal(f.writes.length, 0); assert.ok(f.borrowed[0]!.some(byte => byte !== 0));
		release.resolve(); await assert.rejects(pending.work); await pending.closing;
		assert.equal(await f.row(), undefined); assert.ok(f.borrowed.every(bytes => bytes.every(byte => byte === 0)));
	} finally { release.resolve(); await pending.work?.catch(() => undefined); await pending.closing?.catch(() => undefined); await f.close(); }
});

test('known native Row4 ACK survives a held return and opaque late cancellation without a second CAS', async () => {
	const f = await repairPresetsFixture(), entered = deferred<void>(), release = deferred<void>(), stop = new AbortController();
	const opaque = Proxy.revocable({}, {}); opaque.revoke(); const pending: { work?: ReturnType<typeof write> } = {};
	try {
		const value = preset(f); f.presetHooks.afterWrite = async acknowledged => { if (acknowledged) { entered.resolve(); await release.promise; } };
		pending.work = write(f, value, 0, stop.signal); void pending.work.catch(() => undefined);
		assert.equal(await Promise.race([entered.promise.then(() => true), pending.work.then(() => false, () => false)]), true);
		stop.abort(opaque.proxy); assert.equal(await remainsPending(pending.work), true); release.resolve();
		const ack = await pending.work; assert.equal(ack.snapshot.revision, 1); assert.equal(ack.schemaVersion, 3);
		assert.deepEqual(f.writes.map(value => value.acknowledged), [true]);
		assert.equal(Object.getOwnPropertyDescriptor(await f.row() as object, 'schemaVersion')?.value, 4);
	} finally { release.resolve(); await pending.work?.catch(() => undefined); await f.close(); }
});

test('Current preset4 preabort preserves an opaque native reason before reflecting hostile request metadata', async () => {
	const f = await repairPresetsFixture(), stop = new AbortController(), opaque = Proxy.revocable({}, {}); opaque.revoke(); stop.abort(opaque.proxy); let reflected = 0;
	try {
		const hostile = new Proxy({}, { ownKeys() { reflected++; throw new Error('Cancelled request reflected.'); } });
		const work = Reflect.apply(child(f).write, child(f), [hostile, { signal: stop.signal }]) as Promise<unknown>;
		const outcome = await work.then(() => ({ ok: true }), (error: unknown) => ({ error }));
		assert.ok('error' in outcome); assert.ok(Object.is(outcome.error, opaque.proxy)); assert.equal(reflected, 0); assert.equal(f.writes.length, 0);
	} finally { await f.close(); }
});
