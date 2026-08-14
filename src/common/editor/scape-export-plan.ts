/* SPDX-License-Identifier: AGPL-3.0-only */

import { awaitScapeOperation, throwIfScapeAborted } from './scape-abort.ts';
import {
	SCAPE_ARCHIVE_LIMITS,
	SCAPE_FORMAT,
	SCAPE_FORMAT_VERSION,
	SCAPE_MANIFEST_ENTRY,
	SCAPE_PROJECT_ENTRY,
	type ScapeAssetDescriptor,
	type ScapeManifest,
	type ScapeProjectDescriptor,
} from './scape-archive-envelope.ts';
import {
	createScapeAudioExportChunkBudget,
	digestScapeBytes,
	safeScapeEntryId,
	scapeAudioSourceLayout,
	type ScapeAudioSource,
} from './scape-archive-media.ts';
import { type ScapeAudioChunkBudget } from './scape-expanded-byte-budget.ts';
import {
	maximumScapeStoreArchiveBytes,
	resolveScapeBlobMaximumBytes,
} from './scape-export-estimate.ts';
import {
	assertScapeProjectFallbackAssets,
	snapshotScapeProjectFallbackIntegrity,
	type ScapeProjectFallbackClaim,
} from './scape-project-assets.ts';
import { serializeScapeProjectDocument } from './scape-project-document.ts';
import {
	normalizeVideoTimingAssetReference,
	type VideoTimingAssetReference,
} from './video-timing-asset.ts';

const AUDIO_ENCODING = 'audio-f32le-chunks-v1';
const PLACEHOLDER_SHA256 = '0'.repeat(64);
const TEXT_ENCODER = new TextEncoder();

interface ScapeExportSource extends Partial<ScapeAudioSource> {
	readonly kind?: string;
	readonly id?: string;
	readonly storageKey?: string;
	readonly name?: string;
	readonly mimeType?: string;
	readonly timingAsset?: unknown;
	readonly contentSha256?: unknown;
}

interface ScapeExportProject extends Record<string, unknown> {
	schemaVersion?: unknown;
	sources?: readonly ScapeExportSource[];
	featureRequirements?: unknown;
}

interface ScapeExportMetadataStore {
	getMediaAssetMetadata?(sourceId: string): PromiseLike<unknown> | unknown;
}

export interface PlannedScapeExportAsset {
	readonly source: ScapeExportSource;
	readonly sourceId: string;
	readonly storageKey: string;
	readonly kind: 'audio' | 'video' | 'video-timing';
	readonly entry: string;
	readonly encoding: string;
	readonly mimeType: string;
	readonly size: number;
	readonly expectedSha256?: string;
	readonly timingReference?: Readonly<VideoTimingAssetReference>;
}

export interface ScapeExportPlan {
	readonly projectBytes: Uint8Array;
	readonly projectDescriptor: ScapeProjectDescriptor;
	readonly createdAt: string;
	readonly assets: readonly PlannedScapeExportAsset[];
	readonly fallbackClaims: readonly ScapeProjectFallbackClaim[];
	readonly manifestBytes: number;
	readonly maximumArchiveBytes: number;
	readonly maximumBlobBytes: number;
	readonly audioChunkBudget: ScapeAudioChunkBudget;
}

export interface ScapeExportPlanOptions {
	readonly maximumBlobBytes?: unknown;
	readonly output: 'blob' | 'stream';
	readonly signal?: AbortSignal;
	readonly currentProjectSchemaVersion?: number;
}

