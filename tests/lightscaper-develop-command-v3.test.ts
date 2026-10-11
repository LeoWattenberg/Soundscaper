/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { capturePhotoDevelopExecutionContextCurrentV1, capturePhotoLibraryDevelopPortV3,
	detachPhotoLibraryDevelopCommandV3, detachPhotoLibraryDevelopSettingsV3 } from '../src/common/editor/controller/shared/photo-library-develop-command-v3.ts';
import { detachPhotoLibraryDevelopCommandV2, detachPhotoLibraryDevelopSettingsV2 } from '../src/common/editor/controller/shared/photo-library-develop-command-v2.ts';
import type { PhotoDevelopExecutionContextCurrentV1 } from '../src/common/editor/controller/shared/photo-library-develop-workflow-current-v1.ts';
import type { PhotoLibraryDevelopPortV3, PhotoLibraryDevelopSnapshotV3 } from '../src/common/editor/photo-library-develop-port-v3.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { replaceImageDevelopRepairSpotsV1 } from '../src/common/editor/imaging/image-develop-repair-commands-v1.ts';
import { gradientGraph, profile } from './helpers/lightscaper-masked-frame-fixture.ts';

const TIME = '2026-10-11T00:00:00.000Z';
function recipe() {
	return replaceImageDevelopRepairSpotsV1({ ...defaultImageDevelopStateV2(), effects: [profile(false)], masks: [
		{ ...gradientGraph(), schemaVersion: 2, name: 'Sky 🌤' },
		{ schemaVersion: 1, id: 'brush', kind: 'matte', inputs: [{ name: 'paint', kind: 'alpha', sourceRef: `brush-mask-v1:1:1:${'a'.repeat(64)}` }],
			nodes: [{ id: 'alpha', kind: 'alpha', inputName: 'paint' }], outputNodeId: 'alpha' },
	], maskBindings: [{ effectId: 'profile', maskId: 'mask' }] }, { schemaVersion: 1, spots: [
		{ id: 'clone', mode: 'clone', enabled: true, target: { x: 0.5, y: 0.5 }, source: { x: 0.25, y: 0.5 }, radius: 0.1, feather: 0.5, opacity: 1 },
		{ id: 'heal', mode: 'heal', enabled: false, target: { x: 0.7, y: 0.4 }, source: { x: 0.2, y: 0.3 }, radius: 0.2, feather: 0, opacity: 0.5 },
	] });
}
const command = () => ({ type: 'record-develop' as const, versionId: 'version-1', develop: recipe(), label: 'Repair', createdAt: TIME });
function snapshot(): PhotoLibraryDevelopSnapshotV3 {
	return { schemaVersion: 3, catalogId: 'catalog-1', photoId: 'photo-1', revision: 7, activeVersionId: 'version-1', versionId: 'version-1',
		versions: [{ id: 'version-1', name: 'Master', kind: 'master' }], develop: recipe(), history: { cursor: 0, entries: [] }, snapshots: [] };
}

test('Current command detaches and freezes complete named, brush, LUT and ordered repair metadata without resource access', () => {
	const mutable = structuredClone(command()), retained = detachPhotoLibraryDevelopCommandV3(mutable);
	assert.deepEqual(retained, command()); assert.equal(retained.type, 'record-develop');
	assert.ok(Object.isFrozen(retained));
	if (retained.type !== 'record-develop' || retained.develop.processVersion !== 3) assert.fail('The complete repair command was downgraded.');
	assert.ok(Object.isFrozen(retained.develop.repairs.spots[0]!.source)); assert.ok(Object.isFrozen(retained.develop.masks[1]!.inputs));
	mutable.label = 'Changed'; Reflect.set(mutable.develop.repairs.spots[0]!.source, 'x', 1); Reflect.set(mutable.develop.masks, 'length', 0);
	assert.deepEqual(retained, command()); assert.deepEqual(detachPhotoLibraryDevelopSettingsV3(recipe()), recipe());
});

test('Current command opts into three while legacy V2 settings and commands keep their permanent strict policy', () => {
	assert.throws(() => detachPhotoLibraryDevelopCommandV2(command())); assert.throws(() => detachPhotoLibraryDevelopSettingsV2(recipe()));
	const old = { ...command(), develop: defaultImageDevelopStateV2() };
	assert.deepEqual(detachPhotoLibraryDevelopCommandV3(old), detachPhotoLibraryDevelopCommandV2(old));
	const selected = { type: 'select-develop-history', versionId: 'version-1', cursor: 0 };
	assert.deepEqual(detachPhotoLibraryDevelopCommandV3(selected), detachPhotoLibraryDevelopCommandV2(selected));
	assert.throws(() => detachPhotoLibraryDevelopCommandV3({ ...command(), type: 'future-command' }));
});

