import assert from 'node:assert/strict';
import test from 'node:test';

import {
	BlobReader,
	TextWriter,
	ZipReader,
} from '@zip.js/zip.js';

import {
	audacityXmlAttribute,
	audacityXmlChildren,
	createAudacityXmlNode,
} from '../src/common/editor/audacity-binary-xml.js';
import {
	createAup4EffectsNode,
	readAup4EffectsNode,
} from '../src/common/editor/aup4-effects.js';
import {
	AudioEditorProjectReimportRequiredError,
	migrateAudioEditorProject,
} from '../src/common/editor/migration.js';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { createAudioEditorProjectV10 } from '../src/common/editor/project-v10.ts';
import {
	SCAPE_FORMAT,
	exportScapeProject,
	importScapeProject,
	inspectScapeProject,
} from '../src/common/editor/scape-project.js';
import {
	rewriteScapeManifest,
	rewriteScapeProjectDocument,
} from './helpers/scape-archive-rewrite.js';
import { createProjectStore } from '../src/common/editor/storage.js';

test('scape archives round-trip mixed projects, original media, PCM, effects, and project-bin content', async () => {
	const sourceStore = memoryStore('scape-roundtrip-source');
	const targetStore = memoryStore('scape-roundtrip-target');
	const project = mixedProject();
	await persistAssets(sourceStore);
	await sourceStore.saveVideoDerivative('video-source', {
		timestamp: 0,
		type: 'poster',
		blob: new Blob(['disposable poster'], { type: 'image/webp' }),
		width: 320,
		height: 180,
	});
	assert.equal((await sourceStore.listVideoDerivatives('video-source')).length, 1);
	await sourceStore.saveProject(project);

	const exported = await exportScapeProject(project, sourceStore);
	assert.equal(exported.manifest.format, SCAPE_FORMAT);
	assert.equal(exported.manifest.assets.length, 2);
	assert.ok(exported.blob.size > 0);
	const archiveReader = new ZipReader(new BlobReader(exported.blob), { useWebWorkers: false });
	const archiveEntries = await archiveReader.getEntries();
	assert.deepEqual(
		archiveEntries.map(({ filename }) => filename).sort(),
		[
			'manifest.json',
			exported.manifest.project.entry,
			...exported.manifest.assets.map(({ entry }) => entry),
		].sort(),
	);
	assert.ok(archiveEntries.every((entry) => (
		entry.compressionMethod === 0 && entry.compressedSize === entry.uncompressedSize
	)));
	await archiveReader.close();

	const imported = await importScapeProject(exported.blob, targetStore);
	assert.equal(imported.project.id, project.id);
	const importedVideoSource = imported.project.sources.find((source) => source.kind === 'video');
	assert.equal(importedVideoSource.posterStorageKey, null);
	assert.equal(importedVideoSource.thumbnailStorageKey, null);
	assert.deepEqual(imported.project.clips.find((clip) => clip.kind === 'video').videoEffects, project.clips.find((clip) => clip.kind === 'video').videoEffects);
	assert.deepEqual(imported.project.metadata.bext, project.metadata.bext);
	assert.deepEqual(imported.project.sources.find((source) => source.id === 'audio-source').opaqueExtensions,
		project.sources.find((source) => source.id === 'audio-source').opaqueExtensions);
	assert.deepEqual(imported.project.opaqueExtensions, project.opaqueExtensions);
	assert.equal((await targetStore.loadMediaAsset('video-source')).size, 11);
	assert.deepEqual(await targetStore.listVideoDerivatives('video-source'), []);
	const retainedMedia = await targetStore.getMediaAssetMetadata('video-source');
	const videoDescriptor = exported.manifest.assets.find(({ sourceId }) => sourceId === 'video-source');
	assert.equal(retainedMedia.sha256, videoDescriptor.sha256);
	const audioChunks = [];
	for await (const channels of targetStore.readSourceChunks('audio-source')) audioChunks.push(channels);
	assert.deepEqual([...(audioChunks[0].channels || audioChunks[0])[0]], [0.25, -0.5, 0.75, 0]);
	assert.equal(imported.project.projectBin.clips[0].sourceId, 'video-source');

	const copied = await importScapeProject(exported.blob, targetStore, { collision: 'copy' });
	assert.notEqual(copied.project.id, project.id);
	assert.match(copied.project.title, /copy$/u);
	assert.notEqual(copied.project.sources[0].id, project.sources[0].id);
	const copiedVideoSource = copied.project.sources.find((source) => source.kind === 'video');
	assert.equal(copiedVideoSource.posterStorageKey, null);
	assert.equal(copiedVideoSource.thumbnailStorageKey, null);
	for (const clip of [...copied.project.clips, ...copied.project.projectBin.clips]) {
		assert.ok(copied.project.sources.some((source) => source.id === clip.sourceId));
	}
});

