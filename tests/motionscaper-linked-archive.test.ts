/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { BlobWriter, TextReader, ZipWriter } from '@zip.js/zip.js/index-native.js';
import { createFramescaperBaselineImageFixture } from './helpers/framescaper-baseline-image-fixture.ts';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { applyFramescaperProjectCommand } from '../src/framescaper/editor-project-commands.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { createFramescaperCompositionLink } from '../src/framescaper/editor-project-successor-link.ts';
import { migrateFramescaperSuccessorProject } from '../src/framescaper/editor-project-successor.ts';
import { digestFramescaperMigrationArchive } from '../src/framescaper/editor-project-successor-archive.ts';
import { exportFramescaperLinkedSuccessorArchive } from '../src/framescaper/editor-project-successor-linked-archive.ts';
import { createMotionscaperProject } from '../src/motionscaper/editor-project.ts';
import { createMotionscaperRevision } from '../src/common/editor/motion-project-revision.ts';
import { digestScapeBytes } from '../src/common/editor/scape-archive-media.ts';
import { withScapeArchiveReader } from '../src/common/editor/scape-archive-reader.ts';
import { readScapeArchiveEnvelope } from '../src/common/editor/scape-archive-envelope.ts';
import type { MotionAsset } from '../src/common/editor/motion-asset.ts';

const bytes = new Uint8Array([1, 2, 3, 4]); const sha256 = digestScapeBytes(bytes);
const asset: MotionAsset = { id: 'image', kind: 'image', name: 'Linked.png', mimeType: 'image/png', width: 1, height: 1, hasAlpha: true, byteLength: bytes.length, sha256, storageKey: `motion-sha256:${sha256}` };
async function fixture() {
	const image = createFramescaperBaselineImageFixture({ imageOnly: true });
	const project = applyFramescaperProjectCommand(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, createFramescaperProject(), { type: 'image-source/set', sourceId: image.source.id, expectedSource: null, source: image.source });
	const json = JSON.stringify(project); const descriptor = { entry: `framescaper/timelineImage/image/${image.source.id}/body`, sourceId: `framescaper:image:${image.source.id}`, kind: 'framescaper-image-asset', encoding: 'framescaper-image-asset-v1', mimeType: image.source.mimeType, size: image.bytes.length, sha256: digestScapeBytes(image.bytes) };
	const writer = new ZipWriter(new BlobWriter(), { level: 0, useWebWorkers: false }); await writer.add('project.json', new TextReader(json));
	await writer.add('manifest.json', new TextReader(JSON.stringify({ format: 'scape-project', formatVersion: 1, project: { entry: 'project.json', schemaFamily: 'framescaper', schemaVersion: 1, size: new TextEncoder().encode(json).length, sha256: digestScapeBytes(new TextEncoder().encode(json)) }, assets: [descriptor] })));
	await writer.add(descriptor.entry, new Blob([new Uint8Array(image.bytes)]).stream()); const originalArchive = await writer.close();
	const motion = createMotionscaperProject({ id: 'motion', title: 'Linked', compositionId: 'main' }); const snapshot = createMotionscaperRevision({ ...motion, assets: [asset, { ...asset, id: 'alias' }] });
	const successor = { ...migrateFramescaperSuccessorProject(project), compositionLinks: [createFramescaperCompositionLink(image.source.id, 'main', snapshot)] };
	return { image, descriptor, record: { id: project.id, archiveDigest: await digestFramescaperMigrationArchive(originalArchive), originalArchive, project: successor } };
}

test('M10 linked successor archives retain unchanged baseline custody and one verified original per linked digest', async () => {
	const { image, descriptor, record } = await fixture(); let reads = 0;
	const archive = await exportFramescaperLinkedSuccessorArchive(record, { readAsset: async () => { reads++; return { size: bytes.length, stream: () => new Blob([bytes]).stream() }; } }); assert.ok(archive);
	assert.equal(reads, 1); await withScapeArchiveReader(archive, undefined, async (entries) => {
		const envelope = await readScapeArchiveEnvelope(entries, {}, undefined, ['framescaper-image-asset', 'motion-linked-original']);
		assert.equal(envelope.manifest.project.schemaVersion, 2); assert.deepEqual(JSON.parse(envelope.projectText) as unknown, record.project); assert.equal(envelope.manifest.assets.length, 2);
		for (const [entry, expected] of [[descriptor.entry, image.bytes], [`motion-links/sha256/${sha256}/original`, bytes]] as const) {
			const chunks: Uint8Array<ArrayBuffer>[] = []; await envelope.entryByName.get(entry)!.getData!(new WritableStream<Uint8Array>({ write(chunk) { chunks.push(new Uint8Array(chunk)); } }));
			assert.deepEqual(new Uint8Array(await new Blob(chunks).arrayBuffer()), expected);
		}
	});
});

test('M10 linked archive missing/corrupt bodies and cancellation publish no Blob and preserve original custody', async () => {
	const { record } = await fixture(); const original = await record.originalArchive.arrayBuffer();
	for (const body of [null, { size: 4, stream: () => new Blob([new Uint8Array([9, 2, 3, 4])]).stream() }, { size: 3, stream: () => new Blob([bytes]).stream() }]) {
		await assert.rejects(exportFramescaperLinkedSuccessorArchive(record, { readAsset: () => Promise.resolve(body) }), /asset|digest|size/u);
	}
	const abort = new AbortController(); abort.abort(); await assert.rejects(exportFramescaperLinkedSuccessorArchive(record, { signal: abort.signal, readAsset: async () => null }), { name: 'AbortError' });
	assert.deepEqual(await record.originalArchive.arrayBuffer(), original);
});

test('M10 linked archive metadata/custody admission refuses before acquiring linked bodies and streamed output honours backpressure', async () => {
	const { record } = await fixture(); let reads = 0; const readAsset = async () => { reads++; return { size: bytes.length, stream: () => new Blob([bytes]).stream() }; };
	await assert.rejects(exportFramescaperLinkedSuccessorArchive(record, { maximumBlobBytes: 1, readAsset }), /Blob|memory/u);
	await assert.rejects(exportFramescaperLinkedSuccessorArchive({ ...record, archiveDigest: '0'.repeat(64) }, { readAsset }), /custody/u);
	await assert.rejects(exportFramescaperLinkedSuccessorArchive({ ...record, project: { ...record.project, title: 'Unassembled edit' } }, { readAsset }), /unchanged baseline/u);
	assert.equal(reads, 0); const chunks: Uint8Array<ArrayBuffer>[] = [];
	const result = await exportFramescaperLinkedSuccessorArchive(record, { readAsset, writable: new WritableStream<Uint8Array>({ async write(chunk) { await new Promise<void>((resolve) => setTimeout(resolve, 0)); chunks.push(new Uint8Array(chunk)); } }) });
	assert.equal(result, null); assert.equal(reads, 1); assert.ok(new Blob(chunks).size > 0);
});