export async function prepareScapeExport(
	projectInput: unknown,
	store: ScapeExportMetadataStore,
	options: ScapeExportPlanOptions,
): Promise<Readonly<ScapeExportPlan>> {
	if (!isRecord(projectInput)) throw new TypeError('A project is required.');
	const project = snapshotScapeExportProject(projectInput);
	const projectSchemaVersion = positiveSafeInteger(project.schemaVersion, 'Project schema version');
	const sourceInputs = project.sources ?? [];
	if (!Array.isArray(sourceInputs)) throw new TypeError('Project sources must be an array.');
	const sourceCount = sourceInputs.length;
	const sources: ScapeExportSource[] = [];
	for (let index = 0; index < sourceCount; index += 1) {
		sources.push(snapshotScapeExportSource(sourceInputs[index], index, projectSchemaVersion));
	}
	const timingStorageKeys = new Set(sources.flatMap((source) => (
		source.kind === 'video' && isRecord(source.timingAsset)
			? [normalizeVideoTimingAssetReference(source.timingAsset).storageKey]
			: []
	)));
	if (sourceCount + timingStorageKeys.size + 2 > SCAPE_ARCHIVE_LIMITS.maximumEntryCount) {
		throw new RangeError('The project has too many sources for the portable archive.');
	}
	project.sources = Object.freeze(sources);
	const maximumBlobBytes = resolveScapeBlobMaximumBytes(options.maximumBlobBytes);
	const audioChunkBudget = createScapeAudioExportChunkBudget(sources);
	const signal = options.signal;
	throwIfScapeAborted(signal);
	const fallbackSnapshot = snapshotScapeProjectFallbackIntegrity(project, {
		currentProjectSchemaVersion: options.currentProjectSchemaVersion,
	});
	if (fallbackSnapshot.featureRequirements) {
		project.featureRequirements = fallbackSnapshot.featureRequirements;
	}
	const projectText = serializeScapeProjectDocument(project);
	const projectBytes = TEXT_ENCODER.encode(projectText);
	if (projectBytes.byteLength > SCAPE_ARCHIVE_LIMITS.maximumProjectBytes) {
		throw new RangeError('project.json exceeds the metadata limit.');
	}
	const projectDescriptor: ScapeProjectDescriptor = Object.freeze({
		entry: SCAPE_PROJECT_ENTRY,
		mimeType: 'application/json',
		schemaVersion: projectSchemaVersion,
		size: projectBytes.byteLength,
		sha256: digestScapeBytes(projectBytes),
	});
	const assets: PlannedScapeExportAsset[] = [];
	const sourceIds = new Set<string>();
	const entryNames = new Set<string>([SCAPE_PROJECT_ENTRY, SCAPE_MANIFEST_ENTRY]);
	const timingAssetByStorageKey = new Map<string, PlannedScapeExportAsset>();
	for (const source of sources) {
		throwIfScapeAborted(signal);
		const sourceId = nonEmptyString(source?.id, 'Scape source ID');
		if (sourceIds.has(sourceId)) throw new Error(`Duplicate Scape source ID: ${sourceId}.`);
		sourceIds.add(sourceId);
		const kind = source.kind === 'video' ? 'video' : 'audio';
		const entry = kind === 'video'
			? `media/${safeScapeEntryId(sourceId)}/original`
			: `audio/${safeScapeEntryId(sourceId)}.f32c`;
		if (entryNames.has(entry)) throw new Error(`Duplicate Scape archive entry: ${entry}.`);
		entryNames.add(entry);
		const storageKey = nonEmptyString(source.storageKey || sourceId, `Storage key for ${sourceId}`);
		let size: number;
		let expectedSha256: string | undefined;
		if (kind === 'video') {
			if (typeof store?.getMediaAssetMetadata !== 'function') {
				throw new TypeError('A project store with media metadata is required for video export.');
			}
			const metadata = await awaitScapeOperation(store.getMediaAssetMetadata(storageKey), signal);
			if (!isRecord(metadata)) throw new Error(`Media source ${source.name || sourceId} is unavailable.`);
			size = nonNegativeSafeInteger(metadata.size, `Media source ${sourceId} size`);
			if (source.contentSha256 !== undefined) {
				expectedSha256 = sha256Digest(source.contentSha256, `Media source ${sourceId} content digest`);
				if (metadata.sha256 !== expectedSha256) {
					throw new Error(`Media source ${source.name || sourceId} does not match its source content digest.`);
				}
			}
		} else {
			size = scapeAudioSourceLayout(source as ScapeAudioSource).archiveBytes;
		}
		assets.push(Object.freeze({
			source,
			sourceId,
			storageKey,
			kind,
			entry,
			encoding: kind === 'video' ? 'original' : AUDIO_ENCODING,
			mimeType: String(source.mimeType || ''),
			size,
			expectedSha256,
		}));
		if (kind === 'video' && isRecord(source.timingAsset)) {
			const reference = normalizeVideoTimingAssetReference(source.timingAsset);
			const timingStorageKey = reference.storageKey;
			const timingSha256 = reference.sha256;
			const timingEntry = `timing/${safeScapeEntryId(timingSha256)}.scti`;
			const existingTimingAsset = timingAssetByStorageKey.get(timingStorageKey);
			if (existingTimingAsset) {
				if (!sameTimingReference(existingTimingAsset.timingReference, reference)) {
					throw new Error(`Video sources sharing timing asset ${timingStorageKey} have conflicting references.`);
				}
				continue;
			}
			if (entryNames.has(timingEntry)) throw new Error(`Duplicate Scape archive entry: ${timingEntry}.`);
			entryNames.add(timingEntry);
			if (typeof store?.getMediaAssetMetadata !== 'function') throw new TypeError('A media store is required for timing export.');
			const timingMetadata = await awaitScapeOperation(store.getMediaAssetMetadata(timingStorageKey), signal);
			if (!isRecord(timingMetadata)) throw new Error(`Timing asset for ${source.name || sourceId} is unavailable.`);
			const timingSize = nonNegativeSafeInteger(timingMetadata.size, `Timing asset ${sourceId} size`);
			if (timingMetadata.sha256 !== timingSha256 || timingSize !== reference.byteLength) {
				throw new Error(`Timing asset for ${source.name || sourceId} disagrees with its project reference.`);
			}
			const timingAsset = Object.freeze({
				source,
				sourceId: timingStorageKey,
				storageKey: timingStorageKey,
				kind: 'video-timing',
				entry: timingEntry,
				encoding: String(reference.encoding),
				mimeType: 'application/vnd.soundscaper.video-timing',
				size: timingSize,
				expectedSha256: timingSha256,
				timingReference: reference,
			});
			assets.push(timingAsset);
			timingAssetByStorageKey.set(timingStorageKey, timingAsset);
		}
	}
	const createdAt = new Date().toISOString();
	const placeholderAssets = assets.map((asset) => completeScapeExportAsset(
		asset,
		PLACEHOLDER_SHA256,
	));
	const placeholderManifest = createManifest(createdAt, projectDescriptor, placeholderAssets);
	const manifestBytes = TEXT_ENCODER.encode(JSON.stringify(placeholderManifest)).byteLength;
	if (manifestBytes > SCAPE_ARCHIVE_LIMITS.maximumManifestBytes) {
		throw new RangeError('manifest.json exceeds the metadata limit.');
	}
	assertExpandedBytes(projectBytes.byteLength, assets, manifestBytes);
	const maximumArchiveBytes = maximumScapeStoreArchiveBytes([
		{ filename: SCAPE_PROJECT_ENTRY, payloadBytes: projectBytes.byteLength },
		...assets.map((asset) => ({ filename: asset.entry, payloadBytes: asset.size })),
		{ filename: SCAPE_MANIFEST_ENTRY, payloadBytes: manifestBytes },
	]);
	if (options.output === 'blob' && maximumArchiveBytes > maximumBlobBytes) {
		throw new RangeError(
			`The Scape archive exceeds the ${String(maximumBlobBytes)}-byte final Blob assembly limit.`,
		);
	}
	return Object.freeze({
		projectBytes,
		projectDescriptor,
		createdAt,
		assets: Object.freeze(assets),
		fallbackClaims: fallbackSnapshot.claims,
		manifestBytes,
		maximumArchiveBytes,
		maximumBlobBytes,
		audioChunkBudget,
	});
}