test('V16 timeline annotations survive a current-format scape semantic round trip', async () => {
	const sourceStore = memoryStore('scape-v11-annotation-source');
	const targetStore = memoryStore('scape-v11-annotation-target');
	const timelineAnnotations = [{
		id: 'marker-opening', sequenceId: 'main-sequence', name: 'Opening cue', color: 'violet',
		batchId: null, opaqueExtensions: { cue: { id: 7 } }, kind: 'marker', anchor: 'sample',
		positionFrame: 24_000,
	}, {
		id: 'region-chorus', sequenceId: 'main-sequence', name: 'Chorus', color: 'teal',
		batchId: 'batch-song-form', opaqueExtensions: {}, kind: 'region', anchor: 'musical',
		startBeat: { num: 17, den: 4 }, endBeat: { num: 33, den: 4 },
	}];
	const project = createCurrentAudioEditorProject({
		id: 'scape-v11-annotation-project',
		title: 'Timeline annotation round trip',
		now: '2026-08-09T18:00:00.000Z',
		sources: [], clips: [], tracks: [], timelineAnnotations,
	});

	const exported = await exportScapeProject(project, sourceStore);
	assert.equal(exported.manifest.project.schemaVersion, 16);
	const imported = await importScapeProject(exported.blob, targetStore);
	assert.equal(imported.readOnly, false);
	assert.equal(imported.project.schemaVersion, 16);
	assert.deepEqual(imported.project.timelineAnnotations, timelineAnnotations);
	assert.deepEqual((await targetStore.loadProject(project.id)).timelineAnnotations, timelineAnnotations);
});

test('an explicit historical V10 scape fails with typed re-import before persistence', async () => {
	const sourceStore = memoryStore('scape-v10-reimport-source');
	const backingStore = memoryStore('scape-v10-reimport-target');
	const historical = createAudioEditorProjectV10({
		id: 'scape-v10-reimport-project',
		title: 'Historical V10 project',
		now: '2026-08-09T18:05:00.000Z',
		sources: [], clips: [], tracks: [],
	});
	const exported = await exportScapeProject(historical, sourceStore);
	let persistenceCalls = 0;
	const targetStore = new Proxy(backingStore, {
		get(target, property) {
			if (['saveProject', 'beginSourceWrite', 'beginMediaAssetWrite'].includes(String(property))) {
				return (...args) => {
					persistenceCalls += 1;
					return target[property](...args);
				};
			}
			const value = target[property];
			return typeof value === 'function' ? value.bind(target) : value;
		},
	});

	await assert.rejects(
		() => importScapeProject(exported.blob, targetStore),
		(error) => error instanceof AudioEditorProjectReimportRequiredError
			&& error.schemaVersion === 10
			&& error.currentSchemaVersion === 16,
	);
	assert.equal(persistenceCalls, 0);
	assert.deepEqual(await backingStore.listProjects(), []);
	assert.deepEqual(await backingStore.listSources(), []);
});

test('a future V17 scape opens read-only without interpreting, rewriting, or persisting its graph', async () => {
	const sourceStore = memoryStore('scape-future-preview-source');
	const targetStore = memoryStore('scape-future-preview-target');
	const project = mixedProject();
	await persistAssets(sourceStore);
	const exported = await exportScapeProject(project, sourceStore);
	const future = await rewriteScapeProjectDocument(exported.blob, (document) => {
		document.schemaVersion = 17;
		document.timelineAnnotations = { futureShape: { retained: true } };
		const videoSource = document.sources.find((source) => source.kind === 'video');
		videoSource.posterStorageKey = 'future-poster-locator';
		videoSource.thumbnailStorageKey = 'future-thumbnail-locator';
	});

	const imported = await importScapeProject(future, targetStore);
	const importedVideoSource = imported.project.sources.find((source) => source.kind === 'video');
	assert.equal(imported.readOnly, true);
	assert.equal(imported.reason, 'newer-schema');
	assert.equal(imported.collision, null);
	assert.equal(imported.project.id, project.id, 'a future project keeps its exact identity');
	assert.deepEqual(imported.project.timelineAnnotations, { futureShape: { retained: true } });
	assert.equal(importedVideoSource.posterStorageKey, 'future-poster-locator');
	assert.equal(importedVideoSource.thumbnailStorageKey, 'future-thumbnail-locator');
	assert.equal(await targetStore.loadProject(imported.project.id), null,
		'a future-schema archive must not publish into the destination store');
	assert.equal(await targetStore.getSourceMetadata(project.sources[0].id), null,
		'a future-schema archive must not extract source bodies');
});

