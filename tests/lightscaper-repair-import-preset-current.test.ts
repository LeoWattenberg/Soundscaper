/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { borrowPhotoImportDevelopPresetV2 } from '../src/lightscaper/import/photo-import-develop-preset-v2.ts';
import { borrowPhotoImportDevelopPresetCurrentV1 } from '../src/lightscaper/import/photo-import-develop-preset-current-v1.ts';
import { applyPhotoDevelopPresetCurrentV1 } from '../src/lightscaper/storage/photo-develop-presets-current-v1.ts';
import { normalizePhotoDocumentV1 } from '../src/lightscaper/catalog/photo-document.ts';
import { normalizePhotoDocumentCurrentV1 } from '../src/lightscaper/catalog/photo-document-current-v1.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { brushSettingsRecipe } from './helpers/lightscaper-repair-settings-current-fixture.ts';
import { repairPresetsFixture, currentPreset } from './helpers/lightscaper-repair-presets-current-fixture.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

type Fixture = Awaited<ReturnType<typeof repairPresetsFixture>>;
function unpublished(f: Fixture) {
	const seed = photoArchiveFixture(3, f.bytes).photo;
	return normalizePhotoDocumentV1({ ...seed, catalogId: f.root.id, original: { ...seed.original, width: 3, height: 1, hasAlpha: false } });
}
async function save(f: Fixture, preset = currentPreset(f.packet())) {
	return applyPhotoDevelopPresetCurrentV1(f.settings, f.root, { type: 'save', expectedRevision: 0, preset }, { resources: f.resources });
}
function capture(f: Fixture, revision = 1, presetId = 'repair-preset', signal = new AbortController().signal) {
	return borrowPhotoImportDevelopPresetCurrentV1(f.settings, { schemaVersion: 3, catalogId: f.root.id, presetId, expectedRevision: revision }, f.resources)(f.root.id, signal);
}

test('selected native Preset3 imports ordered repairs into an unpublished legacy photo with exact Original custody', async () => {
	const f = await repairPresetsFixture();
	try {
		const preset = currentPreset(f.packet()), saved = await applyPhotoDevelopPresetCurrentV1(f.settings, f.root,
			{ type: 'save', expectedRevision: 0, preset }, { resources: f.resources });
		assert.equal(saved.revision, 1); assert.equal(saved.schemaVersion, 3);
		const seed = photoArchiveFixture(3, f.bytes).photo;
		const original = normalizePhotoDocumentV1({ ...seed, catalogId: f.root.id,
			original: { ...seed.original, width: 3, height: 1, hasAlpha: false } });
		// Root recorded the actual legacy row refusal before this named Current
		// subject replaced it. The retained row and resources remain native.
		const captured = borrowPhotoImportDevelopPresetCurrentV1(f.settings, { schemaVersion: 3, catalogId: f.root.id,
			presetId: preset.identity.id, expectedRevision: saved.revision }, f.resources);
		const apply = await captured(f.root.id, new AbortController().signal), photo = await apply(original);
		assert.equal(photo.schemaVersion, 3); assert.equal(photo.revision, 0);
		assert.deepEqual(photo.original, original.original); assert.deepEqual(photo.extractedMetadata, original.extractedMetadata);
		const version = photo.versions.find(value => value.id === photo.activeVersionId);
		assert.ok(version); assert.equal(version.develop.processVersion, 3);
		if (version.develop.processVersion !== 3) throw new Error('Native selected repairs must remain explicit.');
		const expected = f.source().develop;
		assert.equal(expected.processVersion, 3);
		assert.deepEqual(version.develop.repairs, expected.processVersion === 3 ? expected.repairs : undefined);
		assert.equal(version.workspace?.schemaVersion, 3); assert.equal(version.workspace?.entries.length, 2);
		assert.equal(version.workspace?.entries[0]?.develop.processVersion, 1);
		assert.equal(version.workspace?.entries[1]?.develop.processVersion, 3);
		assert.deepEqual(await f.row(), { schemaVersion: 3, kind: 'photo-develop-presets', catalogId: f.root.id,
			revision: saved.revision, presets: [preset] });
	} finally { await f.close(); }
});

