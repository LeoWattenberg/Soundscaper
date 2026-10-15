/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeImageDevelopStateCurrentV1 } from '../src/common/editor/imaging/image-develop-state-current-v1.ts';
import { repairPresetsFixture } from './helpers/lightscaper-repair-presets-current-fixture.ts';
import { brushSettingsRecipe, SETTINGS_TIME } from './helpers/lightscaper-repair-settings-current-fixture.ts';
import { LUT_BODY, LUT_REFERENCE, profile } from './helpers/lightscaper-masked-frame-fixture.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

type Fixture = Awaited<ReturnType<typeof repairPresetsFixture>>;
interface Menu { readonly schemaVersion: 3; readonly catalogId: string; readonly revision: number; readonly presets: readonly { readonly id: string; readonly name: string; readonly authoredStateSha256: string }[] }
interface Presets { create(value: unknown): { readonly schemaVersion: 4; readonly settings: unknown; readonly identity: { readonly id: string; readonly name: string; readonly authoredStateSha256: string } };
	parse(text: string): unknown; serialize(value: unknown): string;
	list(value: unknown, options?: { signal?: AbortSignal }): Promise<Menu>;
	read(value: unknown, options?: { signal?: AbortSignal }): Promise<{ readonly schemaVersion: 3; readonly revision: number; readonly preset: ReturnType<Presets['create']> }>;
	write(value: unknown, options?: { signal?: AbortSignal }): Promise<{ readonly schemaVersion: 3; readonly snapshot: Menu; readonly notices: readonly string[] }> }
function child(session: Fixture['session']): Presets {
	const descriptor = Object.getOwnPropertyDescriptor(session.develop, 'presetsCurrent');
	assert.ok(descriptor && Object.hasOwn(descriptor, 'value') && descriptor.value, 'The actual selected Develop3 must own presetsCurrent.'); return descriptor.value as Presets;
}
function request(f: Fixture, command: unknown) { return { schemaVersion: 3, catalogId: f.root.id, command }; }
async function save(f: Fixture, cap: Presets, id = 'repair-preset', draft = f.source().develop, expectedRevision = 0) {
	const packet = await f.selectedPacket(draft), preset = cap.create({ schemaVersion: 3, id, name: 'Repair preset', settings: packet });
	assert.equal(packet.schemaVersion, 4); assert.equal(preset.schemaVersion, 4);
	const ack = await cap.write(request(f, { type: 'save', expectedRevision, preset })); return { packet, preset, ack };
}
async function apply(f: Fixture, presetId = 'repair-preset', expectedPresetRevision = 1, indexes = [1]) {
	const targets = await Promise.all(indexes.map(async index => { const snapshot = await f.read(index); return { photoId: snapshot.photoId, versionId: snapshot.versionId, expectedRevision: snapshot.revision }; }));
	return Reflect.apply(f.session.develop.settingsCurrent!.applyBatch, f.session.develop.settingsCurrent, [{ schemaVersion: 3, catalogId: f.root.id,
		targets, action: { kind: 'preset', presetId, expectedPresetRevision }, label: 'Apply native preset', createdAt: SETTINGS_TIME }]) as ReturnType<NonNullable<Fixture['session']['develop']['settingsCurrent']>['applyBatch']>;
}

test('actual Current preset save/list/read/reopen retains dirty repairs, named brush and LUT while native application uses the stored row', async () => {
	const f = await repairPresetsFixture(); let reopened: Awaited<ReturnType<Fixture['reopen']>> | undefined;
	try {
		const cap = child(f.session), brush = await f.installBrush(), lut = await f.session.cubeLuts!.importFile(new Blob([LUT_BODY])); assert.deepEqual(lut.reference, LUT_REFERENCE);
		const base = brushSettingsRecipe(brush.reference), draft = normalizeImageDevelopStateCurrentV1({ ...base, effects: [...base.effects, profile()] }), before = await f.inspect();
		const saved = await save(f, cap, 'repair-preset', draft); assert.equal(saved.ack.schemaVersion, 3); assert.equal(saved.ack.snapshot.revision, 1);
		const body = await cap.read({ schemaVersion: 3, catalogId: f.root.id, presetId: 'repair-preset', expectedRevision: 1 }); assert.deepEqual(body.preset, saved.preset);
		assert.deepEqual((await cap.list({ schemaVersion: 3, catalogId: f.root.id })).presets.map(value => value.id), ['repair-preset']); assert.deepEqual(await f.inspect(), before);
		const receipt = await apply(f); assert.equal(receipt.outcomes[0]!.status, 'applied'); const after = await f.inspect();
		assert.deepEqual(after[1]!.photo.versions[0]!.develop, draft); assert.deepEqual(after.map(value => value.bytes), before.map(value => value.bytes));
		assert.deepEqual(after[0], before[0]); assert.ok(f.borrowed.every(bytes => bytes.every(byte => byte === 0)));
		reopened = await f.reopen(); assert.deepEqual(await child(reopened).read({ schemaVersion: 3, catalogId: f.root.id, presetId: 'repair-preset', expectedRevision: 1 }), body);
	} finally { await reopened?.close(); await f.close(); }
});

