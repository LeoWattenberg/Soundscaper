/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { PhotoLibraryDevelopWorkflowCurrentV1 } from '../src/common/editor/controller/shared/photo-library-develop-workflow-current-v1.ts';
import { detachPhotoLibraryDevelopCommandV3 } from '../src/common/editor/controller/shared/photo-library-develop-command-v3.ts';
import { detachPhotoLibraryDevelopCommandCurrentV1, capturePhotoLibraryDevelopPortCurrentV1,
	capturePhotoDevelopExecutionContextCurrentV1 } from '../src/common/editor/controller/shared/photo-library-develop-command-current-v1.ts';
import type { PhotoLibraryDevelopSnapshotV3 } from '../src/common/editor/photo-library-develop-port-v3.ts';
import type { PhotoLibraryDevelopPortCurrentV1 } from '../src/common/editor/photo-library-develop-port-current-v1.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { normalizeImageDevelopStateV4 } from '../src/common/editor/imaging/image-develop-state-v4.ts';
import { createVideoEffectV2 } from '../src/common/editor/video-effects-v2.ts';
import { gradientGraph } from './helpers/lightscaper-masked-frame-fixture.ts';

const TIME = '2026-10-20T00:00:00.000Z';
function recipe() {
	return normalizeImageDevelopStateV4({ ...defaultImageDevelopStateV2(), processVersion: 4,
		rawDevelopment: { schemaVersion: 1, mode: 'recovery' },
		effects: [createVideoEffectV2('tone-ladder-v1', { id: 'tone', params: { exposure: 0.5 } })],
		masks: [{ ...gradientGraph(), schemaVersion: 2, name: 'Retained sky' }], maskBindings: [{ effectId: 'tone', maskId: 'mask' }],
		repairs: { schemaVersion: 1, spots: [{ id: 'clone', mode: 'clone', enabled: false, target: { x: 0.5, y: 0.5 },
			source: { x: 0.25, y: 0.5 }, radius: 0.1, feather: 0.5, opacity: 1 }] } });
}
function initial(): PhotoLibraryDevelopSnapshotV3 {
	return { schemaVersion: 3, catalogId: 'catalog-1', photoId: 'photo-1', revision: 0, activeVersionId: 'version-1', versionId: 'version-1',
		versions: [{ id: 'version-1', name: 'Master', kind: 'master' }], develop: defaultImageDevelopStateV2(),
		history: { cursor: 0, entries: [{ index: 0, label: 'Initial', createdAt: TIME }] }, snapshots: [] };
}

// The transport is deliberately scalar-only. Native publication and derived
// pixel authority are separate owning tests; this exercises the real Current
// workflow that previously rejected every valid process4 local edit.
test('Current workflow admits complete RAW process4 edits and preserves source processing through effects and gestures', async () => {
	const port = { schemaVersion: 3 as const, read: async () => initial(), apply: async () => assert.fail('Local edits must not publish.') };
	const owner = new PhotoLibraryDevelopWorkflowCurrentV1({ execute: async action => action({ signal: new AbortController().signal,
		acquire: async () => port, isCurrent: () => true, refresh: async () => undefined }) });
	try {
		await owner.open('photo-1'); assert.equal(owner.snapshot().draft?.processVersion, 2);
		Reflect.apply(owner.edit, owner, [recipe()]); assert.deepEqual(owner.snapshot().draft, recipe());
		owner.setEffects([createVideoEffectV2('white-balance-v1', { id: 'white' }), ...recipe().effects]);
		const before = owner.snapshot().draft; assert.ok(before);
		owner.beginGesture(); owner.previewEffect('tone', { exposure: 2 }); owner.cancelGesture(); assert.deepEqual(owner.snapshot().draft, before);
		owner.beginGesture(); owner.previewEffect('tone', { exposure: 1 }); owner.commitGesture();
		const draft = owner.snapshot().draft; assert.ok(draft);
		assert.equal(draft.processVersion, 4); assert.deepEqual(Object.getOwnPropertyDescriptor(draft, 'rawDevelopment')?.value, recipe().rawDevelopment);
		assert.deepEqual(Object.getOwnPropertyDescriptor(draft, 'repairs')?.value, recipe().repairs);
		assert.deepEqual(draft.masks, recipe().masks); assert.deepEqual(draft.maskBindings, recipe().maskBindings); assert.equal(owner.snapshot().dirty, true);
	} finally { await owner.close(); }
});

