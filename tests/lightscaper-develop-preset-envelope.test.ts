/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BlobWriter, Uint8ArrayReader, ZipWriter } from '@zip.js/zip.js/index-native.js';
import { copyFutureScapeArchive } from '../src/common/editor/scape-archive-copy.ts';
import { digestScapeBytes } from '../src/common/editor/scape-byte-stream.ts';
import { readScapeArchiveEnvelope } from '../src/common/editor/scape-archive-envelope.ts';
import { withScapeProjectInput } from '../src/common/editor/scape-project-input.ts';
import { inspectScapeProject, importScapeProject } from '../src/common/editor/scape-project.js';
import { PHOTO_DEVELOP_PRESET_PACK_ASSET_KIND as KIND, PHOTO_DEVELOP_PRESET_PACK_ENCODING as ENCODING } from '../src/common/editor/scape-photo-develop-preset-pack.ts';
import { chunkGroupForModulePath } from '../scripts/lib/build-chunk-groups.mjs';
import { staticRelativeDependencies } from './helpers/eager-chunk-group-crossings.ts';

async function fixture(family = 'lightscaper') {
	const project = { schemaFamily: family, schemaVersion: 4, kind: 'photo-catalog-archive', id: 'catalog', title: 'Preset backup',
		developPresetPack: { id: 'develop-presets', entry: 'assets/develop-presets-v1.bin', revision: 91, presetCount: 0 } };
	const bytes = new TextEncoder().encode(JSON.stringify(project));
	const payload = new TextEncoder().encode(JSON.stringify({ schemaVersion: 1, kind: 'photo-develop-presets', catalogId: 'catalog', revision: 91, presets: [] }));
	const asset = { sourceId: 'develop-presets', entry: 'assets/develop-presets-v1.bin', kind: KIND, encoding: ENCODING,
		size: payload.byteLength, sha256: digestScapeBytes(payload) };
	const manifest = new TextEncoder().encode(JSON.stringify({ format: 'scape-project', formatVersion: 1,
		project: { entry: 'project.json', schemaFamily: family, schemaVersion: 4, size: bytes.byteLength, sha256: digestScapeBytes(bytes) }, assets: [asset] }));
	const writer = new ZipWriter(new BlobWriter(), { level: 0, useWebWorkers: false });
	await writer.add(asset.entry, new Uint8ArrayReader(payload)); await writer.add('project.json', new Uint8ArrayReader(bytes));
	await writer.add('manifest.json', new Uint8ArrayReader(manifest));
	return { project, blob: await writer.close() };
}

test('Sound and Frame readers inspect, open and byte-copy archive4 preset bodies opaquely without product admission', async () => {
	const { blob, project } = await fixture();
	for (const currentProjectSchemaFamily of ['soundscaper', 'framescaper'] as const) {
		const options = { currentProjectSchemaFamily, loadProject() { assert.fail('Foreign catalog reached timeline domain admission'); } };
		const inspected = await inspectScapeProject(blob, {}, options);
		assert.equal(inspected.readOnly, true); assert.equal(inspected.reason, 'foreign-family'); assert.equal(inspected.schemaVersion, 4);
		assert.deepEqual((await importScapeProject(blob, {}, options)).project, project);
		const parts: Uint8Array[] = [];
		await copyFutureScapeArchive(blob, bytes => { parts.push(new Uint8Array(bytes)); }, options);
		assert.deepEqual(new Uint8Array(await new Blob(parts as BlobPart[]).arrayBuffer()), new Uint8Array(await blob.arrayBuffer()));
	}
});

test('The literal preset kind belongs only to Lightscaper and has an exact neutral chunk owner', async () => {
	for (const family of ['soundscaper', 'framescaper']) {
		const { blob } = await fixture(family);
		await assert.rejects(inspectScapeProject(blob, {}, { currentProjectSchemaFamily: 'soundscaper' }), /invalid kind/iu);
	}
	const path = fileURLToPath(new URL('../src/common/editor/scape-photo-develop-preset-pack.ts', import.meta.url));
	assert.deepEqual(staticRelativeDependencies(readFileSync(path, 'utf8')), []);
	for (const candidate of [path, path.replaceAll('/', '\\')]) assert.equal(chunkGroupForModulePath(candidate), 'editor-scape-archive-bytes');
	assert.notEqual(chunkGroupForModulePath(path + '.foreign'), 'editor-scape-archive-bytes');
	const envelope = fileURLToPath(new URL('../src/common/editor/scape-archive-envelope.ts', import.meta.url));
	assert.ok(staticRelativeDependencies(readFileSync(envelope, 'utf8')).every(dependency => !dependency.includes('lightscaper')));
});

test('Additional asset kinds cannot bypass the registered Lightscaper family or duplicate its preset kind', async () => {
	for (const family of ['soundscaper', 'framescaper']) {
		const { blob } = await fixture(family);
		await assert.rejects(withScapeProjectInput(blob, undefined,
			entries => readScapeArchiveEnvelope(entries, {}, undefined, [KIND])), /registered project family/iu);
	}
	const { blob } = await fixture();
	await assert.rejects(withScapeProjectInput(blob, undefined,
		entries => readScapeArchiveEnvelope(entries, {}, undefined, [KIND])), /duplicate/iu);
});