test('scape imports reject checksum failures without publishing staged projects or sources', async () => {
	const sourceStore = memoryStore('scape-corrupt-source');
	const targetStore = memoryStore('scape-corrupt-target');
	const project = mixedProject();
	await persistAssets(sourceStore);
	await sourceStore.saveProject(project);
	const exported = await exportScapeProject(project, sourceStore);
	const corrupted = await rewriteScapeManifest(exported.blob, (manifest) => {
		manifest.assets[1].sha256 = '0'.repeat(64);
	});

	await assert.rejects(() => importScapeProject(corrupted, targetStore), /SHA-256 verification/u);
	assert.deepEqual(await targetStore.listProjects(), []);
	assert.deepEqual(await targetStore.listSources(), []);
	assert.equal(await targetStore.getMediaAssetMetadata('video-source'), null);
});

test('scape imports reject a persisted media digest mismatch before project publication', async () => {
	const sourceStore = memoryStore('scape-persisted-digest-source');
	const backingStore = memoryStore('scape-persisted-digest-target');
	const project = mixedProject();
	await persistAssets(sourceStore);
	const exported = await exportScapeProject(project, sourceStore);
	let projectWrites = 0;
	const targetStore = new Proxy(backingStore, {
		get(target, property) {
			if (property === 'beginMediaAssetWrite') return async (...args) => {
				const writer = await target.beginMediaAssetWrite(...args);
				return {
					maximumChunkBytes: writer.maximumChunkBytes,
					get bytesWritten() { return writer.bytesWritten; },
					write: writer.write.bind(writer),
					async commit(...commitArgs) {
						const metadata = await writer.commit(...commitArgs);
						return { ...metadata, sha256: String(metadata.sha256).toUpperCase() };
					},
					async commitOwned(...commitArgs) {
						const publication = await writer.commitOwned(...commitArgs);
						return {
							metadata: {
								...publication.metadata,
								sha256: String(publication.metadata.sha256).toUpperCase(),
							},
							discardIfCurrent: publication.discardIfCurrent.bind(publication),
						};
					},
					abort: writer.abort.bind(writer),
				};
			};
			if (property === 'saveProject') return async (...args) => {
				projectWrites += 1;
				return target.saveProject(...args);
			};
			const value = target[property];
			return typeof value === 'function' ? value.bind(target) : value;
		},
	});

	await assert.rejects(
		() => importScapeProject(exported.blob, targetStore),
		/persisted media SHA-256/iu,
	);
	assert.equal(projectWrites, 0);
	assert.deepEqual(await backingStore.listProjects(), []);
	assert.deepEqual(await backingStore.listSources(), []);
	assert.equal(await backingStore.getMediaAssetMetadata('video-source'), null);
});

test('scape imports reject writer mutation that differs from independently hashed archive bytes', async () => {
	const sourceStore = memoryStore('scape-blob-spoof-source');
	const backingStore = memoryStore('scape-blob-spoof-target');
	const project = mixedProject();
	await persistAssets(sourceStore);
	const exported = await exportScapeProject(project, sourceStore);
	let stagedMediaBytes = null;
	let projectWrites = 0;
	const targetStore = new Proxy(backingStore, {
		get(target, property) {
			if (property === 'beginMediaAssetWrite') return async (...args) => {
				const writer = await target.beginMediaAssetWrite(...args);
				return {
					maximumChunkBytes: writer.maximumChunkBytes,
					get bytesWritten() { return writer.bytesWritten; },
					async write(bytes, options) {
						stagedMediaBytes = new Uint8Array(bytes.byteLength).fill(0xa5);
						await writer.write(stagedMediaBytes, options);
					},
					commit: writer.commit.bind(writer),
					commitOwned: writer.commitOwned.bind(writer),
					abort: writer.abort.bind(writer),
				};
			};
			if (property === 'saveProject') return async (...args) => {
				projectWrites += 1;
				return target.saveProject(...args);
			};
			const value = target[property];
			return typeof value === 'function' ? value.bind(target) : value;
		},
	});

	await assert.rejects(
		() => importScapeProject(exported.blob, targetStore),
		/streamed media SHA-256/iu,
	);
	assert.deepEqual([...stagedMediaBytes], new Array(11).fill(0xa5));
	assert.equal(projectWrites, 0);
	assert.deepEqual(await backingStore.listProjects(), []);
	assert.deepEqual(await backingStore.listSources(), []);
	assert.equal(await backingStore.getMediaAssetMetadata('video-source'), null);
});

