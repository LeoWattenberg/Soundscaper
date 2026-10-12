/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { parsePhotoExportSidecarCurrentV1 } from '../src/lightscaper/catalog/photo-export-sidecar-current-v1.ts';
import { applyPhotoCommandCurrentV1 } from '../src/lightscaper/controller/photo-commands-current-v1.ts';
import { SETTINGS_TIME } from './helpers/lightscaper-repair-settings-current-fixture.ts';
import { repairFrameHandoffFixture } from './helpers/lightscaper-repair-frame-handoff-current-fixture.ts';
import { LUT_REFERENCE } from './helpers/lightscaper-masked-frame-fixture.ts';

for (const placement of ['active', 'redo', 'snapshot'] as const) test(`selected Current ${placement} Photo3 capture admits the complete saved owner and publishes canonical Sidecar2`, async () => {
	const f = await repairFrameHandoffFixture(placement);
	try { const before = await f.inspect();
		assert.equal(await f.capture(async view => {
			assert.equal(view.schemaVersion, 2); assert.ok(Object.isFrozen(view));
			const facts = parsePhotoExportSidecarCurrentV1(view.factsJson);
			assert.equal(facts.schemaVersion, 2); assert.equal(facts.photoSchemaVersion, 3); assert.deepEqual(facts.version.develop, f.version.develop);
			if (placement !== 'active') assert.equal(facts.version.develop.processVersion, 1);
			assert.deepEqual(new Uint8Array(await view.originalBlob.arrayBuffer()), new Uint8Array(await f.records[0]!.original.arrayBuffer()));
			assert.deepEqual(view.lutReferences, []); assert.deepEqual(view.maskRasterReferences, []); return 'captured';
		}), 'captured'); assert.deepEqual(await f.inspect(), before); assert.equal(f.events.filter(value => value === 'original').length, 1);
	} finally { await f.close(); }
});

test('Current capture transports complete disabled LUT and named unbound matte declarations including unused brush bodies', async () => {
	const f = await repairFrameHandoffFixture('active', true);
	try { await f.capture(async view => {
		assert.deepEqual(view.lutReferences, [LUT_REFERENCE]); assert.deepEqual(view.maskRasterReferences, [...f.references].sort((a, b) => a.storageKey.localeCompare(b.storageKey)));
		for (const reference of view.lutReferences) await view.withLutBytes(reference, bytes => { assert.deepEqual(bytes, f.bodies.get(reference.storageKey)); });
		for (const reference of view.maskRasterReferences) await view.withMaskRasterBytes(reference, bytes => { assert.deepEqual(bytes, f.bodies.get(reference.storageKey)); });
	}); assert.ok(f.borrowed.length >= 3); assert.ok(f.borrowed.every(bytes => bytes.every(byte => byte === 0)));
	} finally { await f.close(); }
});

test('corrupt body retained only in redo refuses Current capture before Original and consumer', async () => {
	const f = await repairFrameHandoffFixture('redo', true); let consumers = 0;
	try { assert.equal(f.version.develop.processVersion, 1); await f.corruptResource(f.references[1]!.storageKey);
		await assert.rejects(f.capture(() => { consumers++; })); assert.equal(consumers, 0); assert.equal(f.events.includes('original'), false);
	} finally { await f.close(); }
});

test('complete Current saved foreign brush namespace refuses before resource or Original acquisition', async () => {
	const f = await repairFrameHandoffFixture('active', true); let consumers = 0;
	try { const version = f.photo.versions.find(value => value.id === f.photo.activeVersionId)!, graph = version.develop.masks[0]!;
		f.change(applyPhotoCommandCurrentV1(f.photo, { type: 'record-develop', versionId: version.id, label: 'Foreign declaration', createdAt: SETTINGS_TIME,
			develop: { ...version.develop, masks: [{ ...graph, inputs: [...graph.inputs, { name: 'foreign', kind: 'alpha', sourceRef: 'foreign-source' }] }] } }));
		await assert.rejects(f.capture(() => { consumers++; })); assert.equal(consumers, 0); assert.deepEqual(f.events, []);
	} finally { await f.close(); }
});

test('foreign input retained only in redo refuses before Current selected legacy capture acquires any body', async () => {
	const f = await repairFrameHandoffFixture('redo', true);
	try { const retained = f.photo.versions.find(value => value.id === f.photo.activeVersionId)!.workspace!.entries.at(-1)!.develop, graph = retained.masks[0]!;
		let changed = applyPhotoCommandCurrentV1(f.photo, { type: 'record-develop', versionId: f.binding.versionId, label: 'Foreign retained declaration', createdAt: SETTINGS_TIME,
			develop: { ...retained, masks: [{ ...graph, inputs: [...graph.inputs, { name: 'foreign-retained', kind: 'alpha', sourceRef: 'foreign-source' }] }] } });
		changed = applyPhotoCommandCurrentV1(changed, { type: 'select-develop-history', cursor: 0 }); f.change(changed);
		assert.equal(changed.versions.find(value => value.id === changed.activeVersionId)!.develop.processVersion, 1);
		await assert.rejects(f.capture(() => assert.fail('Retained foreign declaration must not deliver.'))); assert.deepEqual(f.events, []);
	} finally { await f.close(); }
});

test('permanent legacy capture retains exact view1 and refuses genuine Photo3 independently of the Current child', async () => {
	const legacy = await repairFrameHandoffFixture('legacy');
	try { await legacy.session.imageHandoff.withCapture(legacy.binding, view => { assert.equal(view.schemaVersion, 1); assert.deepEqual(view.lutReferences, []); }); }
	finally { await legacy.close(); }
	const repaired = await repairFrameHandoffFixture();
	try { await assert.rejects(repaired.session.imageHandoff.withCapture(repaired.binding, () => assert.fail('Strict legacy capture must refuse3.'))); assert.deepEqual(repaired.events, []); }
	finally { await repaired.close(); }
});