test('Current intent rejects accessor, inherited, symbol and capability packets without invoking user hooks', () => {
	let reads = 0;
	for (const value of [Object.defineProperty(command(), 'develop', { enumerable: true, get() { reads++; return recipe(); } }),
		Object.assign(Object.create(command()) as object, {}), { ...command(), [Symbol('body')]: 1 },
		{ ...command(), body: new Uint8Array(1) }, { ...command(), label: { toString() { reads++; return 'Repair'; } } }]) {
		assert.throws(() => detachPhotoLibraryDevelopCommandV3(value));
	}
	const bad = structuredClone(recipe()); Object.defineProperty(bad.repairs.spots[0], 'radius', { enumerable: true, get() { reads++; return 0.1; } });
	assert.throws(() => detachPhotoLibraryDevelopSettingsV3(bad)); assert.equal(reads, 0);
});

test('Current scalar transport enforces the two-MiB recipe and bounded command byte ledgers', () => {
	assert.throws(() => detachPhotoLibraryDevelopCommandV3({ ...command(), label: 'x'.repeat(2_097_152 + 8192) }), /budget|byte|scalar/iu);
	const tooMany = { ...recipe(), repairs: { schemaVersion: 1, spots: Array.from({ length: 65 }, (_, index) => ({ ...recipe().repairs.spots[0]!, id: `spot-${index}` })) } };
	assert.throws(() => detachPhotoLibraryDevelopSettingsV3(tooMany));
	assert.throws(() => detachPhotoLibraryDevelopSettingsV3({ ...recipe(), processVersion: 4 }));
});

test('Current port captures actual methods and receivers, including Original, before replacement without callable metadata reads', async () => {
	let metadata = 0, originals = 0, reads = 0;
	const original = { async withFrame<Result>(): Promise<Result> { originals++; throw new Error('Pinned Original'); } };
	const port: PhotoLibraryDevelopPortV3 = { schemaVersion: 3, original,
		async read() { assert.equal(this, port); reads++; return snapshot(); },
		async apply() { assert.equal(this, port); return { schemaVersion: 3, snapshot: snapshot(), notices: [] }; },
	};
	Reflect.set(port, 'read', new Proxy(port.read, { get() { metadata++; throw new Error('Callable metadata reflected.'); } }));
	const captured = capturePhotoLibraryDevelopPortV3(port); assert.ok(Object.isFrozen(captured));
	Reflect.set(port, 'read', () => assert.fail('Replacement read')); Reflect.set(port, 'apply', () => assert.fail('Replacement apply'));
	Reflect.set(original, 'withFrame', () => assert.fail('Replacement Original'));
	assert.equal((await captured.read({ schemaVersion: 3, photoId: 'photo-1' })).schemaVersion, 3);
	assert.equal((await captured.apply({ schemaVersion: 3, photoId: 'photo-1', expectedRevision: 7, command: command() })).schemaVersion, 3);
	assert.ok(captured.original); await assert.rejects(captured.original.withFrame({ schemaVersion: 1, photoId: 'photo-1', expectedRevision: 7 }, () => undefined), /Pinned Original/u);
	assert.equal(reads, 1); assert.equal(originals, 1); assert.equal(metadata, 0);
	assert.throws(() => capturePhotoLibraryDevelopPortV3({ ...port, schemaVersion: 2 } as unknown as PhotoLibraryDevelopPortV3));
});

test('Current execution context pins its real receiver and native pre-abort wins before hostile capability inspection', async () => {
	const stop = new AbortController(); let reads = 0;
	const context: PhotoDevelopExecutionContextCurrentV1 = { signal: stop.signal,
		async acquire() { assert.equal(this, context); reads++; return { schemaVersion: 3, async read() { return snapshot(); }, async apply() { return { schemaVersion: 3, snapshot: snapshot(), notices: [] }; } }; },
		isCurrent() { assert.equal(this, context); return true; }, async refresh() { assert.equal(this, context); return 'refreshed'; },
	};
	const captured = capturePhotoDevelopExecutionContextCurrentV1(context, stop.signal);
	Reflect.set(context, 'acquire', () => assert.fail('Replacement acquire')); Reflect.set(context, 'isCurrent', () => false);
	assert.equal((await captured.acquire()).schemaVersion, 3); assert.equal(captured.isCurrent(), true); assert.equal(await captured.refresh(), 'refreshed'); assert.equal(reads, 1);
	const reason = Proxy.revocable({}, {}); reason.revoke(); stop.abort(reason.proxy); let traps = 0;
	const hostile = new Proxy({}, { get() { traps++; throw Error('Hostile context'); }, ownKeys() { traps++; throw Error('Hostile context'); } });
	let failure: unknown; try { capturePhotoDevelopExecutionContextCurrentV1(hostile as PhotoDevelopExecutionContextCurrentV1, stop.signal); } catch (error) { failure = error; }
	assert.equal(failure, reason.proxy); assert.equal(traps, 0);
});
