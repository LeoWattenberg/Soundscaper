import {
	TextReader,
	ZipWriter,
} from '@zip.js/zip.js';

import { createStableId } from './project.js';
import { isCurrentProjectSchemaIdentity } from './project-schema-identity.ts';
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
import { assertScapeImportStore, ScapeImportTransaction } from './scape-import-transaction.ts';
import { preflightScapeImportCapacity } from './scape-import-capacity.ts';
import { indexScapeProjectAssets, indexScapeProjectTimingAssets } from './scape-project-assets.ts';
import {
	loadScapeProjectDocument,
	resolveScapeCurrentProjectSchemaFamily,
	resolveScapeCurrentProjectSchemaVersion,
} from './scape-project-admission.ts';
import { withScapeProjectInput } from './scape-project-input.ts';
import { SCAPE_MIME_TYPE } from './scape-project-format.ts';
import { remapScapeProjectSourceReferences } from './scape-project-source-remap.ts';
import { prepareScapeImportSourceIdentities, resolveScapeProjectAssetExtension } from './scape-project-asset-extension.ts';
import { inspectScapeCanonicalEvidence } from './scape-project-canonical-inspection.ts';
import { canonicalMediaContentBlob } from './storage/media-content-digest.ts';
import {
	normalizeVideoTimingAssetReference,
	validateVideoTimingAssetBytes,
} from './video-timing-asset.ts';

export { SCAPE_FORMAT, SCAPE_FORMAT_VERSION, SCAPE_MIME_TYPE };
export { SCAPE_FILE_EXTENSION } from '../project-file-extensions.ts';

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
	const assetExtension = resolveScapeProjectAssetExtension(options.projectAssetExtension);
	if (writable && createWritable) throw new TypeError('Choose one Scape streaming destination.');
	if (createWritable !== undefined && typeof createWritable !== 'function') {
		throw new TypeError('The Scape destination factory must be a function.');
	}
	throwIfScapeAborted(signal);
	const additionalAssets = assetExtension ? await awaitScapeOperation(
		assetExtension.planExportAssets({ project, store, signal }), signal,
	) : [];
	const plan = await prepareScapeExport(project, store, {
		maximumBlobBytes: options.maximumBlobBytes,
		output: writable || createWritable ? 'stream' : 'blob',
		signal,
		currentProjectSchemaFamily: options.currentProjectSchemaFamily,
		currentProjectSchemaVersion: options.currentProjectSchemaVersion,
		additionalSourceKinds: assetExtension?.sourceKinds,
		additionalAssets,
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
			if (asset.timingReference) {
				validateVideoTimingAssetBytes(
					asset.timingReference,
					new Uint8Array(await mediaBlob.arrayBuffer()),
				);
			}
			if (assetExtension?.assetKinds.includes(asset.kind)) {
				await awaitScapeOperation(assetExtension.validateExportAssetBody(asset, mediaBlob, signal), signal);
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
	const assetExtension = resolveScapeProjectAssetExtension(options.projectAssetExtension);
	let transaction = null;
	try {
		const result = await withScapeProjectInput(input, signal, async (entries) => {
			const {
				entryByName,
				expandedByteBudget,
				manifest,
				projectText,
			} = await readScapeArchiveEnvelope(entries, options.archiveLimits || {}, signal,
				assetExtension?.assetKinds);
			const audioChunkBudget = new ScapeAudioChunkBudget();
			const projectBytes = TEXT_ENCODER.encode(projectText);
			verifyScapeAssetBytes(projectBytes, manifest.project, 'project document');
			throwIfScapeAborted(signal);
			const loaded = loadScapeProjectDocument(projectText, manifest.project, options);
			if (loaded.readOnly) {
				return { project: loaded.project, manifest, readOnly: true, reason: loaded.reason, collision: null };
			}
			let project = structuredClone(loaded.project);
			const archiveProject = structuredClone(project);
			const extensionValidation = assetExtension?.validateImportAssets(project, manifest) ?? null;
			const assetBySourceId = indexScapeProjectAssets(project, manifest, {
				currentProjectSchemaFamily: resolveScapeCurrentProjectSchemaFamily(options),
				currentProjectSchemaVersion: resolveScapeCurrentProjectSchemaVersion(options),
				additionalSourceKinds: assetExtension?.sourceKinds,
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
						throw new TypeError('A media store with timing-body reads is required for Scape import.');
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
				if (!entry) throw new Error(`The Scape archive is missing ${asset.entry}.`);
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
							'The Scape timing write and cleanup both failed.',
						);
					}
					throw error;
				}
			}

			const sourceIdMap = await prepareScapeImportSourceIdentities(project, store, assetExtension, signal);
			remapScapeProjectSourceReferences(project, sourceIdMap);
			if (isCurrentProjectSchemaIdentity(project, resolveScapeCurrentProjectSchemaFamily(options))) {
				if (options.rebindProjectSourceIdentities !== undefined) {
					if (typeof options.rebindProjectSourceIdentities !== 'function') {
						throw new TypeError('The Scape project source-identity rebinder must be a function.');
					}
					options.rebindProjectSourceIdentities(project, sourceIdMap);
				}
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
			assetExtension?.validateReboundProject(project);
			if (assetExtension) await awaitScapeOperation(assetExtension.stageImportAssets({ archiveProject,
				project, manifest, entryByName, expandedByteBudget, sourceIdMap,
				validation: extensionValidation, store, transaction, signal }), signal);
			assetExtension?.validateReboundProject(project);

			for (const [originalSourceId, finalSourceId] of sourceIdMap) {
				throwIfScapeAborted(signal);
				const asset = assetBySourceId.get(originalSourceId);
				if (!asset) continue;
				const source = project.sources.find((candidate) => candidate.id === finalSourceId);
				const entry = entryByName.get(asset.entry);
				if (!entry) throw new Error(`The Scape archive is missing ${asset.entry}.`);
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
							'The Scape media write and cleanup both failed.',
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
						// Retain the exact PCM generation before observing a cancellation
						// that can arrive concurrently with durable publication.
						let sourcePublication;
						try {
							sourcePublication = await sourceWriter.commit({
								sampleRate: source.sampleRate,
								channelCount: source.channelCount,
							}, { signal });
						} catch (commitError) {
							throwIfScapeAborted(signal);
							throw commitError;
						}
						transaction.trackProvisionalSource(sourcePublication);
						throwIfScapeAborted(signal);
					} catch (error) {
						try {
							await sourceWriter.abort();
						} catch (abortError) {
							throw aggregateScapeErrors(error, [abortError], 'The Scape source write and cleanup both failed.');
						}
						throw error;
					}
				}
			}
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
		if (transaction) await transaction.publishProject(result.project);
		return result;
	} catch (error) {
		if (transaction) return transaction.rollback(error);
		throw error;
	}
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
		throw new TypeError('A Scape media import requires an ownership-aware transactional writer.');
	}
}