export function completeScapeExportAsset(
	asset: PlannedScapeExportAsset,
	sha256: string,
): ScapeAssetDescriptor {
	if (!/^[a-f0-9]{64}$/u.test(sha256)) throw new TypeError('A Scape export asset has an invalid SHA-256 digest.');
	return {
		sourceId: asset.sourceId,
		kind: asset.kind,
		entry: asset.entry,
		encoding: asset.encoding,
		mimeType: asset.mimeType,
		size: asset.size,
		sha256,
	};
}

export function serializeScapeExportManifest(
	plan: ScapeExportPlan,
	assets: readonly ScapeAssetDescriptor[],
): Readonly<{ manifest: ScapeManifest; text: string }> {
	if (assets.length !== plan.assets.length) throw new Error('The Scape export manifest is missing planned assets.');
	for (const [index, descriptor] of assets.entries()) {
		const planned = plan.assets[index];
		if (!planned
			|| descriptor.sourceId !== planned.sourceId
			|| descriptor.kind !== planned.kind
			|| descriptor.entry !== planned.entry
			|| descriptor.encoding !== planned.encoding
			|| descriptor.mimeType !== planned.mimeType
			|| descriptor.size !== planned.size
			|| !/^[a-f0-9]{64}$/u.test(descriptor.sha256)
			|| (planned.expectedSha256 !== undefined && descriptor.sha256 !== planned.expectedSha256)) {
			throw new Error('The Scape export manifest drifted from its admitted plan or expected body digest.');
		}
	}
	assertScapeProjectFallbackAssets(
		plan.fallbackClaims,
		new Map(assets.map((asset) => [asset.sourceId, asset])),
	);
	const manifest = createManifest(plan.createdAt, plan.projectDescriptor, assets);
	const text = JSON.stringify(manifest);
	if (TEXT_ENCODER.encode(text).byteLength !== plan.manifestBytes) {
		throw new Error('The Scape export manifest changed size after archive admission.');
	}
	return Object.freeze({ manifest, text });
}

