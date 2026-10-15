/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createPhotoLibrarySessionCurrentV1 } from '../src/lightscaper/photo-library-session-runtime-current-v1.ts';
import { normalizeImageDevelopStateCurrentV1 } from '../src/common/editor/imaging/image-develop-state-current-v1.ts';
import type { ImageDevelopSettingsPacketV4 } from '../src/common/editor/imaging/image-develop-settings-contract-v4.ts';
import { repairRecipe } from './helpers/lightscaper-repair-raster-export-current-fixture.ts';
import { repairSettingsFixture, brushSettingsRecipe, CURRENT_SETTINGS_SELECTION, SETTINGS_TIME } from './helpers/lightscaper-repair-settings-current-fixture.ts';

interface Preset {
	readonly schemaVersion: number;
	readonly identity: Readonly<{ id: string; name: string; authoredStateSha256: string }>;
	readonly settings: ImageDevelopSettingsPacketV4;
}
interface Snapshot { readonly schemaVersion: number; readonly catalogId: string; readonly revision: number; readonly presets: readonly unknown[] }
interface NativePresets {
	create(request: unknown): Preset;
	list(request: unknown): Promise<Snapshot>;
	read(request: unknown): Promise<Readonly<{ schemaVersion: number; revision: number; preset: Preset }>>;
	write(request: unknown): Promise<Readonly<{ schemaVersion: number; snapshot: Snapshot; notices: readonly string[] }>>;
}
function presets(develop: object): NativePresets {
	const descriptor = Object.getOwnPropertyDescriptor(develop, 'presetsCurrent');
	assert.ok(descriptor && Object.hasOwn(descriptor, 'value') && descriptor.value, 'actual selected Develop3 must expose its native presetsCurrent child');
	const child = descriptor.value as NativePresets;
	for (const key of ['create', 'list', 'read', 'write'] as const) assert.equal(typeof child[key], 'function');
	return child;
}

// These cases reach the actual selected Session at baseline, without importing
// a future implementation or constructing a replacement preset port.
test('selected Current runtime exposes native Presets3 while keeping its genuine legacy child separate', async () => {
	const f = await repairSettingsFixture();
	try {
		const child = presets(f.session.develop), catalogId = f.photos[0]!.catalogId;
		const value = await child.list({ schemaVersion: 3, catalogId });
		assert.deepEqual(value, { schemaVersion: 3, catalogId, revision: 0, presets: [] });
		assert.equal(Object.isFrozen(child), true); assert.equal(Object.isFrozen(value), true);
		const legacy = f.session.legacyDevelop?.presets; assert.ok(legacy);
		assert.deepEqual(await legacy.list({ schemaVersion: 2, catalogId }), { schemaVersion: 2, catalogId, revision: 0, presets: [] });
	} finally { await f.close(); }
});

test('native repaired brush preset reopens and applies by row binding while cloned clipboard authority stays refused', async () => {
	const f = await repairSettingsFixture(); let reopened: Awaited<ReturnType<typeof createPhotoLibrarySessionCurrentV1>> | undefined;
	try {
		const child = presets(f.session.develop), catalogId = f.photos[0]!.catalogId, installed = await f.installBrush();
		const draft = normalizeImageDevelopStateCurrentV1({ ...brushSettingsRecipe(installed.reference), processVersion: 3, repairs: repairRecipe().repairs });
		const before = await f.inspect(), settings = f.session.develop.settingsCurrent; assert.ok(settings);
		const packet = await settings.copySelected({ ...f.source(0, draft), selection: CURRENT_SETTINGS_SELECTION });
		const preset = child.create({ schemaVersion: 3, id: 'native-repaired-brush', name: 'Repaired brush', settings: packet });
		assert.equal(preset.schemaVersion, 4); assert.deepEqual(preset.settings.develop, draft);
		const ack = await child.write({ schemaVersion: 3, catalogId, command: { type: 'save', expectedRevision: 0, preset } });
		assert.equal(ack.schemaVersion, 3); assert.equal(ack.snapshot.revision, 1); assert.deepEqual(ack.notices, []);
		assert.deepEqual(await f.inspect(), before); assert.equal(f.saved.length, 0);
		const legacy = f.session.legacyDevelop?.presets; assert.ok(legacy); await assert.rejects(legacy.list({ schemaVersion: 2, catalogId }));
		reopened = await createPhotoLibrarySessionCurrentV1(f.options);
		const current = presets(reopened.develop), saved = await current.read({ schemaVersion: 3, catalogId, presetId: preset.identity.id, expectedRevision: 1 });
		assert.deepEqual(saved.preset, preset); assert.equal(saved.revision, 1);
		const selected = reopened.develop.settingsCurrent; assert.ok(selected);
		const target = before[1]!.photo, request = { schemaVersion: 3 as const, catalogId, targets: [{ photoId: target.id, versionId: target.activeVersionId, expectedRevision: target.revision }],
			label: 'Native repaired preset', createdAt: SETTINGS_TIME };
		const raw: unknown = JSON.parse(JSON.stringify(saved.preset.settings));
		await assert.rejects(selected.applyBatch({ ...request, action: { kind: 'paste', settings: raw as ImageDevelopSettingsPacketV4 } }));
		const receipt = await selected.applyBatch({ ...request, action: { kind: 'preset', presetId: preset.identity.id, expectedPresetRevision: saved.revision } });
		assert.equal(receipt.outcomes[0]!.status, 'applied');
		const after = await f.inspect(); assert.deepEqual(after[1]!.photo.versions[0]!.develop, draft); assert.deepEqual(after[0], before[0]);
		assert.deepEqual(after.map(row => row.bytes), before.map(row => row.bytes));
		assert.ok(f.borrowed.length >= 2); assert.ok(f.borrowed.every(bytes => bytes.every(byte => byte === 0)));
	} finally { await reopened?.close(); await f.close(); }
});
