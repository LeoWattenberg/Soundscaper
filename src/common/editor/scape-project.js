import {
	TextReader,
	ZipWriter,
} from '@zip.js/zip.js';

import { createStableId } from './project.js';
import { migrateAudioEditorProject } from './migration.js';
import { aggregateScapeErrors, awaitScapeOperation, throwIfScapeAborted } from './scape-abort.ts';
import {
	readScapeArchiveEnvelope,
	SCAPE_FORMAT,
	SCAPE_FORMAT_VERSION,
	SCAPE_MANIFEST_ENTRY,
	SCAPE_PROJECT_ENTRY,
} from './scape-archive-envelope.ts';
import { ScapeAudioChunkBudget } from './scape-expanded-byte-budget.ts';
import {
	createScapeDigest,
	extractScapeAudio,
	scapeAudioSourceStream,
	scapeBytesStream,
	scapeHashingStream,
	scapeHex,
	verifyScapeAssetBytes,
	verifyScapeExtractedAsset,
} from './scape-archive-media.ts';
import { extractScapeVideo } from './scape-archive-video.ts';
import { withScapeArchiveReader } from './scape-archive-reader.ts';
import { createScapeExportDestination } from './scape-export-destination.ts';
import {
	assertScapeExportBlob,
	completeScapeExportAsset,
	prepareScapeExport,
	serializeScapeExportManifest,
} from './scape-export-plan.ts';
import {
	assertScapeImportStore,
	ScapeImportTransaction,
} from './scape-import-transaction.ts';
import { canonicalMediaContentBlob } from './storage/media-content-digest.ts';

export { SCAPE_FORMAT, SCAPE_FORMAT_VERSION };
export const SCAPE_MIME_TYPE = 'application/vnd.soundscaper.scape+zip';
export const SCAPE_FILE_EXTENSION = '.scape';

const PROJECT_ENTRY = SCAPE_PROJECT_ENTRY;
const MANIFEST_ENTRY = SCAPE_MANIFEST_ENTRY;
const AUDIO_ENCODING = 'audio-f32le-chunks-v1';
const TEXT_ENCODER = new TextEncoder();

export async function exportScapeProject(project, store, options = {}) {
	if (!project || typeof project !== 'object') throw new TypeError('A project is required.');
	if (!store?.readSourceChunks || !store?.loadMediaAsset) throw new TypeError('A project store is required.');
	const signal = options.signal;
	const writable = options.writable;
	throwIfScapeAborted(signal);
	const plan = await prepareScapeExport(project, store, {
		maximumBlobBytes: options.maximumBlobBytes,
		output: writable ? 'stream' : 'blob',
		signal,
	});
	const mediaBySourceId = new Map();
	for (const asset of plan.assets) {
		if (asset.kind !== 'video') continue;
		const loaded = await awaitScapeOperation(store.loadMediaAsset(asset.storageKey), signal);
		if (!loaded) throw new Error(`Media source ${asset.source.name || asset.sourceId} is unavailable.`);
		const blob = canonicalMediaContentBlob(loaded);
		if (blob.size !== asset.size) {
			throw new Error(`Media source ${asset.source.name || asset.sourceId} changed since archive admission.`);
		}
		mediaBySourceId.set(asset.sourceId, blob);
	}
	throwIfScapeAborted(signal);
	const destination = createScapeExportDestination(writable, SCAPE_MIME_TYPE);
	const writer = new ZipWriter(destination.target, {
		dataDescriptor: true,
		dataDescriptorSignature: true,
		extendedTimestamp: true,
		zip64: true,
		level: 0,
		useWebWorkers: false,
		signal,
	});
	const assets = [];
	let blob;
	let manifest;

	try {
		await awaitScapeOperation(writer.add(PROJECT_ENTRY, scapeBytesStream(plan.projectBytes), {
			level: 0,
			zip64: true,
			signal,
		}), signal);
		for (const asset of plan.assets) {
			throwIfScapeAborted(signal);
			const digest = createScapeDigest();
			let size = 0;
			if (asset.kind === 'video') {
				const media = mediaBySourceId.get(asset.sourceId);
				if (!media) throw new Error(`Media source ${asset.source.name || asset.sourceId} is unavailable.`);
				size = media.size;
				await awaitScapeOperation(writer.add(
					asset.entry,
					scapeHashingStream(media.stream(), digest, signal),
					{ level: 0, zip64: true, signal },
				), signal);
			} else {
				const stream = scapeAudioSourceStream(
					store,
					asset.source,
					digest,
					(byteLength) => { size += byteLength; },
					signal,
					plan.audioChunkBudget,
				);
				await awaitScapeOperation(writer.add(asset.entry, stream, { level: 0, zip64: true, signal }), signal);
			}
			if (size !== asset.size) throw new Error(`Source ${asset.sourceId} changed size during Scape export.`);
			assets.push(completeScapeExportAsset(asset, scapeHex(digest.digest())));
		}
		const serialized = serializeScapeExportManifest(plan, assets);
		manifest = serialized.manifest;
		throwIfScapeAborted(signal);
		await awaitScapeOperation(writer.add(MANIFEST_ENTRY, new TextReader(serialized.text), {
			level: 0,
			zip64: true,
			signal,
		}), signal);
		blob = await destination.finish(writer, signal);
	} catch (error) {
		return destination.abort(writer, error);
	}
	if (blob) assertScapeExportBlob(plan, blob);
	return { blob, manifest };
}

