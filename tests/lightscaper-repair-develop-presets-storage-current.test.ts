/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { applyPhotoDevelopPresetCurrentV1 as apply, readPhotoDevelopPresetsCurrentV1 as list, readPhotoDevelopPresetCurrentV1 as read } from '../src/lightscaper/storage/photo-develop-presets-current-v1.ts';
import { applyPhotoDevelopPresetV2 as legacyApply } from '../src/lightscaper/storage/photo-develop-presets-v2.ts';
import { createImageDevelopPresetV2 } from '../src/common/editor/imaging/image-develop-preset-v2.ts';
import { copyImageDevelopSettingsV2 } from '../src/common/editor/imaging/image-develop-settings-v2.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { normalizeImageDevelopStateCurrentV1 } from '../src/common/editor/imaging/image-develop-state-current-v1.ts';
import { brushSettingsRecipe } from './helpers/lightscaper-repair-settings-current-fixture.ts';
import { repairPresetsFixture, currentPreset } from './helpers/lightscaper-repair-presets-current-fixture.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

type Fixture = Awaited<ReturnType<typeof repairPresetsFixture>>;
type Settings = Fixture['settings'];
interface Snapshot { readonly schemaVersion: number; readonly revision: number; readonly presets: readonly { readonly id: string; readonly name: string }[] }
// Current subjects replace the strict baseline after Root recorded its refusal;
// the permanent legacy case still invokes the original named owner.
function save(f: Fixture, preset: unknown, expectedRevision = 0, settings: Settings = f.settings, signal?: AbortSignal, resources = f.resources): Promise<Snapshot> {
	return Reflect.apply(apply, undefined, [settings, f.root, { type: 'save', expectedRevision, preset }, { resources, ...(signal ? { signal } : {}) }]) as Promise<Snapshot>;
}

test('native Current preset rows persist exact repairs, list/read, no-op and retain Row4 after final deletion', async () => {
	const f = await repairPresetsFixture();
	try {
		const before = await f.inspect(), preset = currentPreset(f.packet()), first = await save(f, preset);
		assert.equal(first.schemaVersion, 3); assert.equal(first.revision, 1); assert.deepEqual(first.presets.map(value => value.id), ['repair-preset']);
		assert.deepEqual((await read(f.settings, f.root.id, preset.identity.id, 1) as unknown as { preset: unknown }).preset, preset);
		assert.deepEqual(await list(f.settings, f.root.id), first); assert.deepEqual(await save(f, preset, 1), first); assert.equal(f.writes.length, 1);
		const removed = await Reflect.apply(apply, undefined, [f.settings, f.root, { type: 'delete', expectedRevision: 1, presetId: preset.identity.id }, { resources: f.resources }]) as Snapshot;
		assert.equal(removed.revision, 2); assert.deepEqual(removed.presets, []); assert.equal((await f.row() as { schemaVersion: number }).schemaVersion, 4);
		assert.deepEqual(await f.inspect(), before);
	} finally { await f.close(); }
});

test('two actual native settings owners produce one positive CAS and one conflict even for the identical next row', async () => {
	const f = await repairPresetsFixture();
	try {
		const preset = currentPreset(f.packet()), other = await f.openSettings(), entered = deferred<void>(); let reads = 0;
		// The instrumented database does not queue overlapping readwrite transactions.
		// Keep both absent point reads, then serialize only the actual native writes.
		let writeTail: Promise<void> = Promise.resolve();
		const capture = (settings: Settings): Settings => {
			const put = settings.putIfAbsent;
			return { ...settings, readEntry: async key => {
				const value = await settings.readEntry!(key); assert.equal(value.present, false);
				if (++reads === 2) { assert.equal(f.writes.length, 0); entered.resolve(); } await entered.promise; return value;
			}, putIfAbsent: (...args) => {
				const work = writeTail.then(() => Reflect.apply(put, settings, args) as Promise<boolean>);
				writeTail = work.then(() => undefined, () => undefined); return work;
			} };
		};
		const outcomes = await Promise.allSettled([save(f, preset, 0, capture(f.settings)), save(f, preset, 0, capture(other))]);
		assert.equal(reads, 2); assert.equal(outcomes.filter(value => value.status === 'fulfilled').length, 1);
		assert.equal(outcomes.filter(value => value.status === 'rejected').length, 1); assert.deepEqual(f.writes.map(value => value.acknowledged).sort(), [false, true]);
		assert.equal((await f.row() as { revision: number }).revision, 1);
	} finally { await f.close(); }
});

test('Current native row verification joins genuine held brush bytes before CAS and wipes them afterward', async () => {
	const f = await repairPresetsFixture(), entered = deferred<void>(), release = deferred<void>(); const joining: { work?: Promise<Snapshot> } = {};
	try {
		const body = await f.installBrush(), packet = await f.selectedPacket(brushSettingsRecipe(body.reference)), preset = currentPreset(packet);
		f.borrowed.splice(0); f.hooks.borrowedBrush = async () => { entered.resolve(); await release.promise; };
		joining.work = save(f, preset); void joining.work.catch(() => undefined);
		const outcome = await Promise.race([entered.promise.then(() => true), joining.work.then(() => false, () => false)]);
		assert.equal(outcome, true, 'The actual selected borrower must authenticate before native CAS.'); assert.equal(f.writes.length, 0);
		assert.equal(await remainsPending(joining.work), true); assert.ok(f.borrowed[0]!.some(byte => byte !== 0)); release.resolve();
		assert.equal((await joining.work).revision, 1); assert.ok(f.borrowed.every(bytes => bytes.every(byte => byte === 0)));
	} finally { release.resolve(); await joining.work?.catch(() => undefined); await f.close(); }
});