test('scape imports roll back already staged media when a later source write is interrupted', async () => {
	const sourceStore = memoryStore('scape-interrupt-source');
	const backingStore = memoryStore('scape-interrupt-target');
	const project = mixedProject();
	project.sources.reverse();
	await persistAssets(sourceStore);
	const exported = await exportScapeProject(project, sourceStore);
	const targetStore = new Proxy(backingStore, {
		get(target, property) {
			if (property === 'beginSourceWrite') return async (...args) => {
				const writer = await target.beginSourceWrite(...args);
				return {
					write: async () => { throw new Error('simulated interrupted import'); },
					commit: writer.commit.bind(writer),
					abort: writer.abort.bind(writer),
				};
			};
			const value = target[property];
			return typeof value === 'function' ? value.bind(target) : value;
		},
	});

	await assert.rejects(() => importScapeProject(exported.blob, targetStore));
	assert.deepEqual(await backingStore.listProjects(), []);
	assert.deepEqual(await backingStore.listSources(), []);
	assert.equal(await backingStore.getMediaAssetMetadata('video-source'), null);
});

test('scape export snapshots project and source data without invoking accessors', async () => {
	for (const target of ['project', 'source']) {
		const sourceStore = memoryStore(`scape-accessor-${target}`);
		const project = migrateAudioEditorProject(mixedProject()).project;
		await persistAssets(sourceStore);
		let activations = 0;
		const owner = target === 'project' ? project : project.sources[0];
		Object.defineProperty(owner, 'opaqueExtensions', {
			enumerable: true,
			get() {
				activations += 1;
				return {};
			},
		});
		await assert.rejects(() => exportScapeProject(project, sourceStore), /accessor/iu);
		assert.equal(activations, 0, `${target} accessor must not run`);
	}
});

test('scape archives preserve missing AUP4 binary state and reject malformed tags before project work', async () => {
	const sourceStore = memoryStore('scape-opaque-binary-source');
	const targetStore = memoryStore('scape-opaque-binary-target');
	const project = migrateAudioEditorProject(mixedProject()).project;
	const nativeEffect = createAudacityXmlNode('effect', [
		{ kind: 'attribute', name: 'active', type: 'bool', value: true },
		{ kind: 'attribute', name: 'id', type: 'string', value: 'Effect_VST3_Acme_Future_Path' },
	], [{ kind: 'blob', name: 'state', value: Uint8Array.of(0, 1, 2, 253, 254, 255) }]);
	const nativeRack = createAudacityXmlNode('effects', [], [{ kind: 'node', node: nativeEffect }]);
	project.master.effects = readAup4EffectsNode(nativeRack, { idFactory: () => 'missing-future' });
	await persistAssets(sourceStore);
	const exported = await exportScapeProject(project, sourceStore);

	const projectDocument = await readArchiveJson(exported.blob, 'project.json');
	const encodedState = projectDocument.master.effects[0].opaqueAudacityNode.node.content[2].value;
	assert.deepEqual(Object.keys(encodedState), ['$soundscaperOpaqueBinary']);
	assert.deepEqual(encodedState.$soundscaperOpaqueBinary, {
		schemaVersion: 1,
		id: 1,
		type: 'Uint8Array',
		byteLength: 6,
		base64: 'AAEC/f7/',
	});
	assert.equal((await inspectScapeProject(exported.blob)).id, project.id);

	const imported = await importScapeProject(exported.blob, targetStore);
	const reloaded = await targetStore.loadProject(imported.project.id);
	const importedEffect = reloaded.master.effects[0];
	const importedState = importedEffect.opaqueAudacityNode.node.content[2].value;
	assert.ok(importedState instanceof Uint8Array);
	assert.deepEqual([...importedState], [0, 1, 2, 253, 254, 255]);
	const rewrittenRack = createAup4EffectsNode([importedEffect]);
	const [rewrittenEffect] = audacityXmlChildren(rewrittenRack, 'effect');
	assert.equal(audacityXmlAttribute(rewrittenEffect, 'id'), 'Effect_VST3_Acme_Future_Path');
	assert.deepEqual(rewrittenEffect.content[2].value, Uint8Array.of(0, 1, 2, 253, 254, 255));

	const malformed = await rewriteScapeProjectDocument(exported.blob, (document) => {
		document.master.effects[0].opaqueAudacityNode.node.content[2]
			.value.$soundscaperOpaqueBinary.base64 = 'AAEC/f4=';
	});
	let collisionLookups = 0;
	const unopenedStore = {
		loadProject() {
			collisionLookups += 1;
			return null;
		},
	};
	await assert.rejects(() => inspectScapeProject(malformed, unopenedStore), /byte length|base64/iu);
	await assert.rejects(() => importScapeProject(malformed, unopenedStore), /byte length|base64/iu);
	assert.equal(collisionLookups, 0);
});