export async function importScapeProject(input, store, options = {}) {
	if (!(input instanceof Blob)) throw new TypeError('A .scape Blob is required.');
	const signal = options.signal;
	let transaction = null;
	try {
		const result = await withScapeArchiveReader(input, signal, async (entries) => {
			const {
				entryByName,
				expandedByteBudget,
				manifest,
				projectText,
			} = await readScapeArchiveEnvelope(entries, options.archiveLimits || {}, signal);
			assertScapeImportStore(store);
			transaction = new ScapeImportTransaction(store, signal);
			const audioChunkBudget = new ScapeAudioChunkBudget();
			const projectBytes = TEXT_ENCODER.encode(projectText);
			verifyScapeAssetBytes(projectBytes, manifest.project, 'project document');
			throwIfScapeAborted(signal);
			const loaded = migrateAudioEditorProject(JSON.parse(projectText));
			let project = structuredClone(loaded.project);
			const existingProject = await awaitScapeOperation(store.loadProject(project.id), signal);
			const collision = options.collision || 'copy';
			if (existingProject && collision === 'cancel') throw new Error('A project with this ID already exists.');
			if (existingProject && collision === 'copy') {
				project.id = createStableId('project');
				project.title = `${project.title || 'Untitled'} copy`;
				project.revision = 0;
				project.createdAt = new Date().toISOString();
				project.updatedAt = project.createdAt;
			}
			await transaction.captureProject(project.id);

			const assetBySourceId = new Map(manifest.assets.map((asset) => [asset.sourceId, asset]));
			if (assetBySourceId.size !== manifest.assets.length) throw new Error('The .scape manifest contains duplicate source assets.');
			const sourceIdMap = new Map();
			for (const source of project.sources || []) {
				throwIfScapeAborted(signal);
				const asset = assetBySourceId.get(source.id);
				if (!asset) throw new Error(`The .scape archive is missing source ${source.id}.`);
				if ((source.kind === 'video' ? 'video' : 'audio') !== asset.kind) {
					throw new Error(`Source ${source.id} has an incompatible asset kind.`);
				}
				const occupied = source.kind === 'video'
					? await awaitScapeOperation(store.getMediaAssetMetadata(source.storageKey || source.id), signal)
					: await awaitScapeOperation(store.getSourceMetadata(source.storageKey || source.id), signal);
				const nextId = occupied ? createStableId(source.kind === 'video' ? 'video-source' : 'source') : source.id;
				sourceIdMap.set(source.id, nextId);
				source.id = nextId;
				source.storageKey = nextId;
			}
			for (const clip of [...(project.clips || []), ...(project.projectBin?.clips || [])]) {
				clip.sourceId = sourceIdMap.get(clip.sourceId) || clip.sourceId;
			}

			for (const [originalSourceId, finalSourceId] of sourceIdMap) {
				throwIfScapeAborted(signal);
				const source = project.sources.find((candidate) => candidate.id === finalSourceId);
				const asset = assetBySourceId.get(originalSourceId);
				const entry = entryByName.get(asset.entry);
				if (!entry) throw new Error(`The .scape archive is missing ${asset.entry}.`);
				transaction.trackProvisionalSource(finalSourceId);
				if (source.kind === 'video') {
					let mediaWriter = null;
					let mediaFailure = null;
					let mediaFailed = false;
					try {
						mediaWriter = await store.beginMediaAssetWrite(finalSourceId, {
							name: source.name,
							mimeType: source.mimeType,
						}, {
							expectedBytes: asset.size,
							expectedSha256: asset.sha256,
							signal,
						});
						throwIfScapeAborted(signal);
						const { digest, size } = await extractScapeVideo(
							entry,
							mediaWriter,
							signal,
							expandedByteBudget,
						);
						verifyScapeExtractedAsset(asset, digest, size, source.name || source.id);
						const persisted = await awaitScapeOperation(mediaWriter.commit({ signal }), signal);
						if (persisted?.sha256 !== asset.sha256) {
							throw new Error(`Persisted media SHA-256 verification failed for ${source.name || source.id}.`);
						}
						if (persisted?.size !== asset.size) {
							throw new Error(`Persisted media size verification failed for ${source.name || source.id}.`);
						}
					} catch (error) {
						mediaFailed = true;
						mediaFailure = error;
					}
					let abortFailure = null;
					let abortFailed = false;
					if (mediaWriter) {
						try {
							await mediaWriter.abort();
						} catch (error) {
							abortFailed = true;
							abortFailure = error;
						}
					}
					if (mediaFailed) {
						if (abortFailed) throw aggregateScapeErrors(
							mediaFailure,
							[abortFailure],
							'The .scape media write and cleanup both failed.',
						);
						throw mediaFailure;
					}
					if (abortFailed) throw abortFailure;
				} else {
					if (asset.encoding !== AUDIO_ENCODING) throw new Error(`Unsupported audio asset encoding: ${asset.encoding}.`);
					throwIfScapeAborted(signal);
					const sourceWriter = await store.beginSourceWrite(finalSourceId, {
						name: source.name,
						mimeType: source.mimeType,
						sampleRate: source.sampleRate,
						channelCount: source.channelCount,
						chunkFrames: source.chunkFrames,
					});
					try {
						throwIfScapeAborted(signal);
						const extracted = await extractScapeAudio(
							entry,
							sourceWriter,
							source,
							signal,
							expandedByteBudget,
							audioChunkBudget,
						);
						verifyScapeExtractedAsset(asset, extracted.digest, extracted.size, source.name || source.id);
						await awaitScapeOperation(sourceWriter.commit({
							sampleRate: source.sampleRate,
							channelCount: source.channelCount,
						}, { signal }), signal);
					} catch (error) {
						try {
							await sourceWriter.abort();
						} catch (abortError) {
							throw aggregateScapeErrors(error, [abortError], 'The .scape source write and cleanup both failed.');
						}
						throw error;
					}
				}
			}
			await transaction.publishProject(project);
			return {
				project,
				manifest,
				readOnly: loaded.readOnly,
				reason: loaded.reason,
				collision: existingProject ? collision : null,
			};
		}, options.archiveReaderFactory);
		transaction.complete();
		return result;
	} catch (error) {
		if (transaction) return transaction.rollback(error);
		throw error;
	}
}

/**
 * @param {Blob} input
 * @param {{ loadProject?: (projectId: string) => PromiseLike<unknown> } | null} store
 * @param {{ signal?: AbortSignal }} options
 */
export async function inspectScapeProject(input, store = null, options = {}) {
	if (!(input instanceof Blob)) throw new TypeError('A .scape Blob is required.');
	const signal = options.signal;
	return withScapeArchiveReader(input, signal, async (entries) => {
		const { manifest, projectText } = await readScapeArchiveEnvelope(
			entries,
			options.archiveLimits || {},
			signal,
		);
		verifyScapeAssetBytes(TEXT_ENCODER.encode(projectText), manifest.project, 'project document');
		throwIfScapeAborted(signal);
		const loaded = migrateAudioEditorProject(JSON.parse(projectText));
		const existing = store?.loadProject
			? await awaitScapeOperation(store.loadProject(loaded.project.id), signal)
			: null;
		return Object.freeze({
			id: loaded.project.id,
			title: loaded.project.title,
			schemaVersion: loaded.project.schemaVersion,
			readOnly: loaded.readOnly,
			exists: Boolean(existing),
			manifest,
		});
	}, options.archiveReaderFactory);
}