test('a Current preset excluding repairs retains honest Photo1 and Photo2 recipes without promoting them', async () => {
	const f = await repairPresetsFixture();
	try {
		const preset = currentPreset(f.packet(f.source().develop, { effectTypes: [], geometry: false, localAdjustments: false, repairs: false }));
		await save(f, preset); const apply = await capture(f), legacy = unpublished(f);
		const first = await apply(legacy); assert.equal(first.schemaVersion, 1); assert.equal(first.versions[0]!.develop.processVersion, 1);
		assert.deepEqual(first.original, legacy.original);
		const second = normalizePhotoDocumentCurrentV1({ ...legacy, schemaVersion: 2,
			versions: legacy.versions.map(version => ({ ...version, develop: defaultImageDevelopStateV2() })) });
		const retained = await apply(second); assert.equal(retained.schemaVersion, 2); assert.equal(retained.versions[0]!.develop.processVersion, 2);
		assert.deepEqual(retained.original, second.original);
	} finally { await f.close(); }
});

test('a genuine retained Photo3 with a selected legacy process remains Photo3 during import preset application', async () => {
	const f = await repairPresetsFixture();
	try {
		await save(f, currentPreset(f.packet(f.source().develop, { effectTypes: [], geometry: false, localAdjustments: false, repairs: false })));
		const seed = unpublished(f), photo = normalizePhotoDocumentCurrentV1({ ...seed, schemaVersion: 3,
			versions: seed.versions.map(version => ({ ...version, develop: defaultImageDevelopStateV2() })) });
		const result = await (await capture(f))(photo);
		assert.equal(result.schemaVersion, 3); assert.equal(result.versions[0]!.develop.processVersion, 2);
		assert.equal(result.versions[0]!.workspace?.schemaVersion, 2); assert.deepEqual(result.original, photo.original);
	} finally { await f.close(); }
});

test('Current import authenticates unused brush declarations in another retained preset before donating clean repairs', async () => {
	const f = await repairPresetsFixture();
	try {
		const body = await f.installBrush(), clean = currentPreset(f.packet()), other = currentPreset(await f.selectedPacket(brushSettingsRecipe(body.reference)), 'other');
		await f.writeRow({ schemaVersion: 3, kind: 'photo-develop-presets', catalogId: f.root.id, revision: 1, presets: [clean, other] });
		await f.corruptBrush(body.reference); const before = await f.inspect(), row = await f.row(); f.borrowed.splice(0);
		await assert.rejects(capture(f)); assert.deepEqual(await f.inspect(), before); assert.deepEqual(await f.row(), row);
		assert.equal(f.writes.length, 0); assert.ok(f.borrowed.every(bytes => bytes.every(byte => byte === 0)));
	} finally { await f.close(); }
});

test('Current import rechecks the complete native preset row before every unpublished target, including same revision drift', async () => {
	const f = await repairPresetsFixture();
	try {
		const preset = currentPreset(f.packet()); await save(f, preset); const apply = await capture(f), photo = unpublished(f), first = await apply(photo);
		assert.equal(first.schemaVersion, 3);
		await f.writeRow({ schemaVersion: 3, kind: 'photo-develop-presets', catalogId: f.root.id, revision: 1,
			presets: [currentPreset(f.packet(), preset.identity.id, 'Changed retained name')] });
		await assert.rejects(apply(photo), /changed|conflict|revision/i);
		assert.deepEqual(photo, unpublished(f)); assert.deepEqual(first.original, photo.original);
	} finally { await f.close(); }
});