function memoryStore(prefix) {
	return createProjectStore({ indexedDB: null, databaseName: `${prefix}-${Date.now()}-${Math.random()}` });
}

async function persistAssets(store) {
	const writer = await store.beginSourceWrite('audio-source', {
		name: 'sound.wav',
		mimeType: 'audio/wav',
		sampleRate: 48_000,
		channelCount: 1,
	});
	await writer.write([new Float32Array([0.25, -0.5, 0.75, 0])]);
	await writer.commit();
	await store.writeMediaAsset('video-source', new Blob(['video-bytes'], { type: 'video/mp4' }), {
		name: 'picture.mp4',
		mimeType: 'video/mp4',
	});
}

function mixedProject() {
	return createCurrentAudioEditorProject({
		id: 'mixed-scape-project',
		title: 'Mixed project',
		metadata: {
			title: 'Mixed project',
			bext: {
				description: 'Archive broadcast metadata',
				timeReference: '9007199254740993',
				originator: 'Soundscaper',
			},
		},
		opaqueExtensions: { preserved: { value: 42 } },
		sources: [{
			kind: 'audio', id: 'audio-source', storageKey: 'audio-source', name: 'sound.wav', mimeType: 'audio/wav',
			frameCount: 4, channelCount: 1, sampleRate: 48_000, originalSampleRate: 48_000,
			opaqueExtensions: {
				bext: {
					description: 'Original source metadata',
					timeReference: '48000',
					version: 1,
				},
			},
		}, {
			kind: 'video', id: 'video-source', storageKey: 'video-source', name: 'picture.mp4', mimeType: 'video/mp4',
			frameCount: 48_000, sampleRate: 48_000, width: 1_920, height: 1_080, frameRate: 30,
			videoCodec: 'h264', audioCodec: null, hasAudio: false,
			posterStorageKey: 'legacy-video-poster', thumbnailStorageKey: 'legacy-video-thumbnail',
		}],
		clips: [{
			kind: 'video', id: 'video-clip', sourceId: 'video-source', title: 'Picture', timelineStartFrame: 0,
			sourceStartFrame: 0, sourceDurationFrames: 48_000, durationFrames: 48_000,
			videoEffects: [{ id: 'video-effect', type: 'pixelate', enabled: true, params: { blockSize: 12 } }],
		}, {
			kind: 'audio', id: 'audio-clip', sourceId: 'audio-source', title: 'Sound', timelineStartFrame: 0,
			sourceStartFrame: 0, sourceDurationFrames: 4, durationFrames: 4,
		}],
		tracks: [{ type: 'video', id: 'video-track', name: 'Video', clipIds: ['video-clip'] }, {
			type: 'audio', id: 'audio-track', name: 'Audio', clipIds: ['audio-clip'],
		}],
		projectBin: { clips: [{
			kind: 'video', id: 'bin-video', sourceId: 'video-source', title: 'Bin picture', timelineStartFrame: 0,
			sourceStartFrame: 0, sourceDurationFrames: 48_000, durationFrames: 48_000, binItemId: 'bin-video',
			videoEffects: [{ id: 'bin-effect', type: 'vignette', enabled: true, params: { amount: 0.5 } }],
		}] },
	});
}

async function readArchiveJson(blob, filename) {
	const reader = new ZipReader(new BlobReader(blob), { useWebWorkers: false });
	try {
		const entries = await reader.getEntries();
		const entry = entries.find((candidate) => candidate.filename === filename);
		if (!entry) throw new Error(`Missing ${filename}.`);
		return JSON.parse(await entry.getData(new TextWriter()));
	} finally {
		await reader.close();
	}
}
