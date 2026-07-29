import {
	TextReader,
	ZipWriter,
} from '@zip.js/zip.js';

import { createStableId } from './project.js';
import { migrateAudioEditorProject } from './migration.js';
import { remapProjectFeatureRequirementSourceIds } from './project-feature-requirements.ts';
import {
	aggregateScapeErrors,
	awaitScapeOperation,
	awaitScapeReadOperation,
	throwIfScapeAborted,
} from './scape-abort.ts';
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
import { indexScapeProjectAssets } from './scape-project-assets.ts';
import { parseScapeProjectDocument } from './scape-project-document.ts';
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
	const createWritable = options.createWritable;
	if (writable && createWritable) throw new TypeError('Choose one Scape streaming destination.');
	if (createWritable !== undefined && typeof createWritable !== 'function') {
		throw new TypeError('The Scape destination factory must be a function.');
	}
	throwIfScapeAborted(signal);
	const plan = await prepareScapeExport(project, store, {
		maximumBlobBytes: options.maximumBlobBytes,
		output: writable || createWritable ? 'stream' : 'blob',
		signal,
	});
	const resolvedWritable = createWritable
		? await awaitScapeOperation(createWritable(plan.maximumArchiveBytes), signal)
		: writable;
	if ((writable || createWritable) && (!resolvedWritable || typeof resolvedWritable.getWriter !== 'function')) {
		throw new TypeError('The Scape streaming destination is not writable.');
	}
	const destination = createScapeExportDestination(
		resolvedWritable,
		SCAPE_MIME_TYPE,
		plan.maximumArchiveBytes,
	);
	const writer = new ZipWriter(destination.target, {
		dataDescriptor: true,
		dataDescriptorSignature: true,
		extendedTimestamp: true,
		zip64: true,
		level: 0,
		useWebWorkers: false,
		signal,
	});
	const mediaBySourceId = new Map();
	const assets = [];
	let blob;
	let manifest;

	try {
		for (const asset of plan.assets) {
			if (asset.kind !== 'video') continue;
			const loaded = await awaitScapeOperation(store.loadMediaAsset(asset.storageKey, { signal }), signal);
			if (!loaded) throw new Error(`Media source ${asset.source.name || asset.sourceId} is unavailable.`);
			const mediaBlob = canonicalMediaContentBlob(loaded);
			if (mediaBlob.size !== asset.size) {
				throw new Error(`Media source ${asset.source.name || asset.sourceId} changed since archive admission.`);
			}
			mediaBySourceId.set(asset.sourceId, mediaBlob);
		}
		throwIfScapeAborted(signal);
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
	return { blob, manifest, byteLength: destination.byteLength };
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
			const audioChunkBudget = new ScapeAudioChunkBudget();
			const projectBytes = TEXT_ENCODER.encode(projectText);
			verifyScapeAssetBytes(projectBytes, manifest.project, 'project document');
			throwIfScapeAborted(signal);
			const loaded = migrateAudioEditorProject(parseScapeProjectDocument(projectText));
			let project = structuredClone(loaded.project);
			const assetBySourceId = indexScapeProjectAssets(project, manifest);
			assertScapeImportStore(store);
			transaction = new ScapeImportTransaction(store, signal);
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

			const sourceIdMap = new Map();
			for (const source of project.sources || []) {
				throwIfScapeAborted(signal);
				const occupied = source.kind === 'video'
					? await awaitScapeOperation(store.getMediaAssetMetadata(source.id), signal)
					: await awaitScapeOperation(store.getSourceMetadata(source.id), signal);
				const nextId = occupied ? createStableId(source.kind === 'video' ? 'video-source' : 'source') : source.id;
				sourceIdMap.set(source.id, nextId);
				source.id = nextId;
				source.storageKey = nextId;
			}
			remapScapeProjectSourceReferences(project, sourceIdMap);
			if (!loaded.readOnly && project.schemaVersion === 9) {
				project.featureRequirements = remapProjectFeatureRequirementSourceIds(
					project.featureRequirements,
					sourceIdMap,
					{ sources: project.sources },
				);
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

function remapScapeProjectSourceReferences(project, sourceIdMap) {
	for (const clip of [...(project.clips || []), ...(project.projectBin?.clips || [])]) {
		clip.sourceId = sourceIdMap.get(clip.sourceId) || clip.sourceId;
	}
}

/**
 * @param {Blob} input
 * @param {{ loadProject?: (
 *   projectId: string,
 *   options?: Readonly<{ signal?: AbortSignal }>,
 * ) => PromiseLike<unknown> | unknown } | null} store
 * @param {{ signal?: AbortSignal, projectFeatureCompatibility?: {
 *   evaluate: (project: unknown) => unknown,
 * } }} options
 * @param {{ retain?: (settlement: PromiseLike<unknown>) => void }} retention
 */
export async function inspectScapeProject(input, store = null, options = {}, retention = {}) {
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
		const loaded = migrateAudioEditorProject(parseScapeProjectDocument(projectText));
		indexScapeProjectAssets(loaded.project, manifest);
		const featureRequirementsCompatibility = options.projectFeatureCompatibility
			? options.projectFeatureCompatibility.evaluate(loaded.project)
			: null;
		const existing = store?.loadProject
			? await awaitScapeReadOperation(
				() => {
					const lookup = Promise.resolve(store.loadProject(loaded.project.id, { signal }));
					retention.retain?.(lookup);
					return lookup;
				},
				signal,
			)
			: null;
		return Object.freeze({
			id: loaded.project.id,
			title: loaded.project.title,
			schemaVersion: loaded.project.schemaVersion,
			readOnly: loaded.readOnly,
			exists: Boolean(existing),
			manifest,
			featureRequirementsCompatibility,
		});
	}, options.archiveReaderFactory);
}