test('Current import pins native settings and factory receivers plus scalar choice before the first acquisition wait', async () => {
	const f = await repairPresetsFixture(), entered = deferred<void>(), release = deferred<void>();
	const joining: { work?: ReturnType<ReturnType<typeof borrowPhotoImportDevelopPresetCurrentV1>> } = {};
	try {
		const body = await f.installBrush(), preset = currentPreset(await f.selectedPacket(brushSettingsRecipe(body.reference))); await save(f, preset);
		let first = true, reads = 0, bodies = 0;
		const settings = { readEntry: async function (key: string) {
			assert.equal(this, settings); reads++; const row = await f.settings.readEntry!(key);
			if (first) { first = false; entered.resolve(); await release.promise; } return row;
		} };
		const resources = { cubeLutResources() { assert.equal(this, resources); return f.resources.cubeLutResources(); },
			maskRasterResources() { assert.equal(this, resources); bodies++; return f.resources.maskRasterResources(); } };
		const choice = { schemaVersion: 3 as const, catalogId: f.root.id, presetId: preset.identity.id, expectedRevision: 1 };
		const borrowed = borrowPhotoImportDevelopPresetCurrentV1(settings, choice, resources);
		joining.work = borrowed(f.root.id, new AbortController().signal); void joining.work.catch(() => undefined);
		assert.equal(await Promise.race([entered.promise.then(() => true), joining.work.then(() => false, () => false)]), true);
		choice.presetId = 'late'; choice.expectedRevision = 99;
		settings.readEntry = async () => { throw new Error('Replaced settings reader'); };
		resources.maskRasterResources = () => { throw new Error('Replaced resource factory'); }; release.resolve();
		const result = await (await joining.work)(unpublished(f)); assert.equal(result.schemaVersion, 3);
		assert.ok(reads >= 3); assert.equal(bodies, 1); assert.ok(f.borrowed.every(bytes => bytes.every(byte => byte === 0)));
	} finally { release.resolve(); await joining.work?.catch(() => undefined); await f.close(); }
});

test('Current import joins held native brush authentication and preserves an opaque cancellation reason exactly', async () => {
	const f = await repairPresetsFixture(), entered = deferred<void>(), release = deferred<void>(), stop = new AbortController();
	const opaque = Proxy.revocable({}, {}); opaque.revoke();
	const joining: { work?: ReturnType<ReturnType<typeof borrowPhotoImportDevelopPresetCurrentV1>> } = {};
	try {
		const body = await f.installBrush(); await save(f, currentPreset(await f.selectedPacket(brushSettingsRecipe(body.reference))));
		f.borrowed.splice(0); f.hooks.borrowedBrush = async () => { entered.resolve(); await release.promise; };
		joining.work = capture(f, 1, 'repair-preset', stop.signal);
		const observed = joining.work.then(() => ({ fulfilled: true, error: undefined }), (error: unknown) => ({ fulfilled: false, error }));
		assert.equal(await Promise.race([entered.promise.then(() => true), joining.work.then(() => false, () => false)]), true);
		stop.abort(opaque.proxy); assert.equal(await remainsPending(joining.work), true);
		assert.ok(f.borrowed[0]!.some(byte => byte !== 0)); release.resolve();
		const outcome = await observed; assert.equal(outcome.fulfilled, false); assert.ok(Object.is(outcome.error, opaque.proxy));
		assert.ok(f.borrowed.every(bytes => bytes.every(byte => byte === 0)));
	} finally { release.resolve(); await joining.work?.catch(() => undefined); await f.close(); }
});

test('Current import refuses foreign or already published photos without mutating the admitted target', async () => {
	const f = await repairPresetsFixture();
	try {
		await save(f); const apply = await capture(f), photo = unpublished(f);
		await assert.rejects(apply({ ...photo, catalogId: 'other' }), /unpublished/);
		await assert.rejects(apply({ ...photo, revision: 1 }), /unpublished/);
		assert.deepEqual(photo, unpublished(f));
	} finally { await f.close(); }
});

test('permanent V2 import reader still refuses a real native retained Preset3 row', async () => {
	const f = await repairPresetsFixture();
	try {
		await save(f); const captured = borrowPhotoImportDevelopPresetV2(f.settings,
			{ schemaVersion: 2, catalogId: f.root.id, presetId: 'repair-preset', expectedRevision: 1 });
		await assert.rejects(captured(f.root.id, new AbortController().signal), /row version/);
	} finally { await f.close(); }
});