test('stored brush settings and JSON clones never become issued Current paste packets', async () => {
	const f = await repairPresetsFixture();
	try {
		const cap = child(f.session), body = await f.installBrush(), saved = await save(f, cap, 'repair-preset', brushSettingsRecipe(body.reference));
		const stored = await cap.read({ schemaVersion: 3, catalogId: f.root.id, presetId: 'repair-preset', expectedRevision: 1 }), before = await f.inspect();
		for (const packet of [stored.preset.settings, JSON.parse(JSON.stringify(saved.packet)) as unknown]) {
			assert.throws(() => Reflect.apply(f.session.develop.settingsCurrent!.merge, f.session.develop.settingsCurrent, [{ schemaVersion: 3, target: f.source(1).develop, settings: packet }]));
			await assert.rejects(Reflect.apply(f.session.develop.settingsCurrent!.applyBatch, f.session.develop.settingsCurrent, [{ schemaVersion: 3, catalogId: f.root.id,
				targets: [{ photoId: f.photos[1]!.id, versionId: f.photos[1]!.activeVersionId, expectedRevision: f.photos[1]!.revision }], action: { kind: 'paste', settings: packet }, label: 'Raw paste', createdAt: SETTINGS_TIME }]) as Promise<unknown>);
		}
		assert.throws(() => cap.serialize(stored.preset)); assert.throws(() => cap.parse(JSON.stringify(stored.preset))); assert.deepEqual(await f.inspect(), before);
		assert.equal((await apply(f)).outcomes[0]!.status, 'applied');
	} finally { await f.close(); }
});

test('native preset revision drift between serial target ACKs forbids the later target without erasing the first ACK', async () => {
	const f = await repairPresetsFixture();
	try {
		const cap = child(f.session), develop = f.session.develop.settingsCurrent!.adjust({ schemaVersion: 3, target: f.source().develop, effectType: 'tone-ladder-v1', changes: { exposure: 1 } });
		await save(f, cap, 'repair-preset', develop); const before = await f.inspect();
		f.hooks.afterSave = async () => { const row = await f.row() as Record<string, unknown>; await f.writeRow({ ...row, revision: 2 }); };
		const receipt = await apply(f, 'repair-preset', 1, [0, 1]); assert.equal(receipt.outcomes[0]!.status, 'applied'); assert.equal(receipt.outcomes[1]!.status, 'conflict');
		const after = await f.inspect(); assert.equal(after[0]!.photo.revision, before[0]!.photo.revision + 1); assert.deepEqual(after[1], before[1]); assert.equal(f.saved.length, 1);
		assert.deepEqual(after.map(value => value.bytes), before.map(value => value.bytes));
	} finally { await f.close(); }
});

test('application authenticates the complete retained native preset row including another disabled LUT and unused brush', async () => {
	const f = await repairPresetsFixture();
	try {
		const cap = child(f.session), body = await f.installBrush(), lut = await f.session.cubeLuts!.importFile(new Blob([LUT_BODY]));
		await save(f, cap, 'clean'); const base = brushSettingsRecipe(body.reference), draft = normalizeImageDevelopStateCurrentV1({ ...base, effects: [...base.effects, { ...profile(), enabled: false }] });
		await save(f, cap, 'retained', draft, 1); await f.corruptResource(lut.reference.storageKey); const before = await f.inspect();
		await assert.rejects(apply(f, 'clean', 2)); assert.equal(f.saved.length, 0); assert.deepEqual(await f.inspect(), before);
		assert.ok(f.borrowed.every(bytes => bytes.every(byte => byte === 0)));
	} finally { await f.close(); }
});

