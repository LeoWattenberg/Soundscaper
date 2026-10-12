/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { PhotoLibraryDevelopSettingsWorkflowCurrentV1 } from '../src/common/editor/controller/shared/photo-library-develop-settings-workflow-current-v1.ts';
import { normalizeImageDevelopStateCurrentV1 } from '../src/common/editor/imaging/image-develop-state-current-v1.ts';
import { createVideoEffectV2 } from '../src/common/editor/video-effects-v2.ts';
import { repairSettingsFixture, brushSettingsRecipe, FULL_SETTINGS_SELECTION, SETTINGS_TIME } from './helpers/lightscaper-repair-settings-current-fixture.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

type Fixture = Awaited<ReturnType<typeof repairSettingsFixture>>;
const workflow = (f: Fixture) => new PhotoLibraryDevelopSettingsWorkflowCurrentV1({ execute: f.execute, now: () => SETTINGS_TIME });
async function source(f: Fixture, index = 0, value?: unknown) {
	const document = await f.read(index);
	return { schemaVersion: 3 as const, catalogId: document.catalogId, photoId: document.photoId, versionId: document.versionId,
		revision: document.revision, develop: value === undefined ? document.develop : normalizeImageDevelopStateCurrentV1(value) };
}
async function list(owner: PhotoLibraryDevelopSettingsWorkflowCurrentV1, f: Fixture) {
	const result = await owner.listPresets(f.photos[0]!.catalogId); assert.ok(result); assert.equal(result.schemaVersion, 3); return result;
}
async function savedBody(owner: PhotoLibraryDevelopSettingsWorkflowCurrentV1, f: Fixture) {
	const menu = owner.snapshot().presets, cap = f.session.develop.presetsCurrent; assert.ok(menu); assert.ok(cap);
	const selected = menu.presets.at(-1); assert.ok(selected);
	return cap.read({ schemaVersion: 3, catalogId: menu.catalogId, presetId: selected.id, expectedRevision: menu.revision });
}
async function custody(f: Fixture, before: Awaited<ReturnType<Fixture['inspect']>>) {
	for (const [index, row] of (await f.inspect()).entries()) {
		assert.deepEqual(row.bytes, before[index]!.bytes); assert.deepEqual(row.photo.original, before[index]!.photo.original);
		assert.deepEqual(row.photo.metadata, before[index]!.photo.metadata); assert.deepEqual(row.photo.extractedMetadata, before[index]!.photo.extractedMetadata);
	}
}

test('Current preset workflow saves a complete dirty Clone and Heal draft without saving its source, then renames exact native metadata', async () => {
	const f = await repairSettingsFixture(), owner = workflow(f), before = await f.inspect();
	try {
		await list(owner, f); const original = (await f.read()).develop; assert.ok(original.processVersion === 3);
		const dirty = normalizeImageDevelopStateCurrentV1({ ...original,
			effects: [createVideoEffectV2('tone-ladder-v1', { id: 'tone', params: { exposure: .25 } })],
			repairs: { schemaVersion: 1, spots: [original.repairs.spots[0]!, { ...original.repairs.spots[0]!, id: 'heal', mode: 'heal' }] } });
		const ack = await owner.savePreset(await source(f, 0, dirty), FULL_SETTINGS_SELECTION, 'Dirty repairs'); assert.ok(ack); assert.equal(ack.schemaVersion, 3);
		const body = await savedBody(owner, f); assert.equal(body.preset.schemaVersion, 3); assert.deepEqual(body.preset.settings.develop, dirty);
		assert.equal(owner.snapshot().presets?.presets.find(preset => preset.id === body.preset.identity.id)?.scope, 'full');
		assert.deepEqual(body.preset.settings.selection, FULL_SETTINGS_SELECTION); assert.equal(f.saved.length, 0); assert.equal(owner.snapshot().clipboard, null);
		assert.deepEqual(await f.inspect(), before); const digest = body.preset.identity.authoredStateSha256;
		const rename = await owner.renamePreset(body.catalogId, body.preset.identity.id, body.revision, 'Renamed repairs'); assert.ok(rename);
		const renamed = await savedBody(owner, f); assert.equal(renamed.preset.identity.name, 'Renamed repairs');
		assert.equal(renamed.preset.identity.id, body.preset.identity.id); assert.equal(renamed.preset.identity.authoredStateSha256, digest);
		assert.deepEqual(renamed.preset.settings, body.preset.settings); assert.equal(renamed.revision, body.revision + 1);
		await owner.dismiss(); owner.resume(); const reopened = await list(owner, f);
		assert.equal(reopened.presets[0]?.authoredStateSha256, digest); assert.equal(reopened.presets[0]?.name, 'Renamed repairs'); await custody(f, before);
	} finally { await owner.close(); await f.close(); }
});

