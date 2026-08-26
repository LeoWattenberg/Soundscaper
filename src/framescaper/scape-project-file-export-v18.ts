/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ZipWriter as ZipWriterType } from '@zip.js/zip.js';

import { awaitScapeOperation, throwIfScapeAborted } from '../common/editor/scape-abort.ts';
import {
	SCAPE_ARCHIVE_LIMITS,
	type ScapeAssetDescriptor,
	type ScapeProjectDescriptor,
} from '../common/editor/scape-archive-envelope.ts';
import {
	createScapeDigest,
	scapeAudioSourceStream,
	scapeBytesStream,
	scapeHashingStream,
	scapeHex,
} from '../common/editor/scape-archive-media.ts';
import { validateVideoTimingAssetBytes } from '../common/editor/video-timing-asset.ts';
import {
	maximumScapeStoreArchiveBytes,
	resolveScapeBlobMaximumBytes,
} from '../common/editor/scape-export-estimate.ts';
import {
	completeScapeExportAsset,
	prepareScapeExport,
	type PlannedScapeExportAsset,
} from '../common/editor/scape-export-plan.ts';
import { assertScapeProjectFallbackAssets } from '../common/editor/scape-project-assets.ts';
import { canonicalMediaContentBlob } from '../common/editor/storage/media-content-digest.ts';
import type { EditorProjectRuntimeProfile } from '../common/editor/project-runtime-profile.ts';
import { assertFramescaperScapeFallbackAssetsV18 } from './scape-project-file-fallback-v18.ts';
import { cloneFramescaperProjectV18 } from './editor-project-v18.ts';
import type {
	FramescaperScapeArchiveBodyStoreV18,
	FramescaperScapeArchiveExportAssetV18,
} from './scape-project-preservation-v18.ts';
import type {
	FramescaperScapeAssetDescriptorV18,
	FramescaperScapeManifestV18,
} from './scape-project-file-envelope-v18.ts';

export const FRAMESCAPER_SCAPE_MIME_TYPE_V18 = 'application/vnd.soundscaper.scape+zip';

export interface FramescaperScapeFileExportStoreV18 extends FramescaperScapeArchiveBodyStoreV18 {
	readSourceChunks?(
		sourceId: string,
		options?: Readonly<{ signal?: AbortSignal }>,
	): AsyncIterable<readonly Float32Array[] | Readonly<{ channels?: readonly Float32Array[] }>>;
}

export interface FramescaperScapeFileExportOptionsV18 {
	readonly signal?: AbortSignal;
	readonly writable?: WritableStream<Uint8Array>;
	readonly createWritable?: (
		maximumArchiveBytes: number,
	) => PromiseLike<WritableStream<Uint8Array>> | WritableStream<Uint8Array>;
	readonly maximumBlobBytes?: number;
}

export interface FramescaperScapeFileExportResultV18 {
	readonly blob: Blob | null;
	readonly manifest: FramescaperScapeManifestV18;
	readonly byteLength: number;
}

interface ArchiveExportOwner {
	exportProject(
		project: unknown,
		options?: Readonly<{ signal?: AbortSignal }>,
	): Promise<Readonly<{
		formatVersion: 1 | 2;
		assets: readonly Readonly<FramescaperScapeArchiveExportAssetV18>[];
	}>>;
}

const EMPTY_DIGEST = '0'.repeat(64);
const TEXT_ENCODER = new TextEncoder();

