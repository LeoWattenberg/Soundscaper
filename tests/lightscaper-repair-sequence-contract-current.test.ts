/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { parsePhotoExportSidecarCurrentV1, serializePhotoExportSidecarCurrentV1 } from '../src/lightscaper/catalog/photo-export-sidecar-current-v1.ts';
import { createPhotoExportSidecarV1, serializePhotoExportSidecarV1 } from '../src/lightscaper/catalog/photo-export-sidecar-v1.ts';
import { normalizePhotoDocumentCurrentV1 } from '../src/lightscaper/catalog/photo-document-current-v1.ts';
import { normalizeImageDevelopStateCurrentV1 } from '../src/common/editor/imaging/image-develop-state-current-v1.ts';
import { repairSequenceCurrentFixture, sequenceOutcome } from './helpers/lightscaper-repair-sequence-current-fixture.ts';

test('Current collection protocol detaches frozen complete saved facts and truthful mixed Photo/process versions', async () => {
	const f = await repairSequenceCurrentFixture();
	try { const before = await f.inspect();
		assert.equal(await f.capture(view => {
			assert.equal(view.schemaVersion, 2); assert.ok(Object.isFrozen(view) && Object.isFrozen(view.photos));
			assert.ok(Object.isFrozen(view.collection)); assert.deepEqual(view.photos.map(value => value.binding.photoId), f.selectedPhotos.map(photo => photo.id));
			const facts = view.photos.map(value => parsePhotoExportSidecarCurrentV1(value.factsJson));
			assert.deepEqual(facts.map(value => value.photoSchemaVersion), [3, 3, 2, 2]);
			assert.deepEqual(facts.map(value => value.version.develop.processVersion), [3, 1, 2, 2]);
			for (const [index, value] of view.photos.entries()) {
				const photo = f.selectedPhotos[index]!, fact = facts[index]!;
				assert.ok(Object.isFrozen(value) && Object.isFrozen(value.binding) && Object.isFrozen(value.original));
				assert.equal(serializePhotoExportSidecarCurrentV1(fact), value.factsJson);
				assert.equal(fact.binding.photoId, photo.id); assert.equal(fact.binding.revision, photo.revision);
				assert.equal(fact.version.id, photo.activeVersionId); assert.deepEqual(fact.version.develop, photo.versions.find(version => version.id === photo.activeVersionId)!.develop);
				assert.equal(value.original.contentSha256, photo.original.contentSha256); assert.equal(value.original.byteLength, f.encoded.byteLength);
			}
			assert.equal(facts[0]!.version.develop.masks[0]!.schemaVersion, 2); return 'complete';
		}), 'complete'); assert.deepEqual(await f.inspect(), before);
	} finally { await f.close(); }
});

test('Current collection transports selected disabled/unused declarations and excludes authenticated retained-only resources', async () => {
	const f = await repairSequenceCurrentFixture();
	try { await f.capture(async view => {
		assert.deepEqual(view.lutReferences, f.resources.luts);
		assert.deepEqual(view.maskRasterReferences, [...f.resources.brushes].sort((a, b) => a.storageKey.localeCompare(b.storageKey)));
		assert.equal(view.maskRasterReferences.some(ref => ref.storageKey === f.resources.retainedOnly.storageKey), false);
		for (const ref of view.lutReferences) await view.withLutBytes(ref, bytes => assert.deepEqual(bytes, f.bodies.get(ref.storageKey)));
		for (const ref of view.maskRasterReferences) await view.withMaskRasterBytes(ref, bytes => assert.deepEqual(bytes, f.bodies.get(ref.storageKey)));
	}); assert.ok(f.borrowed.length > 0); assert.ok(f.borrowed.every(bytes => bytes.every(byte => byte === 0)));
	} finally { await f.close(); }
});

test('Current request admission refuses closed-field accessors, future fields and scope/revision mismatches without invoking getters', async () => {
	const f = await repairSequenceCurrentFixture(); let getters = 0;
	try {
		const accessor = { ...f.manualBinding }; Object.defineProperty(accessor, 'collectionId', { enumerable: true, get() { getters++; return 'manual'; } });
		for (const request of [accessor, { ...f.manualBinding, future: true }, { ...f.manualBinding, [Symbol('authority')]: true },
			Object.assign(Object.create(f.manualBinding) as object, {}), { ...f.manualBinding, expectedDefinitionRevision: 0 },
			{ ...f.savedBinding, expectedDefinitionRevision: undefined }, { ...f.manualBinding, scope: 'future' }]) {
			await assert.rejects(Reflect.apply(f.capture, undefined, [() => assert.fail('Invalid request must not deliver.'), {}, request]) as Promise<unknown>);
		}
		assert.equal(getters, 0); assert.deepEqual(f.events, []);
	} finally { await f.close(); }
});