test('Current partial preset replaces only the ordered repair group through native binding and repeats as a no-op', async () => {
	const f = await repairSettingsFixture(), owner = workflow(f);
	try {
		const original = (await f.read()).develop; assert.ok(original.processVersion === 3);
		const target = normalizeImageDevelopStateCurrentV1({ ...original, repairs: { schemaVersion: 1, spots: [{ ...original.repairs.spots[0]!, id: 'target' }] },
			effects: [createVideoEffectV2('tone-ladder-v1', { id: 'target-tone', params: { exposure: .75 } })] });
		await f.record(target, 1); const before = await f.inspect(); await list(owner, f);
		const selection = { effectTypes: [], geometry: false, localAdjustments: false, repairs: true };
		const ack = await owner.savePreset(await source(f), selection, 'Repairs only'); assert.ok(ack); const body = await savedBody(owner, f);
		assert.equal(owner.snapshot().presets?.presets.find(preset => preset.id === body.preset.identity.id)?.scope, 'partial');
		assert.deepEqual(body.preset.settings.selection, selection); assert.equal(body.preset.schemaVersion, 3);
		const receipt = await owner.applyPreset(await source(f, 1), body.preset.identity.id, body.revision, 'Apply repairs'); assert.ok(receipt);
		assert.equal(receipt.outcomes[0]?.status, 'applied'); const after = await f.read(1); assert.equal(after.develop.processVersion, 3);
		assert.deepEqual(after.develop, { ...target, repairs: original.repairs }); assert.equal(after.revision, before[1]!.photo.revision + 1);
		const rows = await f.inspect(); await owner.applyPreset(await source(f, 1), body.preset.identity.id, body.revision, 'Same repairs');
		assert.equal(owner.snapshot().batch?.outcomes[0]?.status, 'unchanged'); assert.deepEqual(await f.inspect(), rows);
		const deleted = await owner.deletePreset(body.catalogId, body.preset.identity.id, body.revision); assert.ok(deleted);
		assert.equal(deleted.snapshot.schemaVersion, 3); assert.deepEqual(deleted.snapshot.presets, []); assert.equal((await list(owner, f)).schemaVersion, 3);
		await custody(f, before);
	} finally { await owner.close(); await f.close(); }
});

test('Current stored brush presets apply by native row binding without clipboard issuance and authenticate unused declarations', async () => {
	const f = await repairSettingsFixture(), owner = workflow(f);
	try {
		const installed = await f.installBrush(), dirty = brushSettingsRecipe(installed.reference); await list(owner, f);
		const before = await f.inspect(), ack = await owner.savePreset(await source(f, 0, dirty), FULL_SETTINGS_SELECTION, 'Unused brush repairs'); assert.ok(ack);
		const body = await savedBody(owner, f); assert.equal(body.preset.settings.develop.masks[0]?.inputs[0]?.sourceRef, installed.reference.storageKey);
		assert.equal(owner.snapshot().clipboard, null); const cap = f.session.develop.presetsCurrent; assert.ok(cap);
		assert.throws(() => cap.serialize(body.preset), /brush|external|mask|resource/iu, 'Stored metadata is not an external body transport.');
		const receipt = await owner.applyPreset(await source(f, 1), body.preset.identity.id, body.revision, 'Native brush preset'); assert.ok(receipt);
		assert.equal(receipt.outcomes[0]?.status, 'applied'); assert.deepEqual((await f.read(1)).develop, dirty);
		assert.equal(owner.snapshot().clipboard, null, 'Native preset application never issues or clones a clipboard grant.');
		assert.ok(f.borrowed.length > 0); assert.ok(f.borrowed.every(bytes => bytes.every(value => value === 0))); await custody(f, before);
		await f.corruptBrush(installed.reference); const unchanged = await f.inspect(), saves = f.saved.length;
		await owner.applyPreset(await source(f), body.preset.identity.id, body.revision, 'Corrupt unused brush');
		assert.equal(f.saved.length, saves); assert.deepEqual(await f.inspect(), unchanged);
	} finally { await owner.close(); await f.close(); }
});

