/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { COPY } from './helpers/audio-editor-controller-harness.js';
import { createFramescaperSuccessorEnvironment } from '../src/framescaper/editor-project-successor-environment.ts';
import { createFramescaperSuccessorController, framescaperSuccessorControllerContext } from '../src/framescaper/editor-successor-controller.ts';
import { createMotionscaperProject } from '../src/motionscaper/editor-project.ts';
import { createMotionscaperRevision } from '../src/common/editor/motion-project-revision.ts';
import { createMotionCompositionOffer } from '../src/common/editor/motion-link-protocol.ts';
import { createAudioEditorFileService } from '../src/common/editor/file-service.js';
import { digestScapeBytes } from '../src/common/editor/scape-archive-media.ts';
import { createFramescaperSuccessorScapeNativeRuntime } from '../src/framescaper/editor-scape-successor-native.ts';
import { normalizeFramescaperSuccessorProject } from '../src/framescaper/editor-project-successor.ts';
import type { ScapeManifest } from '../src/common/editor/scape-archive-envelope.ts';

async function environment() {
	return createFramescaperSuccessorEnvironment({ line: 'successor', storeOptions: { indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory, preferOpfs: false } });
}

test('M10 actual successor File Save/Open preserves virtual picture and PCM without encoded bodies', async () => {
	const first = await environment(); let saved: Blob | null = null;
	const writer = createFramescaperSuccessorController(first, { locale: 'en', copy: COPY, fileService: {
		...createAudioEditorFileService({ bridge: null, document: null }),
		prepareSave: async () => ({ mode: 'blob' as const, target: {}, fileName: 'linked.fscape' }),
		saveFile: async (request: unknown = {}) => {
			assert.ok(request && typeof request === 'object'); const blob: unknown = Reflect.get(request, 'blob'); assert.ok(blob instanceof Blob);
			saved = blob; return { method: 'blob', fileName: 'linked.fscape', size: saved.size };
		},
	} });
	let id: string; let digest: string;
	const bytes = new Uint8Array([7, 8, 9]); const sha256 = digestScapeBytes(bytes);
	const asset = { kind: 'image' as const, id: 'unused', name: 'Original', mimeType: 'image/png', width: 1, height: 1, hasAlpha: true, sha256, byteLength: bytes.length, storageKey: `motion-sha256:${sha256}` };
	try {
		await writer.ready;
		const revision = createMotionscaperRevision({ ...createMotionscaperProject({ id: 'motion', compositionId: 'main', title: 'Saved Motion', durationFrames: 2, width: 2, height: 2 }), assets: [asset] });
		await framescaperSuccessorControllerContext(writer).links.receive(createMotionCompositionOffer('main', revision), { readAsset: async () => ({ size: bytes.length, stream: () => new Blob([bytes]).stream() }) });
		const result = await writer.actions.project.saveScape();
		assert.ok(saved); assert.ok(result && 'manifest' in result); assert.equal((result.manifest as ScapeManifest).project.schemaVersion, 2);
		const project = normalizeFramescaperSuccessorProject(writer.project); id = project.id; digest = revision.digest;
		assert.equal(await first.store.getMediaAssetMetadata(project.compositionLinks[0]!.sourceId), null);
	} finally { await writer.dispose(); await first.close(); }
	assert.ok(saved);
	const second = await environment(); const reader = createFramescaperSuccessorController(second, { locale: 'en', copy: COPY });
	try {
		await reader.ready;
		const inspection = await reader.actions.project.inspectScape(saved);
		assert.equal(inspection.id, id); assert.equal(inspection.schemaVersion, 2); assert.equal(inspection.exists, false);
		await reader.actions.project.openScape(saved);
		assert.equal(reader.project!.id, id); assert.equal(reader.project!.schemaVersion, 2);
		assert.equal(normalizeFramescaperSuccessorProject(reader.project).compositionLinks[0]!.acceptedDigest, digest);
		const owner = await second.owners.loadOwner(id); assert.equal(owner?.project.compositionLinks.length, 1);
		const original = await second.owners.readAsset(asset); assert.ok(original);
		assert.deepEqual(new Uint8Array(await new Response(original.stream()).arrayBuffer()), bytes);
		assert.equal(await second.store.loadProject(id), null);
		await assert.rejects(reader.actions.project.openScape(saved, { collision: 'replace' }), /already|retained|collision/u);
		assert.equal((await second.owners.loadOwner(id))?.ownerDigest, owner?.ownerDigest);
	} finally { await reader.dispose(); await second.close(); }
});

test('M10 successor File runtime fences its store and refuses stale import inside owner publication', async () => {
	const source = await environment(); const destination = await environment();
	const writer = createFramescaperSuccessorController(source, { locale: 'en', copy: COPY });
	const reader = createFramescaperSuccessorController(destination, { locale: 'en', copy: COPY });
	try {
		await Promise.all([writer.ready, reader.ready]); const signal = new AbortController().signal;
		const output = createFramescaperSuccessorScapeNativeRuntime(source);
		await assert.rejects(output.exportScapeProject!(writer.project!, source.store, { signal }), /exact owning/u);
		await assert.rejects(output.exportScapeProject!(writer.project!, source.controllerStore, { signal, assertCurrent: () => { throw new Error('stale writer'); } }), /stale writer/u);
		const saved = await output.exportScapeProject!(writer.project!, source.controllerStore, { signal }); assert.ok(saved.blob);
		const input = createFramescaperSuccessorScapeNativeRuntime(destination); let checks = 0;
		await assert.rejects(input.importScapeProject!(saved.blob, destination.controllerStore, {
			signal, collision: 'copy', estimateStorageForPreflight: () => ({ usage: 0, quota: 0 }),
		}), /not enough storage/u);
		assert.equal(await destination.owners.loadOwner(writer.project!.id), null);
		await assert.rejects(input.importScapeProject!(saved.blob, destination.controllerStore, {
			signal, collision: 'copy', estimateStorageForPreflight: () => ({ usage: 0, quota: 1_000_000_000 }),
			assertCurrent: () => { checks += 1; if (checks === 2) throw new Error('stale receiver'); },
		}), /stale receiver/u);
		assert.equal(checks, 2); assert.equal(await destination.owners.loadOwner(writer.project!.id), null);
		assert.equal((await destination.owners.listOwners()).length, 1);
	} finally { await Promise.all([writer.dispose(), reader.dispose()]); await Promise.all([source.close(), destination.close()]); }
});