export async function exportFramescaperScapeProjectFileV18(
	profile: EditorProjectRuntimeProfile | unknown,
	project: unknown,
	store: FramescaperScapeFileExportStoreV18,
	archive: ArchiveExportOwner,
	options: FramescaperScapeFileExportOptionsV18 = {},
): Promise<Readonly<FramescaperScapeFileExportResultV18>> {
	const normalized = exportOptions(options);
	const { signal } = normalized;
	const snapshot = cloneFramescaperProjectV18(profile, project);
	throwIfScapeAborted(signal);
	const plan = await prepareScapeExport(snapshot, store, {
		maximumBlobBytes: normalized.maximumBlobBytes,
		output: normalized.writable || normalized.createWritable ? 'stream' : 'blob',
		...(signal ? { signal } : {}),
	});
	const extension = await archive.exportProject(snapshot, signal ? { signal } : {});
	const merged = mergeDescriptors(plan.assets, extension.assets);
	const placeholderManifest = manifestValue(
		extension.formatVersion,
		plan.createdAt,
		plan.projectDescriptor,
		merged.placeholder,
	);
	const manifestBytes = TEXT_ENCODER.encode(JSON.stringify(placeholderManifest)).byteLength;
	assertArchiveAdmission(plan.projectBytes.byteLength, merged.placeholder, manifestBytes);
	const maximumArchiveBytes = maximumScapeStoreArchiveBytes([
		{ filename: 'project.json', payloadBytes: plan.projectBytes.byteLength },
		...merged.placeholder.map((asset) => ({ filename: asset.entry, payloadBytes: asset.size })),
		{ filename: 'manifest.json', payloadBytes: manifestBytes },
	]);
	const maximumBlobBytes = resolveScapeBlobMaximumBytes(normalized.maximumBlobBytes);
	if (!normalized.writable && !normalized.createWritable && maximumArchiveBytes > maximumBlobBytes) {
		throw new RangeError(`The Scape archive exceeds the ${String(maximumBlobBytes)}-byte final Blob assembly limit.`);
	}
	const media = await loadCanonicalMedia(plan.assets, store, signal);
	const writable = normalized.createWritable
		? await awaitScapeOperation(normalized.createWritable(maximumArchiveBytes), signal)
		: normalized.writable;
	if (writable && typeof writable.getWriter !== 'function') {
		throw new TypeError('The Framescaper Scape destination is not writable.');
	}
	const [
		{ TextReader, ZipWriter },
		{ createScapeExportDestination },
	] = await Promise.all([
		import('@zip.js/zip.js'),
		import('../common/editor/scape-export-destination.ts'),
	]);
	const destination = createScapeExportDestination(
		writable,
		FRAMESCAPER_SCAPE_MIME_TYPE_V18,
		maximumArchiveBytes,
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
	let blob: Blob | null;
	let manifest: FramescaperScapeManifestV18;
	try {
		await awaitScapeOperation(writer.add('project.json', scapeBytesStream(plan.projectBytes), {
			level: 0, zip64: true, signal,
		}), signal);
		const assets: FramescaperScapeAssetDescriptorV18[] = [];
		const canonicalAssets: ScapeAssetDescriptor[] = [];
		for (const planned of plan.assets) {
			const descriptor = await writeCanonical(writer, planned, store, media, plan.audioChunkBudget, signal);
			assets.push(descriptor);
			canonicalAssets.push(descriptor as ScapeAssetDescriptor);
		}
		for (const extensionAsset of merged.extensionToWrite) {
			assets.push(await writeExtension(writer, extensionAsset, signal));
		}
		assertScapeProjectFallbackAssets(
			plan.fallbackClaims,
			new Map(canonicalAssets.map((asset) => [asset.sourceId, asset])),
		);
		assertFramescaperScapeFallbackAssetsV18(profile, snapshot, canonicalAssets);
		manifest = manifestValue(extension.formatVersion, plan.createdAt, plan.projectDescriptor, assets);
		const manifestText = JSON.stringify(manifest);
		if (TEXT_ENCODER.encode(manifestText).byteLength !== manifestBytes) {
			throw new Error('The Framescaper Scape manifest changed size after archive admission.');
		}
		await awaitScapeOperation(writer.add('manifest.json', new TextReader(manifestText), {
			level: 0, zip64: true, signal,
		}), signal);
		blob = await destination.finish(writer, signal);
	} catch (error) {
		return destination.abort(writer, error);
	}
	if (blob && (blob.size > maximumArchiveBytes || blob.size > maximumBlobBytes)) {
		throw new RangeError('The Framescaper Scape Blob exceeded its admitted maximum.');
	}
	return Object.freeze({ blob, manifest, byteLength: destination.byteLength });
}

async function loadCanonicalMedia(
	assets: readonly PlannedScapeExportAsset[],
	store: FramescaperScapeFileExportStoreV18,
	signal?: AbortSignal,
): Promise<ReadonlyMap<string, Blob>> {
	const media = new Map<string, Blob>();
	for (const asset of assets) {
		if (asset.kind === 'audio') continue;
		throwIfScapeAborted(signal);
		const loaded = await awaitScapeOperation(
			store.loadMediaAsset(asset.storageKey, signal ? { signal } : {}),
			signal,
		);
		if (!loaded) throw new Error(`Media source ${asset.source.name ?? asset.sourceId} is unavailable.`);
		const body = canonicalMediaContentBlob(loaded);
		if (body.size !== asset.size) throw new Error(`Media source ${asset.sourceId} changed after admission.`);
		if (asset.kind === 'video-timing') {
			validateVideoTimingAssetBytes(asset.timingReference!, new Uint8Array(await body.arrayBuffer()));
		}
		media.set(asset.sourceId, body);
	}
	return media;
}

async function writeCanonical(
	writer: ZipWriterType<unknown>,
	asset: PlannedScapeExportAsset,
	store: FramescaperScapeFileExportStoreV18,
	media: ReadonlyMap<string, Blob>,
	audioChunkBudget: Parameters<typeof scapeAudioSourceStream>[5],
	signal?: AbortSignal,
): Promise<FramescaperScapeAssetDescriptorV18> {
	throwIfScapeAborted(signal);
	const digest = createScapeDigest();
	let size = 0;
	if (asset.kind === 'audio') {
		if (typeof store.readSourceChunks !== 'function') {
			throw new TypeError('The V18 Scape store requires audio chunk reads for audio export.');
		}
		const stream = scapeAudioSourceStream(
			store as Required<Pick<FramescaperScapeFileExportStoreV18, 'readSourceChunks'>>,
			asset.source as Parameters<typeof scapeAudioSourceStream>[1],
			digest,
			(bytes) => { size += bytes; },
			signal,
			audioChunkBudget,
		);
		await awaitScapeOperation(writer.add(asset.entry, stream, { level: 0, zip64: true, signal }), signal);
	} else {
		const body = media.get(asset.sourceId);
		if (!body) throw new Error(`Media source ${asset.sourceId} is unavailable.`);
		size = body.size;
		await awaitScapeOperation(writer.add(
			asset.entry,
			scapeHashingStream(body.stream(), digest, signal),
			{ level: 0, zip64: true, signal },
		), signal);
	}
	if (size !== asset.size) throw new Error(`Source ${asset.sourceId} changed size during Scape export.`);
	return Object.freeze(
		completeScapeExportAsset(asset, scapeHex(digest.digest())),
	) as FramescaperScapeAssetDescriptorV18;
}

async function writeExtension(
	writer: ZipWriterType<unknown>,
	asset: Readonly<FramescaperScapeArchiveExportAssetV18>,
	signal?: AbortSignal,
): Promise<FramescaperScapeAssetDescriptorV18> {
	const digest = createScapeDigest();
	if (asset.body.size !== asset.descriptor.size) throw new Error('A V18 archive extension body changed size.');
	await awaitScapeOperation(writer.add(
		asset.descriptor.entry,
		scapeHashingStream(asset.body.stream(), digest, signal),
		{ level: 0, zip64: true, signal },
	), signal);
	if (scapeHex(digest.digest()) !== asset.descriptor.sha256) {
		throw new Error('A V18 archive extension body changed digest.');
	}
	return asset.descriptor as FramescaperScapeAssetDescriptorV18;
}

function mergeDescriptors(
	canonical: readonly PlannedScapeExportAsset[],
	extension: readonly Readonly<FramescaperScapeArchiveExportAssetV18>[],
): Readonly<{
	placeholder: readonly FramescaperScapeAssetDescriptorV18[];
	extensionToWrite: readonly Readonly<FramescaperScapeArchiveExportAssetV18>[];
}> {
	const placeholder = canonical.map((asset) => completeScapeExportAsset(
		asset, asset.expectedSha256 ?? EMPTY_DIGEST,
	) as FramescaperScapeAssetDescriptorV18);
	const byEntry = new Map(placeholder.map((asset) => [asset.entry, asset]));
	const bySource = new Map(placeholder.map((asset) => [asset.sourceId, asset]));
	const extensionToWrite: FramescaperScapeArchiveExportAssetV18[] = [];
	for (const item of extension) {
		const entryDuplicate = byEntry.get(item.descriptor.entry);
		const sourceDuplicate = bySource.get(item.descriptor.sourceId);
		if (entryDuplicate || sourceDuplicate) {
			if (!entryDuplicate || !sourceDuplicate || entryDuplicate !== sourceDuplicate
				|| !sameDescriptor(entryDuplicate, item.descriptor)) {
				throw new Error(`Conflicting V18 Scape archive entry: ${item.descriptor.entry}.`);
			}
			continue;
		}
		const descriptor = item.descriptor as FramescaperScapeAssetDescriptorV18;
		placeholder.push(descriptor);
		byEntry.set(descriptor.entry, descriptor);
		bySource.set(descriptor.sourceId, descriptor);
		extensionToWrite.push(item);
	}
	return Object.freeze({
		placeholder: Object.freeze(placeholder),
		extensionToWrite: Object.freeze(extensionToWrite),
	});
}

function sameDescriptor(
	left: FramescaperScapeAssetDescriptorV18,
	right: Readonly<Record<string, unknown>>,
): boolean {
	return ['sourceId', 'kind', 'encoding', 'entry', 'mimeType', 'size', 'sha256']
		.every((field) => left[field] === right[field]);
}

function manifestValue(
	formatVersion: 1 | 2,
	createdAt: string,
	project: ScapeProjectDescriptor,
	assets: readonly FramescaperScapeAssetDescriptorV18[],
): FramescaperScapeManifestV18 {
	return Object.freeze({
		format: 'scape-project' as const,
		formatVersion,
		createdAt,
		project: project as FramescaperScapeManifestV18['project'],
		assets: Object.freeze([...assets]),
	}) as FramescaperScapeManifestV18;
}

function assertArchiveAdmission(
	projectBytes: number,
	assets: readonly FramescaperScapeAssetDescriptorV18[],
	manifestBytes: number,
): void {
	if (assets.length + 2 > SCAPE_ARCHIVE_LIMITS.maximumEntryCount) {
		throw new RangeError('The Framescaper Scape archive contains too many entries.');
	}
	if (manifestBytes > SCAPE_ARCHIVE_LIMITS.maximumManifestBytes) {
		throw new RangeError('manifest.json exceeds the metadata limit.');
	}
	let expanded = BigInt(projectBytes) + BigInt(manifestBytes);
	for (const asset of assets) expanded += BigInt(asset.size);
	if (expanded > BigInt(SCAPE_ARCHIVE_LIMITS.maximumExpandedBytes)) {
		throw new RangeError('The Framescaper Scape archive exceeds the expanded-byte limit.');
	}
}

function exportOptions(value: FramescaperScapeFileExportOptionsV18): FramescaperScapeFileExportOptionsV18 {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('V18 Scape export options must be a record.');
	const allowed = new Set(['signal', 'writable', 'createWritable', 'maximumBlobBytes']);
	if (Reflect.ownKeys(value).some((key) => typeof key !== 'string' || !allowed.has(key))) {
		throw new TypeError('V18 Scape export options have unsupported fields.');
	}
	if (value.signal !== undefined && !(value.signal instanceof AbortSignal)) throw new TypeError('A V18 Scape AbortSignal is required.');
	if (value.writable && value.createWritable) throw new TypeError('Choose one V18 Scape streaming destination.');
	if (value.createWritable !== undefined && typeof value.createWritable !== 'function') {
		throw new TypeError('The V18 Scape destination factory must be a function.');
	}
	return value;
}
