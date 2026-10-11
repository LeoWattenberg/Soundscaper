/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioSource } from '../src/common/editor/project-media-factory.ts';
import { BlobWriter, TextReader, ZipWriter } from '@zip.js/zip.js/index-native.js';
import { digestScapeBytes } from '../src/common/editor/scape-archive-media.ts';
import { AudioEditorProjectStore } from '../src/common/editor/storage.js';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { createFramescaperBaselineImageFixture } from './helpers/framescaper-baseline-image-fixture.ts';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { applyFramescaperProjectCommand } from '../src/framescaper/editor-project-commands.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { FRAMESCAPER_SUCCESSOR_MEDIA_STORAGE_PROFILE } from '../src/framescaper/editor-project-successor-runtime-profile.ts';
import { openFramescaperSuccessorRepository } from '../src/framescaper/editor-project-successor-repository.ts';
import { hydrateFramescaperSuccessorArchive } from '../src/framescaper/editor-project-successor-hydration.ts';
async function fixture(withAudio = false) {
	const pcm = new Uint8Array(20); const view = new DataView(pcm.buffer); view.setUint32(0, 4, true); for (let index = 0; index < 4; index++) view.setFloat32(4 + index * 4, (index + 1) / 4, true);
	const audio = createAudioSource({ id: 'audio', name: 'Audio', channelCount: 1, sampleRate: 48000, frameCount: 4, chunkFrames: 4 });
	const image = createFramescaperBaselineImageFixture({ imageOnly: true });
	const project = applyFramescaperProjectCommand(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, createFramescaperProject(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, withAudio ? { sources: [audio] } : {}), { type: 'image-source/set', sourceId: image.source.id, source: image.source, expectedSource: null });
	const text = JSON.stringify(project); const bytes = new TextEncoder().encode(text);
	const entry = `framescaper/timelineImage/image/${image.source.id}/body`;
	const writer = new ZipWriter(new BlobWriter(), { level: 0, useWebWorkers: false }); await writer.add('project.json', new TextReader(text));
	await writer.add('manifest.json', new TextReader(JSON.stringify({ format: 'scape-project', formatVersion: 1,
		project: { entry: 'project.json', schemaFamily: 'framescaper', schemaVersion: 1, size: bytes.length, sha256: digestScapeBytes(bytes) },
		assets: [...(withAudio ? [{ entry: 'audio/body', sourceId: audio.id, kind: 'audio', encoding: 'audio-f32le-chunks-v1', mimeType: audio.mimeType, size: pcm.length, sha256: digestScapeBytes(pcm) }] : []), { entry, sourceId: `framescaper:image:${image.source.id}`, kind: 'framescaper-image-asset', encoding: 'framescaper-image-asset-v1', mimeType: image.source.mimeType, size: image.bytes.length, sha256: digestScapeBytes(image.bytes) }] })));
	if (withAudio) await writer.add('audio/body', new Blob([pcm]).stream());
	await writer.add(entry, new Blob([new Uint8Array(image.bytes)]).stream()); const archive = await writer.close();
	const factory = createInstrumentedIndexedDB(); const indexedDB = factory as unknown as IDBFactory;
	const repository = await openFramescaperSuccessorRepository({ indexedDB, line: 'successor' }); await repository.stage(archive); const record = await repository.complete(project.id);
	const media = new AudioEditorProjectStore({ indexedDB, projectStorageProfile: FRAMESCAPER_SUCCESSOR_MEDIA_STORAGE_PROFILE, preferOpfs: false, memoryFallback: false }); await media.ready();
	return { image, project, factory, repository, record, media, close: async () => { repository.close(); await media.close(); } };
}
test('successor hydration restores authenticated image media with unchanged identities in its own cache namespace', async () => {
	const f = await fixture(); try {
		await hydrateFramescaperSuccessorArchive(f.record, f.media); const body = await f.media.loadMediaAsset(f.image.source.id); assert.ok(body);
		assert.deepEqual(new Uint8Array(await body.arrayBuffer()), f.image.bytes);
		assert.equal(await f.media.loadProject(f.project.id), null); assert.equal((await f.media.listProjects()).length, 1);
		await hydrateFramescaperSuccessorArchive(f.record, f.media);
		assert.equal(f.factory.recordCount('kw-media-framescaper-editor-v1', 'projects'), 0);
		assert.equal((await f.repository.load(f.project.id))?.archiveDigest, f.record.archiveDigest);
	} finally { await f.close(); }
});
test('successor hydration refuses changed custody and rolls back private cache publication failures', async () => {
	const f = await fixture(); try {
		await assert.rejects(hydrateFramescaperSuccessorArchive({ ...f.record, archiveDigest: 'a'.repeat(64) }, f.media), /custody|digest/iu);
		assert.equal(await f.media.loadProject(f.project.id), null);
		f.factory.failNextPutForStore('projects', new Error('cache publish failed'));
		await assert.rejects(hydrateFramescaperSuccessorArchive(f.record, f.media), /cache publish|transaction/iu);
		assert.equal(await f.media.loadProject(f.project.id), null); assert.ok(await f.repository.load(f.project.id));
		await hydrateFramescaperSuccessorArchive(f.record, f.media); assert.equal((await f.media.listProjects()).length, 1);
	} finally { await f.close(); }
});

test('successor hydration verifies reusable PCM bytes and retains unused original audio', async () => {
	const f = await fixture(true); try {
		await hydrateFramescaperSuccessorArchive(f.record, f.media);
		await hydrateFramescaperSuccessorArchive(f.record, f.media);
		const chunks = []; for await (const chunk of f.media.readSourceChunks('audio')) chunks.push(chunk.channels[0]);
		assert.deepEqual(chunks, [new Float32Array([0.25, 0.5, 0.75, 1])]);
		assert.ok((await f.media.listProjects()).some(row => 'sources' in row && Array.isArray(row.sources) && row.sources.some((source: unknown) => source !== null && typeof source === 'object' && Reflect.get(source, 'storageKey') === 'audio')));
	} finally { await f.close(); }
});
