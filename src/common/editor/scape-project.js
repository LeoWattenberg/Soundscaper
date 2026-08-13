import {
	TextReader,
	ZipWriter,
} from '@zip.js/zip.js';

import { createStableId } from './project.js';
import { AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION } from './project-schema-version.ts';
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
import { preflightScapeImportCapacity } from './scape-import-capacity.ts';
import { indexScapeProjectAssets, indexScapeProjectTimingAssets } from './scape-project-assets.ts';
import { parseScapeProjectDocument } from './scape-project-document.ts';
import { withScapeProjectInput } from './scape-project-input.ts';
import { canonicalMediaContentBlob } from './storage/media-content-digest.ts';
import { remapTakeGroupSourceIds } from './take-group-source-references.ts';
import {
	normalizeVideoTimingAssetReference,
	validateVideoTimingAssetBytes,
} from './video-timing-asset.ts';

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
			if (asset.kind === 'audio') continue;
			const loaded = await awaitScapeOperation(store.loadMediaAsset(asset.storageKey, { signal }), signal);
			if (!loaded) throw new Error(`Media source ${asset.source.name || asset.sourceId} is unavailable.`);
			const mediaBlob = canonicalMediaContentBlob(loaded);
			if (mediaBlob.size !== asset.size) {
				throw new Error(`Media source ${asset.source.name || asset.sourceId} changed since archive admission.`);
			}
			if (asset.kind === 'video-timing') {
				validateVideoTimingAssetBytes(
					asset.timingReference,
					new Uint8Array(await mediaBlob.arrayBuffer()),
				);
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
			if (asset.kind !== 'audio') {
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
	const signal = options.signal;
	let transaction = null;
	try {
		const result = await withScapeProjectInput(input, signal, async (entries) => {
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
			const loaded = migrateScapeProjectDocument(projectText, options);
			let project = structuredClone(loaded.project);
			if (loaded.readOnly) {
				return { project, manifest, readOnly: true, reason: loaded.reason, collision: null };
			}
			const assetBySourceId = indexScapeProjectAssets(project, manifest, {
				currentProjectSchemaVersion: scapeCurrentProjectSchemaVersion(options),
			});
			const timingAssetByStorageKey = indexScapeProjectTimingAssets(project, manifest);
			const timingReferenceByStorageKey = indexScapeTimingReferences(project.sources || []);
			assertScapeImportStore(store);
			const existingProject = await awaitScapeOperation(store.loadProject(project.id), signal);
			const collision = options.collision || 'copy';
			if (existingProject && collision === 'cancel') throw new Error('A project with this ID already exists.');
			await preflightScapeImportCapacity(manifest, {
				estimateStorage: options.estimateStorageForPreflight == null && typeof store.estimateStorage === 'function'
					? () => store.estimateStorage()
					: undefined,
				estimateStorageForPreflight: options.estimateStorageForPreflight,
				signal,
			});
			throwIfScapeAborted(signal);
			if (existingProject && collision === 'copy') {
				project.id = createStableId('project');
				project.title = `${project.title || 'Untitled'} copy`;
				project.revision = 0;
				project.createdAt = new Date().toISOString();
				project.updatedAt = project.createdAt;
			}
			transaction = new ScapeImportTransaction(store, signal);
			await transaction.captureProject(project.id);
			for (const [storageKey, asset] of timingAssetByStorageKey) {
				throwIfScapeAborted(signal);
				const existingTiming = await awaitScapeOperation(store.getMediaAssetMetadata(storageKey), signal);
				if (existingTiming) {
					if (existingTiming.sha256 !== asset.sha256 || existingTiming.size !== asset.size) {
						throw new Error(`Timing asset ${storageKey} conflicts with immutable stored content.`);
					}
					const reference = timingReferenceByStorageKey.get(storageKey);
					if (typeof store.loadMediaAsset !== 'function') {
						throw new TypeError('A media store with timing-body reads is required for .scape import.');
					}
					const loadedTiming = await awaitScapeOperation(store.loadMediaAsset(
						storageKey,
						{ signal },
					), signal);
					if (!loadedTiming) throw new Error(`Timing asset ${storageKey} body is unavailable.`);
					const canonicalTiming = canonicalMediaContentBlob(loadedTiming);
					if (canonicalTiming.size !== reference.byteLength) {
						throw new Error(`Timing asset ${storageKey} body has an unexpected byte length.`);
					}
					validateVideoTimingAssetBytes(
						reference,
						new Uint8Array(await canonicalTiming.arrayBuffer()),
					);
					continue;
				}
				const entry = entryByName.get(asset.entry);
				if (!entry) throw new Error(`The .scape archive is missing ${asset.entry}.`);
				let timingWriter = null;
				let timingPublication = null;
				try {
					timingWriter = await store.beginMediaAssetWrite(storageKey, {
						name: `${asset.sha256}.scti`,
						mimeType: 'application/vnd.soundscaper.video-timing',
						kind: 'video-timing',
					}, { expectedBytes: asset.size, expectedSha256: asset.sha256, signal });
					assertOwnedScapeMediaWriter(timingWriter);
					const timingChunks = [];
					const extracted = await extractScapeVideo(
						entry,
						captureScapeTimingWriter(timingWriter, timingChunks),
						signal,
						expandedByteBudget,
					);
					verifyScapeExtractedAsset(asset, extracted.digest, extracted.size, storageKey);
					validateVideoTimingAssetBytes(
						timingReferenceByStorageKey.get(storageKey),
						joinScapeTimingChunks(timingChunks, asset.size),
					);
					// Capture exact publication ownership before checking a concurrent abort.
					timingPublication = await timingWriter.commitOwned({ signal });
					throwIfScapeAborted(signal);
					const persisted = timingPublication.metadata;
					if (persisted?.sha256 !== asset.sha256 || persisted?.size !== asset.size) {
						throw new Error(`Persisted timing asset ${storageKey} failed verification.`);
					}
					transaction.trackProvisionalMedia(timingPublication);
				} catch (error) {
					try {
						if (timingPublication) await timingPublication.discardIfCurrent();
						else if (timingWriter) await timingWriter.abort();
					} catch (cleanupError) {
						throw aggregateScapeErrors(
							error,
							[cleanupError],
							'The .scape timing write and cleanup both failed.',
						);
					}
					throw error;
				}
			}

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
				if (!loaded.readOnly && source.kind === 'video') {
					source.posterStorageKey = null;
					source.thumbnailStorageKey = null;
				}
			}
			remapScapeProjectSourceReferences(project, sourceIdMap);
			if (!loaded.readOnly && project.schemaVersion === scapeCurrentProjectSchemaVersion(options)) {
				project.featureRequirements = remapProjectFeatureRequirementSourceIds(
					project.featureRequirements,
					sourceIdMap,
					{
						sources: project.sources,
						clips: project.clips,
						tracks: project.tracks,
						schemaVersion: project.schemaVersion,
						sampleRate: project.sampleRate,
						sequences: project.sequences,
						primarySequenceId: project.primarySequenceId,
					},
				);
			}

			for (const [originalSourceId, finalSourceId] of sourceIdMap) {
				throwIfScapeAborted(signal);
				const source = project.sources.find((candidate) => candidate.id === finalSourceId);
				const asset = assetBySourceId.get(originalSourceId);
				const entry = entryByName.get(asset.entry);
				if (!entry) throw new Error(`The .scape archive is missing ${asset.entry}.`);
				if (source.kind === 'video') {
					let mediaWriter = null;
					let mediaPublication = null;
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
						assertOwnedScapeMediaWriter(mediaWriter);
						throwIfScapeAborted(signal);
						const { digest, size } = await extractScapeVideo(
							entry,
							mediaWriter,
							signal,
							expandedByteBudget,
						);
						verifyScapeExtractedAsset(asset, digest, size, source.name || source.id);
						// Retain the ownership token before observing a cancellation that can arrive
						// concurrently with durable publication. Racing this promise would lose the
						// only capability that can safely remove the just-published generation.
						mediaPublication = await mediaWriter.commitOwned({ signal });
						throwIfScapeAborted(signal);
						const persisted = mediaPublication.metadata;
						if (persisted?.sha256 !== asset.sha256) {
							throw new Error(`Persisted media SHA-256 verification failed for ${source.name || source.id}.`);
						}
						if (persisted?.size !== asset.size) {
							throw new Error(`Persisted media size verification failed for ${source.name || source.id}.`);
						}
						transaction.trackProvisionalMedia(mediaPublication);
					} catch (error) {
						mediaFailed = true;
						mediaFailure = error;
					}
					let abortFailure = null;
					let abortFailed = false;
					if (mediaPublication && mediaFailed) {
						try {
							await mediaPublication.discardIfCurrent();
						} catch (error) {
							abortFailed = true;
							abortFailure = error;
						}
					} else if (mediaWriter && !mediaPublication) {
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
					transaction.trackProvisionalSource(finalSourceId);
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
		}, {
			blob: options.archiveReaderFactory,
			byteSource: options.archiveByteSourceReaderFactory,
		});
		if (transaction) transaction.complete();
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
	remapTakeGroupSourceIds(project, sourceIdMap);
}

function indexScapeTimingReferences(sources) {
	const references = new Map();
	for (const source of sources) {
		if (source?.kind !== 'video' || source.timingAsset == null) continue;
		const reference = normalizeVideoTimingAssetReference(source.timingAsset);
		const existing = references.get(reference.storageKey);
		if (existing && !sameScapeTimingBodyReference(existing, reference)) {
			throw new Error(`Video sources sharing timing asset ${reference.storageKey} have conflicting references.`);
		}
		if (!existing) references.set(reference.storageKey, reference);
	}
	return references;
}

function sameScapeTimingBodyReference(left, right) {
	return left.encoding === right.encoding
		&& left.storageKey === right.storageKey
		&& left.sha256 === right.sha256
		&& left.byteLength === right.byteLength
		&& left.frameCount === right.frameCount
		&& left.timescale === right.timescale
		&& left.finalFrameDurationTicks === right.finalFrameDurationTicks;
}

function captureScapeTimingWriter(writer, chunks) {
	return {
		maximumChunkBytes: writer.maximumChunkBytes,
		get bytesWritten() { return writer.bytesWritten; },
		async write(bytes, options) {
			chunks.push(bytes.slice());
			await writer.write(bytes, options);
		},
		commit: (options) => writer.commit(options),
		commitOwned: (options) => writer.commitOwned(options),
		abort: () => writer.abort(),
	};
}

function assertOwnedScapeMediaWriter(writer) {
	if (!writer || typeof writer !== 'object' || typeof writer.commitOwned !== 'function') {
		throw new TypeError('A .scape media import requires an ownership-aware transactional writer.');
	}
}

function joinScapeTimingChunks(chunks, expectedBytes) {
	const output = new Uint8Array(expectedBytes);
	let offset = 0;
	for (const chunk of chunks) {
		if (!(chunk instanceof Uint8Array) || chunk.byteLength > output.byteLength - offset) {
			throw new Error('The .scape timing asset exceeded its admitted byte length.');
		}
		output.set(chunk, offset);
		offset += chunk.byteLength;
	}
	if (offset !== output.byteLength) throw new Error('The .scape timing asset ended before its admitted byte length.');
	return output;
}

/**
 * @param {import('./scape-project-input.ts').ScapeProjectInput} input
 * @param {{ loadProject?: (
 *   projectId: string,
 *   options?: Readonly<{ signal?: AbortSignal }>,
 * ) => PromiseLike<unknown> | unknown } | null} store
 * @param {{ signal?: AbortSignal,
 *   migrateProject?: (project: unknown) => { project: Record<string, unknown>, readOnly: boolean },
 *   currentProjectSchemaVersion?: number,
 *   projectFeatureCompatibility?: { evaluate: (project: unknown) => unknown },
 * }} options
 * @param {{ retain?: (settlement: PromiseLike<unknown>) => void }} retention
 */
export async function inspectScapeProject(input, store = null, options = {}, retention = {}) {
	const signal = options.signal;
	return withScapeProjectInput(input, signal, async (entries) => {
		const { manifest, projectText } = await readScapeArchiveEnvelope(
			entries,
			options.archiveLimits || {},
			signal,
		);
		verifyScapeAssetBytes(TEXT_ENCODER.encode(projectText), manifest.project, 'project document');
		throwIfScapeAborted(signal);
		const loaded = migrateScapeProjectDocument(projectText, options);
		indexScapeProjectAssets(loaded.project, manifest, {
			currentProjectSchemaVersion: scapeCurrentProjectSchemaVersion(options),
		});
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
	}, {
		blob: options.archiveReaderFactory,
		byteSource: options.archiveByteSourceReaderFactory,
	});
}

/** Select a product-owned exact schema without changing the shared default. */
function migrateScapeProjectDocument(projectText, options) {
	const migrateProject = options?.migrateProject ?? migrateAudioEditorProject;
	if (typeof migrateProject !== 'function') {
		throw new TypeError('The .scape project migration owner must be a function.');
	}
	const loaded = migrateProject(parseScapeProjectDocument(projectText));
	if (!loaded || typeof loaded !== 'object' || !loaded.project || typeof loaded.project !== 'object') {
		throw new TypeError('The .scape project migration owner returned an invalid result.');
	}
	if (typeof loaded.readOnly !== 'boolean') {
		throw new TypeError('The .scape project migration result requires a readOnly decision.');
	}
	return loaded;
}

function scapeCurrentProjectSchemaVersion(options) {
	const value = options?.currentProjectSchemaVersion ?? AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION;
	if (!Number.isSafeInteger(value) || value < 1) {
		throw new TypeError('The .scape current project schema version must be a positive safe integer.');
	}
	return value;
}
