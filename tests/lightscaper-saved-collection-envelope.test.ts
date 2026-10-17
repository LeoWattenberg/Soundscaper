/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { BlobWriter, Uint8ArrayReader, ZipWriter } from '@zip.js/zip.js/index-native.js';
import { readScapeArchiveEnvelope, SCAPE_FORMAT, type ScapeArchiveEntry } from '../src/common/editor/scape-archive-envelope.ts';
import { copyFutureScapeArchive } from '../src/common/editor/scape-archive-copy.ts';
import { digestScapeBytes } from '../src/common/editor/scape-byte-stream.ts';
import { importScapeProject, inspectScapeProject } from '../src/common/editor/scape-project.js';
import { parseScapeProjectDocument, serializeScapeProjectDocument } from '../src/common/editor/scape-project-document.ts';
import { chunkGroupForModulePath } from '../scripts/lib/build-chunk-groups.mjs';
import { staticRelativeDependencies } from './helpers/eager-chunk-group-crossings.ts';

const KIND = 'photo-smart-collection-pack', ENCODING = 'lightscaper-smart-collection-pack-v1';
const digest = '0'.repeat(64);
function manifest(family = 'lightscaper') {
	const projectText = JSON.stringify({ schemaFamily: family, schemaVersion: 3 });
	const projectBytes = new TextEncoder().encode(projectText);
	const text = JSON.stringify({ format: SCAPE_FORMAT, formatVersion: 1,
		project: { entry: 'project.json', schemaFamily: family, schemaVersion: 3, size: projectBytes.length, sha256: digest },
		assets: [{ sourceId: 'saved-pack', entry: 'assets/saved-collection-pack-000001.bin', kind: KIND,
			encoding: ENCODING, size: 8, sha256: digest }] });
	return [entry('manifest.json', new TextEncoder().encode(text)), entry('project.json', projectBytes),
		entry('assets/saved-collection-pack-000001.bin', new Uint8Array(8))];
}

function entry(filename: string, bytes: Uint8Array): ScapeArchiveEntry {
	return { filename, directory: false, encrypted: false, compressionMethod: 0,
		compressedSize: bytes.length, uncompressedSize: bytes.length, async getData(writable, options) {
			if (options?.checkOverlappingEntryOnly) return;
			const writer = writable.getWriter();
			try { await writer.write(bytes); await writer.close(); } finally { writer.releaseLock(); }
		} };
}

test('the Scape envelope recognizes saved-definition packs only under the Lightscaper family', async () => {
	const { manifest: admitted } = await readScapeArchiveEnvelope(manifest());
	assert.equal(admitted.formatVersion, 1);
	assert.equal(admitted.project.schemaVersion, 3);
	assert.equal(admitted.assets[0]?.kind, KIND);
	for (const family of ['soundscaper', 'framescaper']) {
		await assert.rejects(readScapeArchiveEnvelope(manifest(family)), /invalid kind/iu);
		await assert.rejects(readScapeArchiveEnvelope(manifest(family), {}, undefined, [KIND]), /registered project family/iu);
	}
	await assert.rejects(readScapeArchiveEnvelope(manifest(), {}, undefined, [KIND]), /duplicate/iu);
});

test('timeline document readers preserve successor catalog state opaquely', () => {
	const project = { schemaFamily: 'lightscaper', schemaVersion: 3, kind: 'photo-catalog-archive', id: 'catalog',
		title: 'Saved catalog', savedCollectionState: { revision: 19, collectionCount: 0 }, savedCollectionPacks: [],
		futureField: { nested: [null, { criteria: 'opaque' }] } };
	const text = serializeScapeProjectDocument(project, { currentProjectSchemaFamily: 'lightscaper' });
	for (const family of ['soundscaper', 'framescaper'] as const) {
		assert.deepEqual(parseScapeProjectDocument(text, { currentProjectSchemaFamily: family }), project);
		assert.equal(serializeScapeProjectDocument(project, { currentProjectSchemaFamily: family }), text);
	}
});

test('timeline archive readers inspect, open and copy saved-definition assets without domain admission', async () => {
	const project = { schemaFamily: 'lightscaper', schemaVersion: 3, kind: 'photo-catalog-archive', id: 'catalog',
		title: 'Opaque saved catalog', savedCollectionState: { revision: 7, collectionCount: 1 },
		savedCollectionPacks: [{ id: 'saved-pack', entry: 'assets/saved-collection-pack-000001.bin', collectionCount: 1 }] };
	const bytes = new TextEncoder().encode(serializeScapeProjectDocument(project, { currentProjectSchemaFamily: 'lightscaper' }));
	const payload = new TextEncoder().encode('LSSMART1 opaque successor bytes');
	const descriptor = { entry: 'assets/saved-collection-pack-000001.bin', sourceId: 'saved-pack', kind: KIND,
		encoding: ENCODING, size: payload.length, sha256: digestScapeBytes(payload) };
	const archiveManifest = new TextEncoder().encode(JSON.stringify({ format: SCAPE_FORMAT, formatVersion: 1,
		project: { entry: 'project.json', schemaFamily: 'lightscaper', schemaVersion: 3, size: bytes.length, sha256: digestScapeBytes(bytes) },
		assets: [descriptor] }));
	const writer = new ZipWriter(new BlobWriter(), { level: 0, useWebWorkers: false });
	await writer.add(descriptor.entry, new Uint8ArrayReader(payload));
	await writer.add('project.json', new Uint8ArrayReader(bytes));
	await writer.add('manifest.json', new Uint8ArrayReader(archiveManifest));
	const blob = await writer.close();
	for (const currentProjectSchemaFamily of ['soundscaper', 'framescaper'] as const) {
		const options = { currentProjectSchemaFamily, loadProject() { assert.fail('No timeline domain admission.'); } };
		const inspected = await inspectScapeProject(blob, {}, options);
		assert.equal(inspected.readOnly, true); assert.equal(inspected.reason, 'foreign-family'); assert.equal(inspected.schemaVersion, 3);
		const opened = await importScapeProject(blob, {}, options); assert.deepEqual(opened.project, project);
		const parts: Uint8Array[] = [];
		await copyFutureScapeArchive(blob, part => { parts.push(new Uint8Array(part)); }, options);
		assert.deepEqual(new Uint8Array(await new Blob(parts as BlobPart[]).arrayBuffer()), new Uint8Array(await blob.arrayBuffer()));
	}
});

test('the saved pack recognition leaf has an exact neutral owner and no product codec dependency', async () => {
	const path = fileURLToPath(new URL('../src/common/editor/scape-photo-smart-collection-pack.ts', import.meta.url));
	const leaf = await import('../src/common/editor/scape-photo-smart-collection-pack.ts');
	assert.equal(leaf.PHOTO_SMART_COLLECTION_PACK_ASSET_KIND, KIND);
	assert.equal(leaf.PHOTO_SMART_COLLECTION_PACK_ENCODING, ENCODING);
	assert.deepEqual(staticRelativeDependencies(readFileSync(path, 'utf8')), []);
	for (const candidate of [path, path.replaceAll('/', '\\')]) assert.equal(chunkGroupForModulePath(candidate), 'editor-scape-archive-bytes');
	assert.notEqual(chunkGroupForModulePath(path + '.foreign'), 'editor-scape-archive-bytes');
	const envelope = fileURLToPath(new URL('../src/common/editor/scape-archive-envelope.ts', import.meta.url));
	assert.ok(staticRelativeDependencies(readFileSync(envelope, 'utf8')).every(dependency => !dependency.includes('lightscaper')));
});