function joinScapeTimingChunks(chunks, expectedBytes) {
	const output = new Uint8Array(expectedBytes);
	let offset = 0;
	for (const chunk of chunks) {
		if (!(chunk instanceof Uint8Array) || chunk.byteLength > output.byteLength - offset) {
			throw new Error('The Scape timing asset exceeded its admitted byte length.');
		}
		output.set(chunk, offset);
		offset += chunk.byteLength;
	}
	if (offset !== output.byteLength) throw new Error('The Scape timing asset ended before its admitted byte length.');
	return output;
}

/**
 * @param {import('./scape-project-input.ts').ScapeProjectInput} input
 * @param {{ loadProject?: (
 *   projectId: string,
 *   options?: Readonly<{ signal?: AbortSignal }>,
 * ) => PromiseLike<unknown> | unknown } | null} store
 * @param {{ signal?: AbortSignal,
 *   canonicalProjectDigest?: boolean, loadProject?: (project: unknown) => { project: Record<string, unknown>, readOnly: boolean },
 *   currentProjectSchemaFamily?: import('./project-schema-identity.ts').ProjectSchemaFamily,
 *   currentProjectSchemaVersion?: number,
 *   projectFeatureCompatibility?: { evaluate: (project: unknown) => unknown },
 *   projectAssetExtension?: import('./scape-project-asset-extension.ts').ScapeProjectAssetExtension,
 * }} options
 * @param {{ retain?: (settlement: PromiseLike<unknown>) => void }} retention
 */
export async function inspectScapeProject(input, store = null, options = {}, retention = {}) {
	const signal = options.signal;
	const assetExtension = resolveScapeProjectAssetExtension(options.projectAssetExtension);
	return withScapeProjectInput(input, signal, async (entries) => {
		const { manifest, projectText } = await readScapeArchiveEnvelope(entries,
			options.archiveLimits || {}, signal, assetExtension?.assetKinds);
		verifyScapeAssetBytes(TEXT_ENCODER.encode(projectText), manifest.project, 'project document');
		throwIfScapeAborted(signal);
		const loaded = loadScapeProjectDocument(projectText, manifest.project, options);
		if (!loaded.readOnly) {
			assetExtension?.validateImportAssets(loaded.project, manifest);
			indexScapeProjectAssets(loaded.project, manifest, {
				currentProjectSchemaFamily: resolveScapeCurrentProjectSchemaFamily(options),
				currentProjectSchemaVersion: resolveScapeCurrentProjectSchemaVersion(options),
				additionalSourceKinds: assetExtension?.sourceKinds,
			});
		}
		const featureRequirementsCompatibility = !loaded.readOnly && options.projectFeatureCompatibility
			? options.projectFeatureCompatibility.evaluate(loaded.project)
			: null;
		// Opaque foreign/future custody must not query a current-family store by
		// an id whose domain was deliberately not admitted.
		const existing = !loaded.readOnly && store?.loadProject
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
			schemaFamily: loaded.identity.schemaFamily,
			schemaVersion: loaded.project.schemaVersion,
			readOnly: loaded.readOnly,
			reason: loaded.reason,
			exists: Boolean(existing),
			manifest,
			featureRequirementsCompatibility,
			...inspectScapeCanonicalEvidence(
				options.canonicalProjectDigest && !loaded.readOnly ? loaded.project : null,
				options.canonicalProjectDigest && existing ? existing : null),
		});
	}, {
		blob: options.archiveReaderFactory,
		byteSource: options.archiveByteSourceReaderFactory,
	});
}