test('Permanent V3 command admission remains closed to the RAW process4 successor', () => {
	assert.throws(() => detachPhotoLibraryDevelopCommandV3({ type: 'record-develop', versionId: 'version-1', develop: recipe(), label: 'Recovery', createdAt: TIME }));
});

test('Current command detaches the complete RAW recipe before retained callers can change profile, repair or graph metadata', () => {
	const mutable = structuredClone({ type: 'record-develop', versionId: 'version-1', develop: recipe(), label: 'Recovery', createdAt: TIME });
	const captured = detachPhotoLibraryDevelopCommandCurrentV1(mutable); assert.equal(captured.type, 'record-develop');
	if (captured.type !== 'record-develop' || captured.develop.processVersion !== 4) assert.fail('RAW source processing was lost.');
	Reflect.set(mutable.develop.rawDevelopment, 'mode', 'canonical'); Reflect.set(mutable.develop.repairs.spots[0]!.source, 'x', 1);
	Reflect.set(mutable.develop.masks, 'length', 0);
	assert.deepEqual(captured.develop, recipe()); assert.ok(Object.isFrozen(captured.develop.rawDevelopment));
	assert.ok(Object.isFrozen(captured.develop.repairs.spots[0]!.source));
	let reads = 0;
	const getter = Object.defineProperty(structuredClone(recipe()), 'rawDevelopment', { enumerable: true, get() { reads++; return recipe().rawDevelopment; } });
	assert.throws(() => detachPhotoLibraryDevelopCommandCurrentV1({ ...mutable, develop: getter })); assert.equal(reads, 0);
});

test('Current capture pins canonical and derived Original methods and exact receivers independently', async () => {
	let canonical = 0, derived = 0, metadata = 0;
	const original = { async withFrame<Result>(): Promise<Result> { assert.equal(this, original); canonical++; throw new Error('Pinned canonical'); },
		async withDerivedFrame<Result>(): Promise<Result> { assert.equal(this, original); derived++; throw new Error('Pinned derived'); } };
	const port: PhotoLibraryDevelopPortCurrentV1 = { schemaVersion: 3, original, read: async () => ({ ...initial(), develop: recipe() }),
		apply: async () => ({ schemaVersion: 3, snapshot: { ...initial(), develop: recipe() }, notices: [] }) };
	Reflect.set(original, 'withDerivedFrame', new Proxy(original.withDerivedFrame, { get() { metadata++; throw new Error('Callable metadata reflected.'); } }));
	const captured = capturePhotoLibraryDevelopPortCurrentV1(port); assert.ok(captured.original?.withDerivedFrame);
	Reflect.set(original, 'withFrame', () => assert.fail('Replaced canonical')); Reflect.set(original, 'withDerivedFrame', () => assert.fail('Replaced derived'));
	await assert.rejects(captured.original.withFrame({ schemaVersion: 1, photoId: 'photo-1', expectedRevision: 0 }, () => undefined), /Pinned canonical/u);
	await assert.rejects(captured.original.withDerivedFrame({ schemaVersion: 1, photoId: 'photo-1', expectedRevision: 0, profile: 'highlight-recovery-v1' }, () => undefined), /Pinned derived/u);
	assert.equal(canonical, 1); assert.equal(derived, 1); assert.equal(metadata, 0);
	const bad = Object.defineProperty({ withFrame: original.withFrame }, 'withDerivedFrame', { enumerable: true, get() { metadata++; return original.withDerivedFrame; } });
	assert.throws(() => capturePhotoLibraryDevelopPortCurrentV1({ ...port, original: bad })); assert.equal(metadata, 0);
});

test('Current context native preabort retains its opaque reason before reflecting a hostile capability', () => {
	const stop = new AbortController(), opaque = Proxy.revocable({}, {}); opaque.revoke(); stop.abort(opaque.proxy); let traps = 0;
	const hostile = new Proxy({}, { get() { traps++; throw new Error('Context reflected.'); }, ownKeys() { traps++; throw new Error('Context reflected.'); } });
	let failure: unknown;
	try { Reflect.apply(capturePhotoDevelopExecutionContextCurrentV1, undefined, [hostile, stop.signal]); } catch (error) { failure = error; }
	assert.ok(Object.is(failure, opaque.proxy)); assert.equal(traps, 0);
});