export function assertScapeExportBlob(plan: ScapeExportPlan, blob: Blob): void {
	if (!(blob instanceof Blob)) throw new TypeError('The Scape archive writer did not produce a Blob.');
	if (blob.size > plan.maximumArchiveBytes) {
		throw new Error('The Scape archive exceeded its admitted STORE/Zip64 upper bound.');
	}
	if (blob.size > plan.maximumBlobBytes) {
		throw new RangeError('The Scape archive exceeded the final Blob assembly limit.');
	}
}

function createManifest(
	createdAt: string,
	project: ScapeProjectDescriptor,
	assets: readonly ScapeAssetDescriptor[],
): ScapeManifest {
	return {
		format: SCAPE_FORMAT,
		formatVersion: SCAPE_FORMAT_VERSION,
		createdAt,
		project,
		assets: [...assets],
	};
}

function assertExpandedBytes(
	projectBytes: number,
	assets: readonly PlannedScapeExportAsset[],
	manifestBytes: number,
): void {
	let total = BigInt(projectBytes) + BigInt(manifestBytes);
	for (const asset of assets) total += BigInt(asset.size);
	if (total > BigInt(SCAPE_ARCHIVE_LIMITS.maximumExpandedBytes)) {
		throw new RangeError('The Scape archive exceeds the portable expanded-byte limit.');
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function snapshotScapeExportProject(value: Record<string, unknown>): ScapeExportProject {
	return snapshotScapeExportRecord(value, 'Project') as ScapeExportProject;
}

function snapshotScapeExportSource(
	value: unknown,
	index: number,
	projectSchemaVersion: number,
): ScapeExportSource {
	const label = `Project source ${String(index + 1)}`;
	if (!isRecord(value)) throw new TypeError(`${label} must be an object.`);
	const snapshot = snapshotScapeExportRecord(
		value,
		label,
	) as ScapeExportSource;
	if (snapshot.kind === undefined) Reflect.set(snapshot, 'kind', 'audio');
	if (snapshot.kind !== 'audio' && snapshot.kind !== 'video') {
		throw new TypeError(`${label} kind must be audio or video.`);
	}
	if (projectSchemaVersion < 4 && snapshot.kind === 'video') {
		throw new TypeError(`${label} cannot be video in project schema ${String(projectSchemaVersion)}.`);
	}
	if (snapshot.kind !== 'video') {
		const layout = scapeAudioSourceLayout(snapshot as ScapeAudioSource);
		if (layout.frameCount < 1) throw new RangeError(`${label} must contain at least one frame.`);
		Reflect.set(snapshot, 'frameCount', layout.frameCount);
		Reflect.set(snapshot, 'channelCount', layout.channelCount);
		Reflect.set(snapshot, 'chunkFrames', layout.chunkFrames);
	}
	return Object.freeze(snapshot);
}

function snapshotScapeExportRecord(value: Record<string, unknown>, label: string): Record<string, unknown> {
	const snapshot = Object.create(null) as Record<string, unknown>;
	for (const key of Object.keys(value)) {
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${label} property ${key} accessors are not supported by portable export.`);
		}
		Object.defineProperty(snapshot, key, {
			value: descriptor.value,
			enumerable: true,
			configurable: true,
			writable: true,
		});
	}
	if (typeof snapshot.toJSON === 'function') {
		throw new TypeError(`${label} toJSON hooks are not supported by portable export.`);
	}
	return snapshot;
}

function nonEmptyString(value: unknown, field: string): string {
	if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${field} is required.`);
	return value;
}

function positiveSafeInteger(value: unknown, field: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1) {
		throw new RangeError(`${field} must be a positive safe integer.`);
	}
	return Number(value);
}

function nonNegativeSafeInteger(value: unknown, field: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) {
		throw new RangeError(`${field} must be a safe non-negative integer.`);
	}
	return Number(value);
}

function sha256Digest(value: unknown, field: string): string {
	if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) {
		throw new TypeError(`${field} must be a lowercase SHA-256 digest.`);
	}
	return value;
}

function sameTimingReference(
	left: Readonly<VideoTimingAssetReference> | undefined,
	right: Readonly<VideoTimingAssetReference>,
): boolean {
	return Boolean(left
		&& left.encoding === right.encoding
		&& left.storageKey === right.storageKey
		&& left.sha256 === right.sha256
		&& left.byteLength === right.byteLength
		&& left.frameCount === right.frameCount
		&& left.timescale === right.timescale
		&& left.finalFrameDurationTicks === right.finalFrameDurationTicks);
}