test('Current stale or missing native preset bindings refuse before any target Photo save', async () => {
	const f = await repairSettingsFixture(), owner = workflow(f), other = workflow(f);
	try {
		await list(owner, f); assert.ok(await owner.savePreset(await source(f), FULL_SETTINGS_SELECTION, 'First'));
		const body = await savedBody(owner, f); await list(other, f);
		assert.ok(await other.renamePreset(body.catalogId, body.preset.identity.id, body.revision, 'Native successor'));
		const before = await f.inspect(); await owner.applyPreset(await source(f, 1), body.preset.identity.id, body.revision, 'Stale native binding');
		assert.equal(f.saved.length, 0); assert.deepEqual(await f.inspect(), before);
		const current = await list(owner, f); await owner.applyPreset(await source(f, 1), 'missing', current.revision, 'Missing binding');
		assert.equal(f.saved.length, 0); assert.deepEqual(await f.inspect(), before);
		await assert.rejects(f.session.legacyDevelop!.read({ schemaVersion: 2, photoId: f.photos[0]!.id }));
	} finally { await owner.close(); await other.close(); await f.close(); }
});

test('Current dirty brush preset Save Close joins the actual authentication body and publishes no retired receipt', async () => {
	const f = await repairSettingsFixture(), owner = workflow(f), entered = deferred<void>(), release = deferred<void>();
	const joining: { work?: ReturnType<typeof owner.savePreset>; closing?: Promise<void> } = {}, observed: { bytes?: Uint8Array } = {};
	try {
		const installed = await f.installBrush(); await list(owner, f); const before = await f.inspect();
		f.hooks.borrowedBrush = async (_reference, bytes) => { observed.bytes = bytes; entered.resolve(); await release.promise; };
		joining.work = owner.savePreset(await source(f, 0, brushSettingsRecipe(installed.reference)), FULL_SETTINGS_SELECTION, 'Held brush');
		assert.equal(await Promise.race([entered.promise.then(() => true), joining.work.then(() => false)]), true);
		assert.ok(observed.bytes?.some(value => value !== 0)); joining.closing = owner.close(); assert.equal(owner.close(), joining.closing);
		assert.equal(await remainsPending(joining.closing), true); assert.equal(owner.snapshot().presetReceipt, null);
		release.resolve(); await joining.work; await joining.closing; assert.ok(observed.bytes?.every(value => value === 0));
		const reopened = workflow(f); try { assert.deepEqual((await list(reopened, f)).presets, []); } finally { await reopened.close(); }
		assert.deepEqual(await f.inspect(), before);
	} finally { release.resolve(); await joining.work; await joining.closing; await owner.close(); await f.close(); }
});

test('Current preset Apply retains a genuine late native Photo ACK through menu Close without retired publication', async () => {
	const f = await repairSettingsFixture(), owner = workflow(f), entered = deferred<void>(), release = deferred<void>();
	const joining: { work?: ReturnType<typeof owner.applyPreset>; closing?: Promise<void> } = {};
	try {
		await list(owner, f); assert.ok(await owner.savePreset(await source(f), FULL_SETTINGS_SELECTION, 'Repairs'));
		const body = await savedBody(owner, f), before = await f.inspect();
		f.hooks.afterSave = async photo => { if (photo.id === f.photos[1]!.id) { entered.resolve(); await release.promise; } };
		joining.work = owner.applyPreset(await source(f, 1), body.preset.identity.id, body.revision, 'Native ACK');
		assert.equal(await Promise.race([entered.promise.then(() => true), joining.work.then(() => false)]), true);
		assert.equal(f.saved.length, 1); joining.closing = owner.close(); assert.equal(await remainsPending(joining.closing), true);
		release.resolve(); const receipt = await joining.work; await joining.closing; assert.ok(receipt); assert.equal(receipt.outcomes[0]?.status, 'applied');
		assert.equal(owner.snapshot().batch, null); assert.deepEqual((await f.read(1)).develop, (await f.read()).develop); await custody(f, before);
	} finally { release.resolve(); await joining.work; await joining.closing; await owner.close(); await f.close(); }
});
