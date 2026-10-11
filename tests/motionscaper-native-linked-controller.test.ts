/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { COPY } from './helpers/audio-editor-controller-harness.js';
import { createMotionSavedFileAuthority } from '../desktop/motion-saved-file-authority.ts';
import { createMotionSavedFileConnection } from '../src/common/editor/motion-saved-file-connection.ts';
import { createMotionscaperRevision } from '../src/common/editor/motion-project-revision.ts';
import { digestScapeBytes } from '../src/common/editor/scape-archive-media.ts';
import { createMotionscaperProject } from '../src/motionscaper/editor-project.ts';
import { exportMotionscaperArchive } from '../src/motionscaper/editor-scape.ts';
import { createFramescaperSuccessorEnvironment } from '../src/framescaper/editor-project-successor-environment.ts';
import { createFramescaperSuccessorController, framescaperSuccessorControllerContext } from '../src/framescaper/editor-successor-controller.ts';
import { normalizeFramescaperSuccessorProject } from '../src/framescaper/editor-project-successor.ts';

test('M10 native saved-file replacements drive the real successor owner, Undo/pending/Resume and corruption refusal', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'motion-native-controller-')); const path = join(directory, 'saved.mscape');
	const bytes = new Uint8Array([7, 8, 9]); const sha256 = digestScapeBytes(bytes);
	const asset = { kind: 'image' as const, id: 'unused', name: 'Original', mimeType: 'image/png', width: 1, height: 1, hasAlpha: true, sha256, byteLength: bytes.length, storageKey: `motion-sha256:${sha256}` };
	const project = { ...createMotionscaperProject({ id: 'motion', compositionId: 'main', title: 'Native saved Motion', durationFrames: 2, width: 2, height: 2 }), assets: [asset] };
	async function save(revision: number) {
		const snapshot = createMotionscaperRevision({ ...project, revision, title: `Saved ${String(revision)}` });
		const archive = await exportMotionscaperArchive(snapshot.project, async () => ({ size: bytes.length, stream: () => new Blob([bytes]).stream() })); assert.ok(archive);
		await writeFile(`${path}.tmp`, new Uint8Array(await archive.arrayBuffer())); await rename(`${path}.tmp`, path); return snapshot;
	}
	const first = await save(0); const files = createMotionSavedFileAuthority({ chooseFile: async () => path });
	const factory = createInstrumentedIndexedDB();
	const environment = await createFramescaperSuccessorEnvironment({ line: 'successor', storeOptions: { indexedDB: factory as unknown as IDBFactory, preferOpfs: false } });
	const controller = createFramescaperSuccessorController(environment, { locale: 'en', copy: COPY });
	const { links } = framescaperSuccessorControllerContext(controller);
	const connection = createMotionSavedFileConnection({ files, compositionId: 'main', pollIntervalMs: 60_000,
		receive: async (offer, options) => { await links.receive(offer, options); },
	});
	try {
		await controller.ready; await connection.connect();
		const ownerId = controller.project!.id;
		const sourceId = normalizeFramescaperSuccessorProject(controller.project).compositionLinks[0]!.sourceId;
		assert.equal(connection.state().receipt?.digest, first.digest);
		assert.equal((await environment.owners.loadOwner(ownerId))?.project.compositionLinks[0]?.acceptedDigest, first.digest);
		const original = await environment.owners.readAsset(asset); assert.ok(original);
		assert.deepEqual(new Uint8Array(await new Response(original.stream()).arrayBuffer()), bytes);
		const second = await save(1); factory.failNextPutForStore('owners', new Error('temporary owner failure')); await connection.refresh();
		assert.equal(connection.state().status, 'error');
		assert.equal((await environment.owners.loadOwner(ownerId))?.project.compositionLinks[0]?.acceptedDigest, first.digest);
		await connection.refresh();
		assert.equal((await environment.owners.loadOwner(ownerId))?.project.compositionLinks[0]?.acceptedDigest, second.digest);
		await controller.actions.edit.undo();
		assert.equal((await environment.owners.loadOwner(ownerId))?.linkStates[0]?.state.paused, true);
		const third = await save(2); await connection.refresh();
		const pending = (await environment.owners.loadOwner(ownerId))!;
		assert.equal(pending.project.compositionLinks[0]?.acceptedDigest, first.digest);
		assert.equal(pending.linkStates[0]?.state.pending?.revision.digest, third.digest);
		await links.transition(sourceId, 'resume');
		assert.equal((await environment.owners.loadOwner(ownerId))?.project.compositionLinks[0]?.acceptedDigest, third.digest);
		await writeFile(`${path}.tmp`, new Uint8Array([1, 2, 3])); await rename(`${path}.tmp`, path); await connection.refresh();
		assert.equal(connection.state().status, 'error'); assert.equal(connection.state().receipt?.digest, third.digest);
		assert.equal((await environment.owners.loadOwner(ownerId))?.project.compositionLinks[0]?.acceptedDigest, third.digest);
		const fourth = await save(3); await connection.refresh();
		assert.equal(connection.state().status, 'connected'); assert.equal(connection.state().receipt?.digest, fourth.digest);
		assert.equal((await environment.owners.loadOwner(ownerId))?.project.compositionLinks[0]?.acceptedDigest, fourth.digest);
		assert.equal(await environment.store.getMediaAssetMetadata(sourceId), null);
		await connection.disconnect(); assert.equal(connection.state().status, 'disconnected');
	} finally {
		await connection.dispose(); await files.dispose(); await controller.dispose(); await environment.close(); await rm(directory, { recursive: true, force: true });
	}
});
