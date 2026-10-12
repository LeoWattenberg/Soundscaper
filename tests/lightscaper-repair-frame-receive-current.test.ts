/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultImageDevelopStateV1 } from '../src/common/editor/imaging/image-develop-state-v1.ts';
import { repairRecipe } from './helpers/lightscaper-repair-raster-export-current-fixture.ts';
import { LUT_REFERENCE } from './helpers/lightscaper-masked-frame-fixture.ts';
import { literalRepairSourceArchive, repairFrameHandoffFixture, readRepairFrameEntries } from './helpers/lightscaper-repair-frame-handoff-current-fixture.ts';

for (const develop of [repairRecipe(), defaultImageDevelopStateV1()]) test(`actual Current receive publishes Source3/process${develop.processVersion} as full Photo3 under native managed Original custody`, async () => {
	const incoming = await literalRepairSourceArchive(develop), f = await repairFrameHandoffFixture('legacy');
	try { const receipt = await f.receive(incoming.archive, incoming.sourceId); assert.equal(receipt.schemaVersion, 2); assert.equal(receipt.status, 'imported'); assert.equal(receipt.settlement, 'complete');
		const photo = await f.catalog.loadPhoto(receipt.catalogId, receipt.photoId); assert.ok(photo); assert.equal(photo.schemaVersion, 3);
		assert.deepEqual(photo.versions.find(value => value.id === photo.activeVersionId)!.develop, develop);
		const body = await f.media.mediaRepository.loadAsset(photo.original.storageKey); assert.ok(body); assert.deepEqual(new Uint8Array(await body.arrayBuffer()), incoming.original);
		assert.ok(![f.photo.id, f.photo.original.id, f.photo.activeVersionId].includes(receipt.photoId));
		const roots = await f.media.mediaRepository.catalogOriginals.readPage({ catalogId: receipt.catalogId }); assert.ok(roots.roots.some(root => root.photoId === receipt.photoId && root.assetId === photo.original.storageKey));
	} finally { await f.close(); }
});

test('genuine Source3 sender archive installs and reopens every selected brush/LUT declaration before actual Current publication', async () => {
	const sender = await repairFrameHandoffFixture('active', true); let recipient: Awaited<ReturnType<typeof repairFrameHandoffFixture>> | undefined;
	try { const archive = await sender.archive(), entries = await readRepairFrameEntries(archive.blob), source = (JSON.parse(new TextDecoder().decode(entries.get('project.json'))) as { sources: { id: string }[] }).sources[0]!;
		recipient = await repairFrameHandoffFixture('legacy'); const receipt = await recipient.receive(archive.blob, source.id);
		const photo = await recipient.catalog.loadPhoto(receipt.catalogId, receipt.photoId); assert.ok(photo); assert.equal(photo.schemaVersion, 3);
		assert.deepEqual(photo.versions.find(value => value.id === photo.activeVersionId)!.develop, sender.version.develop);
		const masks = await recipient.media.getMaskRasterResources(), luts = await recipient.media.getCubeLutResources();
		for (const reference of sender.references) await masks.source.withBytes(reference, bytes => { assert.deepEqual(bytes, sender.bodies.get(reference.storageKey)); });
		await luts.source.withBytes(LUT_REFERENCE, bytes => { assert.deepEqual(bytes, sender.bodies.get(LUT_REFERENCE.storageKey)); });
	} finally { await recipient?.close(); await sender.close(); }
});

test('Current receive scans actual retained Photo3 identities and allocates a fresh native destination rather than demoting the inventory', async () => {
	const incoming = await literalRepairSourceArchive(repairRecipe()), f = await repairFrameHandoffFixture('redo');
	try { const before = await f.inspect(), receipt = await f.receive(incoming.archive, incoming.sourceId);
		assert.equal(receipt.status, 'imported'); assert.notEqual(receipt.photoId, f.photo.id); assert.deepEqual(await f.inspect(), before);
		assert.equal((await f.catalog.loadCatalog(f.root.id))!.photoCount, 2);
	} finally { await f.close(); }
});

test('permanent legacy receive rejects an honest Source3 archive without native destination publication', async () => {
	const incoming = await literalRepairSourceArchive(repairRecipe()), f = await repairFrameHandoffFixture('legacy');
	try { await assert.rejects(f.session.imageReceive.receive({ archive: incoming.archive, sourceId: incoming.sourceId }));
		assert.equal((await f.catalog.loadCatalog(f.root.id))!.photoCount, 1); assert.deepEqual(await f.inspect(), [f.photo]);
	} finally { await f.close(); }
});