test('native preaborted opaque reason wins hostile collection request reflection before readiness or bodies', async () => {
	const f = await repairSequenceCurrentFixture(), stop = new AbortController(), reason = Proxy.revocable({}, {}); reason.revoke(); stop.abort(reason.proxy);
	let reflected = 0;
	const request = new Proxy({}, { ownKeys() { reflected++; throw Symbol('late metadata'); }, getOwnPropertyDescriptor() { reflected++; throw Symbol('late descriptor'); } });
	try { const outcome = await sequenceOutcome(Reflect.apply(f.capture, undefined, [() => undefined, { signal: stop.signal }, request]) as Promise<unknown>);
		assert.equal(outcome.ok, false); if (outcome.ok) assert.fail('Preabort must reject.');
		assert.equal(outcome.error === reason.proxy, true); assert.equal(reflected, 0); assert.deepEqual(f.events, []);
	} finally { await f.close(); }
});

test('permanent legacy collection retains exact View1/Sidecar1 bytes for genuine Photo2 and refuses full repaired Current Photos', async () => {
	const legacy = await repairSequenceCurrentFixture({ count: 2, mixed: false });
	try { await legacy.session.collectionHandoff.withCapture(legacy.manualBinding, view => {
		assert.equal(view.schemaVersion, 1); assert.equal(Object.hasOwn(view, 'maskRasterReferences'), false);
		for (const [index, entry] of view.photos.entries()) assert.equal(entry.factsJson,
			serializePhotoExportSidecarV1(createPhotoExportSidecarV1(legacy.selectedPhotos[index]!, entry.binding)));
	}); } finally { await legacy.close(); }
	const repaired = await repairSequenceCurrentFixture();
	try { await assert.rejects(repaired.session.collectionHandoff.withCapture(repaired.manualBinding, () => assert.fail('Legacy owner must remain strict.')));
		assert.deepEqual(repaired.events, []); }
	finally { await repaired.close(); }
});

test('Current collection refuses same digest with inconsistent brush geometry before any selected body or Original', async () => {
	const f = await repairSequenceCurrentFixture();
	try { const photo = f.photos[2]!, version = photo.versions[0]!, graph = version.develop.masks[0]!;
		const sourceRef = `brush-mask-v1:1:3:${f.resources.brushes[0]!.sha256}`;
		const develop = normalizeImageDevelopStateCurrentV1({ ...version.develop, masks: [{ ...graph, inputs: [{ ...graph.inputs[0]!, sourceRef }] }] });
		f.change(normalizePhotoDocumentCurrentV1({ ...photo, versions: [{ ...version, develop }] }), 2);
		await assert.rejects(f.capture(() => assert.fail('Conflicting geometry must not deliver.'))); assert.deepEqual(f.events, []);
	} finally { await f.close(); }
});

test('Current capture detaches a mutable request before a held resource verification yields', async () => {
	const f = await repairSequenceCurrentFixture();
	try { const request: { catalogId: string; collectionId: string; scope: 'catalog'; expectedCatalogRevision: number } = { ...f.manualBinding };
		const originals = [...f.selectedPhotos.map(photo => photo.id)];
		const work = f.capture(view => assert.deepEqual(view.photos.map(photo => photo.binding.photoId), originals), {}, request);
		request.collectionId = 'replacement'; request.expectedCatalogRevision++;
		await work;
	} finally { await f.close(); }
});

test('the complete collection resource union refuses4097 distinct declarations before any native body verification', async () => {
	const f = await repairSequenceCurrentFixture();
	try { for (const [photoIndex, photo] of f.photos.entries()) {
		const version = photo.versions.find(value => value.id === photo.activeVersionId)!;
		const masks = Array.from({ length: 4 }, (_, graphIndex) => ({ schemaVersion: 1, id: `quota-${String(graphIndex)}`, kind: 'matte',
			inputs: Array.from({ length: 256 }, (_, inputIndex) => ({ name: `input-${String(inputIndex)}`, kind: 'alpha',
				sourceRef: `brush-mask-v1:1:1:${(photoIndex * 1024 + graphIndex * 256 + inputIndex).toString(16).padStart(64, '0')}` })),
			nodes: [{ id: 'alpha', kind: 'alpha', inputName: 'input-0' }], outputNodeId: 'alpha' }));
		const develop = normalizeImageDevelopStateCurrentV1({ ...version.develop, masks, maskBindings: [] });
		f.change({ ...photo, versions: photo.versions.map(value => {
			if (value.id !== version.id) return value;
			const { workspace: _workspace, ...fields } = value; return { ...fields, develop };
		}) }, photoIndex);
	}
		await assert.rejects(f.capture(() => assert.fail('The full combined4094 ceiling must reject.')), /limit|capacity|budget/iu);
		assert.deepEqual(f.events, []);
	} finally { await f.close(); }
});