test('native Current writes authenticate other retained preset bodies before publishing a clean changed prefix', async () => {
	const f = await repairPresetsFixture();
	try {
		const body = await f.installBrush(), bad = currentPreset(await f.selectedPacket(brushSettingsRecipe(body.reference)), 'retained'), clean = currentPreset(f.packet(), 'clean');
		await f.writeRow({ schemaVersion: 4, kind: 'photo-develop-presets', catalogId: f.root.id, revision: 1, presets: [clean, bad] });
		await f.corruptBrush(body.reference); const before = await f.row(), photos = await f.inspect();
		await assert.rejects(save(f, currentPreset(f.packet(), 'clean', 'Changed name'), 1)); assert.deepEqual(await f.row(), before);
		assert.equal(f.writes.length, 0); assert.deepEqual(await f.inspect(), photos); assert.ok(f.borrowed.every(bytes => bytes.every(byte => byte === 0)));
	} finally { await f.close(); }
});

for (const sourceRef of ['foreign-source', `brush-mask-v2:1:1:${'a'.repeat(64)}`]) test(`native Current preset admission refuses unused ${sourceRef} before any body or CAS`, async () => {
	const f = await repairPresetsFixture();
	try {
		const body = await f.installBrush(), base = brushSettingsRecipe(body.reference), graph = base.masks[0]!;
		const develop = normalizeImageDevelopStateCurrentV1({ ...base, masks: [{ ...graph, inputs: [...graph.inputs, { name: 'unused', sourceRef, kind: 'alpha' }] }] });
		const packet = { schemaVersion: 3 as const, kind: 'photo-develop-settings' as const, selection: { effectTypes: 'all' as const, geometry: true, localAdjustments: true, repairs: true }, develop };
		await assert.rejects(save(f, currentPreset(packet))); assert.equal(f.borrowed.length, 0); assert.equal(f.writes.length, 0); assert.equal(await f.row(), undefined);
	} finally { await f.close(); }
});

test('a positive native preset ACK survives an opaque late cancellation without a repeated write', async () => {
	const f = await repairPresetsFixture(), entered = deferred<void>(), release = deferred<void>(), stop = new AbortController(), opaque = Proxy.revocable({}, {}); opaque.revoke();
	const joining: { work?: Promise<Snapshot> } = {};
	try {
		f.presetHooks.afterWrite = async positive => { if (positive) { entered.resolve(); await release.promise; } };
		joining.work = save(f, currentPreset(f.packet()), 0, f.settings, stop.signal); void joining.work.catch(() => undefined);
		assert.equal(await Promise.race([entered.promise.then(() => true), joining.work.then(() => false, () => false)]), true);
		stop.abort(opaque.proxy); assert.equal(await remainsPending(joining.work), true); release.resolve();
		assert.equal((await joining.work).revision, 1); assert.deepEqual(f.writes.map(value => value.acknowledged), [true]);
	} finally { release.resolve(); await joining.work?.catch(() => undefined); await f.close(); }
});

test('native Current storage detaches its complete preset and pins selected factory receivers before the first read wait', async () => {
	const f = await repairPresetsFixture(), entered = deferred<void>(), release = deferred<void>(); const joining: { work?: Promise<Snapshot> } = {};
	try {
		const body = await f.installBrush(), packet = await f.selectedPacket(brushSettingsRecipe(body.reference));
		const preset = JSON.parse(JSON.stringify(currentPreset(packet))) as { identity: { name: string }; settings: { develop: { masks: { inputs: { sourceRef: string }[] }[] } } };
		let calls = 0;
		const resources = { cubeLutResources() { assert.equal(this, resources); return f.resources.cubeLutResources(); },
			maskRasterResources() { assert.equal(this, resources); calls++; return f.resources.maskRasterResources(); } };
		const settings: Settings = { ...f.settings, readEntry: async key => { const row = await f.settings.readEntry!(key); entered.resolve(); await release.promise; return row; } };
		joining.work = save(f, preset, 0, settings, undefined, resources); void joining.work.catch(() => undefined);
		assert.equal(await Promise.race([entered.promise.then(() => true), joining.work.then(() => false, () => false)]), true);
		preset.identity.name = 'Late'; preset.settings.develop.masks[0]!.inputs[0]!.sourceRef = 'foreign-source';
		resources.maskRasterResources = () => { throw new Error('Late selected factory'); }; release.resolve();
		assert.equal((await joining.work).revision, 1); assert.equal(calls, 1);
		const row = await f.row() as { presets: { identity: { name: string }; settings: { develop: { masks: { inputs: { sourceRef: string }[] }[] } } }[] };
		assert.equal(row.presets[0]!.identity.name, 'Repair preset'); assert.equal(row.presets[0]!.settings.develop.masks[0]!.inputs[0]!.sourceRef, body.reference.storageKey);
	} finally { release.resolve(); await joining.work?.catch(() => undefined); await f.close(); }
});

test('permanent legacy native preset rows preserve old bytes and reject an actual Current repair preset', async () => {
	const f = await repairPresetsFixture();
	try {
		const settings = copyImageDevelopSettingsV2({ schemaVersion: 2, develop: defaultImageDevelopStateV2(), selection: { effectTypes: 'all', geometry: true, localAdjustments: true } });
		const legacy = createImageDevelopPresetV2({ schemaVersion: 2, id: 'legacy', name: 'Legacy', settings });
		const first = await legacyApply(f.settings, f.root, { type: 'save', expectedRevision: 0, preset: legacy }); assert.equal(first.schemaVersion, 2);
		const before = await f.row(); await assert.rejects(legacyApply(f.settings, f.root, { type: 'save', expectedRevision: 1, preset: currentPreset(f.packet()) }));
		assert.deepEqual(await f.row(), before);
	} finally { await f.close(); }
});
