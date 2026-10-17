/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { repairFrameHandoffFixture, readRepairFrameEntries, rewriteRepairFrameArchive, sha256 } from './helpers/lightscaper-repair-frame-handoff-current-fixture.ts';
import { ORIGINAL } from './helpers/lightscaper-repair-raster-export-current-fixture.ts';

for (const placement of ['active', 'redo'] as const) test(`actual ${placement} Current sender builds editable Source3 and keeps immutable Original separately from its full recipe`, async () => {
	const f = await repairFrameHandoffFixture(placement);
	try { const before = await f.inspect(), result = await f.archive(), entries = await readRepairFrameEntries(result.blob);
		const project = JSON.parse(new TextDecoder().decode(entries.get('project.json'))) as { sources: Record<string, unknown>[] };
		const source = project.sources[0]!, provenance = source.provenance as { schemaVersion: number; developSha256: string; origin: { schemaVersion: number } };
		assert.equal(source.schemaVersion, 3); assert.deepEqual(source.develop, f.version.develop); assert.equal(provenance.schemaVersion, 2);
		assert.equal(provenance.origin.schemaVersion, 3); assert.equal(provenance.developSha256, sha256(JSON.stringify(f.version.develop)));
		await f.read(result.blob, source.id as string, async view => {
			assert.equal(view.schemaVersion, 2); assert.deepEqual(view.source, source); assert.equal(view.canonicalFrameSha256, sha256(Uint8Array.from(ORIGINAL)));
			assert.deepEqual(new Uint8Array(await view.originalBlob.arrayBuffer()), new Uint8Array(await f.records[0]!.original.arrayBuffer()));
		}); assert.deepEqual(await f.inspect(), before);
	} finally { await f.close(); }
});

test('Current sender/read roundtrip carries exact declared unused SCMASK and disabled LUT bytes with unchanged names and references', async () => {
	const f = await repairFrameHandoffFixture('active', true);
	try { const result = await f.archive(), entries = await readRepairFrameEntries(result.blob), project = JSON.parse(new TextDecoder().decode(entries.get('project.json'))) as { sources: { id: string }[] };
		const manifest = JSON.parse(new TextDecoder().decode(entries.get('manifest.json'))) as { assets: { sourceId: string; kind: string; encoding: string; entry: string; sha256: string; size: number }[] };
		for (const reference of f.references) { const asset = manifest.assets.find(value => value.sourceId === reference.storageKey)!; assert.ok(asset);
			assert.equal(asset.entry, `assets/masks/${reference.sha256}.scmask`); assert.equal(asset.kind, 'photo-mask-raster'); assert.equal(asset.encoding, 'lightscaper-mask-raster-v1');
			assert.equal(asset.size, reference.byteLength); assert.equal(asset.sha256, reference.sha256); assert.deepEqual(entries.get(asset.entry), f.bodies.get(reference.storageKey)); }
		await f.read(result.blob, project.sources[0]!.id, async view => {
			for (const reference of view.maskRasterReferences) await view.withMaskRasterBytes(reference, bytes => { assert.deepEqual(bytes, f.bodies.get(reference.storageKey)); });
			for (const reference of view.lutReferences) await view.withLutBytes(reference, bytes => { assert.deepEqual(bytes, f.bodies.get(reference.storageKey)); });
		});
	} finally { await f.close(); }
});

test('genuine saved Photo2 brush uses Source3 with truthful origin2 and exact process2 without promoting the sender Photo', async () => {
	const f = await repairFrameHandoffFixture('brush2');
	try { assert.equal(f.photo.schemaVersion, 2); assert.equal(f.version.develop.processVersion, 2);
		const before = await f.inspect(), result = await f.archive(), entries = await readRepairFrameEntries(result.blob);
		const source = (JSON.parse(new TextDecoder().decode(entries.get('project.json'))) as { sources: { id: string; schemaVersion: number; provenance: { schemaVersion: number; origin: { schemaVersion: number } }; develop: unknown }[] }).sources[0]!;
		assert.equal(source.schemaVersion, 3); assert.equal(source.provenance.schemaVersion, 2); assert.equal(source.provenance.origin.schemaVersion, 2); assert.deepEqual(source.develop, f.version.develop);
		await f.read(result.blob, source.id, view => { assert.equal(view.maskRasterReferences.length, 1); }); assert.deepEqual(await f.inspect(), before);
	} finally { await f.close(); }
});

test('Current reverse archive reader refuses physically corrupted unused brush bytes before delivery', async () => {
	const f = await repairFrameHandoffFixture('active', true); let consumers = 0;
	try { const result = await f.archive(); let sourceId = '';
		const changed = await rewriteRepairFrameArchive(result.blob, (project, files) => { sourceId = ((project.sources as { id: string }[])[0]!).id;
			const key = `assets/masks/${f.references[1]!.sha256}.scmask`, bytes = files.get(key)!; assert.ok(bytes); bytes[bytes.length - 1] = bytes.at(-1)! ^ 1; });
		await assert.rejects(f.read(changed, sourceId, () => { consumers++; })); assert.equal(consumers, 0);
	} finally { await f.close(); }
});

test('Current sender refuses declared canonical expansion before native decode even when encoded Original is small', async () => {
	const f = await repairFrameHandoffFixture();
	try { f.change({ ...f.photo, original: { ...f.photo.original, width: 8_192, height: 8_192 } });
		await assert.rejects(f.archive()); assert.equal(f.events.includes('native-open'), false); assert.equal(f.events.includes('original'), false);
	} finally { await f.close(); }
});
