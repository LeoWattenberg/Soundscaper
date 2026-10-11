/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { BlobReader, BlobWriter, TextReader, ZipWriter } from '@zip.js/zip.js/index-native.js';

import { digestScapeBytes } from '../src/common/editor/scape-archive-media.ts';
import { createMotionscaperProject } from '../src/motionscaper/editor-project.ts';
import {
	exportMotionscaperArchive, importMotionscaperArchive, type MotionArchiveImportTransaction,
} from '../src/motionscaper/editor-scape.ts';

const bytes = new Uint8Array([1, 4, 8, 16]);
const digest = digestScapeBytes(bytes);
const asset = {
	id: 'image-1', name: 'Image', kind: 'image' as const, sha256: digest,
	storageKey: `motion-sha256:${digest}`, byteLength: bytes.byteLength,
	mimeType: 'image/png', width: 2, height: 2, hasAlpha: true,
};
function project() {
	return { ...createMotionscaperProject({ id: 'project-1', title: 'Title', compositionId: 'comp-1' }), assets: [asset] };
}

function transaction(failure = false) {
	const chunks: Uint8Array[] = [];
	const state = { committed: false, rolledBack: false, chunks };
	const port: MotionArchiveImportTransaction = {
		async writeAssetChunk(_asset, chunk) {
			if (failure) throw new Error('Disk full');
			chunks.push(chunk.slice());
		},
		async finishAsset() {},
		async commit() { state.committed = true; },
		async rollback() { state.rolledBack = true; chunks.length = 0; },
	};
	return { state, port };
}

test('motion Scape format 1 round trips the project and complete asset closure', async () => {
	const source = project();
	const blob = await exportMotionscaperArchive(source, () => new Blob([bytes]));
	assert.ok(blob instanceof Blob);
	const target = transaction();
	const loaded = await importMotionscaperArchive(blob, () => target.port);
	assert.equal(loaded.kind, 'current');
	if (loaded.kind !== 'current') throw new Error('Expected current document');
	assert.deepEqual(loaded.project, source);
	assert.equal(target.state.committed, true);
	assert.equal(target.state.rolledBack, false);
	assert.deepEqual(target.state.chunks.flatMap((chunk) => [...chunk]), [...bytes]);
});

test('archive export refuses missing or changed assets and respects Blob memory admission', async () => {
	await assert.rejects(exportMotionscaperArchive(project(), () => null), /unavailable/u);
	await assert.rejects(exportMotionscaperArchive(project(), () => new Blob([new Uint8Array([9, 9, 9, 9])])), /digest/u);
	await assert.rejects(exportMotionscaperArchive(project(), () => new Blob([bytes]), { maximumBlobBytes: 10 }), /stream/u);
});

test('streamed archive output verifies every asset and imports after completion', async () => {
	const output: Uint8Array[] = [];
	const result = await exportMotionscaperArchive(project(), () => new Blob([bytes]), {
		writable: new WritableStream<Uint8Array>({ write(chunk) { output.push(chunk.slice()); } }),
	});
	assert.equal(result, null);
	const target = transaction();
	await importMotionscaperArchive(new Blob(output.map((chunk) => chunk.slice().buffer)), () => target.port);
	assert.equal(target.state.committed, true);
});

test('failed or cancelled import never publishes a project and rolls back staged assets', async () => {
	const blob = await exportMotionscaperArchive(project(), () => new Blob([bytes]));
	assert.ok(blob instanceof Blob);
	const target = transaction(true);
	await assert.rejects(importMotionscaperArchive(blob, () => target.port), /Disk full/u);
	assert.equal(target.state.committed, false);
	assert.equal(target.state.rolledBack, true);
	const controller = new AbortController();
	controller.abort();
	let opened = false;
	await assert.rejects(importMotionscaperArchive(blob, () => { opened = true; return target.port; }, controller.signal), { name: 'AbortError' });
	assert.equal(opened, false);
});

async function customArchive(document: unknown, body?: Uint8Array) {
	const projectText = JSON.stringify(document);
	const projectBytes = new TextEncoder().encode(projectText);
	const writer = new ZipWriter(new BlobWriter(), { level: 0, zip64: true, useWebWorkers: false });
	await writer.add('project.json', new TextReader(projectText), { level: 0 });
	if (body) await writer.add('media/image-1/original', new BlobReader(new Blob([body.slice().buffer])), { level: 0 });
	await writer.add('manifest.json', new TextReader(JSON.stringify({
		format: 'scape-project', formatVersion: 1,
		project: { entry: 'project.json', size: projectBytes.byteLength, sha256: digestScapeBytes(projectBytes),
			schemaFamily: (document as { schemaFamily: string }).schemaFamily, schemaVersion: (document as { schemaVersion: number }).schemaVersion },
		assets: body ? [{ sourceId: asset.id, kind: 'motion-image', entry: 'media/image-1/original',
			encoding: 'motion-original-v1', size: bytes.byteLength, sha256: digest, mimeType: 'image/png' }] : [],
	})), { level: 0 });
	return writer.close();
}

test('digest corruption and missing closure fail before project publication', async () => {
	const target = transaction();
	const corrupt = await customArchive(project(), new Uint8Array([2, 4, 8, 16]));
	await assert.rejects(importMotionscaperArchive(corrupt, () => target.port), /digest/u);
	assert.equal(target.state.committed, false);
	assert.equal(target.state.rolledBack, true);
	const incomplete = await customArchive(project());
	let opened = false;
	await assert.rejects(importMotionscaperArchive(incomplete, () => { opened = true; return target.port; }), /closure/u);
	assert.equal(opened, false);
});

test('foreign and future archives retain exact opaque custody without invoking an import', async () => {
	for (const document of [
		{ schemaFamily: 'soundscaper', schemaVersion: 1, futureBody: { arbitrary: true } },
		{ schemaFamily: 'motionscaper', schemaVersion: 7, futureBody: { arbitrary: true } },
	]) {
		const blob = await customArchive(document);
		let opened = false;
		const loaded = await importMotionscaperArchive(blob, () => { opened = true; return transaction().port; });
		assert.equal(loaded.kind, 'opaque');
		if (loaded.kind !== 'opaque') throw new Error('Expected opaque custody');
		assert.equal(loaded.archive, blob);
		assert.equal(opened, false);
	}
});