test('preset application rejects stale row revisions and foreign catalog IDs before a native Photo write', async () => {
	const f = await repairPresetsFixture();
	try {
		const cap = child(f.session); await save(f, cap); const before = await f.inspect();
		await assert.rejects(apply(f, 'repair-preset', 0)); await assert.rejects(cap.list({ schemaVersion: 3, catalogId: 'foreign-catalog' }));
		assert.equal(f.saved.length, 0); assert.deepEqual(await f.inspect(), before);
	} finally { await f.close(); }
});

test('actual Session Close joins held preset body authentication, wipes bytes, and permits no row publication', async () => {
	const f = await repairPresetsFixture(), entered = deferred<void>(), release = deferred<void>(); const joining: { work?: Promise<unknown>; closing?: Promise<void> } = {};
	try {
		const cap = child(f.session), body = await f.installBrush(), packet = await f.selectedPacket(brushSettingsRecipe(body.reference)); f.borrowed.splice(0);
		const preset = cap.create({ schemaVersion: 3, id: 'held', name: 'Held', settings: packet });
		f.hooks.borrowedBrush = async () => { entered.resolve(); await release.promise; }; joining.work = cap.write(request(f, { type: 'save', expectedRevision: 0, preset })); void joining.work.catch(() => undefined);
		assert.equal(await Promise.race([entered.promise.then(() => true), joining.work.then(() => false, () => false)]), true);
		joining.closing = f.session.close(); assert.equal(f.session.close(), joining.closing); assert.equal(await remainsPending(joining.closing), true);
		assert.equal(f.writes.length, 0); assert.ok(f.borrowed[0]!.some(byte => byte !== 0)); release.resolve();
		await assert.rejects(joining.work); await joining.closing; assert.equal(await f.row(), undefined); assert.ok(f.borrowed.every(bytes => bytes.every(byte => byte === 0)));
	} finally { release.resolve(); await joining.work?.catch(() => undefined); await joining.closing?.catch(() => undefined); await f.close(); }
});

test('Current preset preabort preserves the native opaque reason before hostile request reflection', async () => {
	const f = await repairPresetsFixture();
	try {
		const cap = child(f.session), stop = new AbortController(), primary = Proxy.revocable({}, {}); primary.revoke(); stop.abort(primary.proxy); let traps = 0;
		const input = new Proxy({}, { ownKeys() { traps++; throw new Error('Late request'); } });
		const outcome = await cap.write(input, { signal: stop.signal }).then(() => ({ ok: true }), (error: unknown) => ({ error }));
		assert.ok('error' in outcome); assert.equal(outcome.error, primary.proxy); assert.equal(traps, 0); assert.equal(f.writes.length, 0);
	} finally { await f.close(); }
});

test('Current preset native ACK survives held return plus opaque late cancellation with cleanup notice and no repeated CAS', async () => {
	const f = await repairPresetsFixture(), entered = deferred<void>(), release = deferred<void>(), stop = new AbortController(), opaque = Proxy.revocable({}, {}); opaque.revoke();
	const joining: { work?: ReturnType<Presets['write']> } = {};
	try {
		const cap = child(f.session), preset = cap.create({ schemaVersion: 3, id: 'late', name: 'Late', settings: await f.selectedPacket() });
		f.presetHooks.afterWrite = async acknowledged => { if (acknowledged) { entered.resolve(); await release.promise; } };
		joining.work = cap.write(request(f, { type: 'save', expectedRevision: 0, preset }), { signal: stop.signal }); void joining.work.catch(() => undefined);
		assert.equal(await Promise.race([entered.promise.then(() => true), joining.work.then(() => false, () => false)]), true);
		stop.abort(opaque.proxy); assert.equal(await remainsPending(joining.work), true); release.resolve(); const ack = await joining.work;
		assert.equal(ack.snapshot.revision, 1); assert.deepEqual(f.writes.map(value => value.acknowledged), [true]); assert.equal(ack.schemaVersion, 3);
	} finally { release.resolve(); await joining.work?.catch(() => undefined); await f.close(); }
});
