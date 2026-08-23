/* SPDX-License-Identifier: AGPL-3.0-only */

import { awaitScapeOperation, throwIfScapeAborted } from '../common/editor/scape-abort.ts';
import type { ScapeAssetDescriptor, ScapeManifest } from '../common/editor/scape-archive-envelope.ts';
import { safeScapeEntryId } from '../common/editor/scape-archive-media.ts';
import type { PlannedScapeExportAsset } from '../common/editor/scape-export-plan.ts';
import { digestMediaContent } from '../common/editor/storage/media-content-digest.ts';
import {
	parseCubeLutV1,
	VIDEO_COLOR_LIMITS_V1,
	type VideoCubeLutReferenceV1,
} from '../common/editor/video-color-management-v27.ts';
import { requireVideoMotionAnalysisBodyV1 } from '../common/editor/video-motion-analysis-v27.ts';
import {
	VIDEO_MOTION_LIMITS_V1,
	type VideoMotionAnalysisReferenceV1,
	type VideoProcessorStackV1,
} from '../common/editor/video-motion-model-v27.ts';
import {
	VIDEO_PROXY_MAXIMUM_BODY_BYTES,
	type VideoProxyAttachmentV18,
} from '../common/editor/video-proxy-attachment-v18.ts';
import {
	VIDEO_TIMING_ASSET_MAXIMUM_BYTES,
	type VideoTimingAssetReference,
} from '../common/editor/video-timing-asset.ts';
import type { FramescaperProjectV27 } from './editor-project-v27.ts';

export const FRAMESCAPER_SCAPE_ASSET_KINDS_V27 = Object.freeze([
	'framescaper-still', 'framescaper-freeze-render', 'framescaper-video-proxy',
	'framescaper-proxy-timing', 'framescaper-cube-lut', 'framescaper-motion-analysis',
] as const);

export type FramescaperScapeAssetKindV27 = typeof FRAMESCAPER_SCAPE_ASSET_KINDS_V27[number];

type AssetRole = 'still' | 'freeze-render' | 'proxy' | 'proxy-timing' | 'lut' | 'motion';

export interface FramescaperScapeAssetReferenceV27 {
	readonly role: AssetRole;
	readonly archiveId: string;
	readonly kind: FramescaperScapeAssetKindV27;
	readonly encoding: string;
	readonly entry: string;
	readonly mimeType: string;
	readonly storageKey: string;
	readonly sha256: string;
	readonly byteLength: number | null;
	readonly maximumBytes: number;
	readonly sourceId: string | null;
	readonly timingReference: Readonly<VideoTimingAssetReference> | null;
	readonly lutReference: Readonly<VideoCubeLutReferenceV1> | null;
	readonly motionReference: Readonly<VideoMotionAnalysisReferenceV1> | null;
	readonly processorStack: Readonly<VideoProcessorStackV1> | null;
}

export interface FramescaperScapeImportValidationV27 {
	readonly references: readonly FramescaperScapeAssetReferenceV27[];
	readonly descriptorByArchiveId: ReadonlyMap<string, ScapeAssetDescriptor>;
}

interface MetadataStore {
	getMediaAssetMetadata(sourceId: string): PromiseLike<unknown> | unknown;
}

const MAXIMUM_STILL_BYTES = 512 * 1024 * 1024;
const STILL_MIME = /^image\/[a-z0-9][a-z0-9.+-]{0,126}$/u;
const MOTION_MIME = 'application/vnd.framescaper.motion-analysis+json';
const TIMING_MIME = 'application/vnd.soundscaper.video-timing';
const LUT_MIME = 'text/plain';
const SHA256 = /^[a-f0-9]{64}$/u;

export async function planFramescaperScapeExportAssetsV27(
	project: FramescaperProjectV27,
	store: MetadataStore,
	signal?: AbortSignal,
): Promise<readonly PlannedScapeExportAsset[]> {
	const references = collectFramescaperScapeAssetReferencesV27(project);
	const assets: PlannedScapeExportAsset[] = [];
	for (const reference of references) {
		throwIfScapeAborted(signal);
		const metadata = record(
			await awaitScapeOperation(store.getMediaAssetMetadata(reference.storageKey), signal),
			`V27 ${reference.role} archive metadata`,
		);
		const size = positiveInteger(metadata.size, `V27 ${reference.role} archive size`);
		if (size > reference.maximumBytes
			|| (reference.byteLength !== null && size !== reference.byteLength)
			|| metadata.sha256 !== reference.sha256) {
			throw new Error(`V27 ${reference.role} body ${reference.storageKey} is missing or stale.`);
		}
		const storedMime = String(metadata.mimeType ?? '');
		if (storedMime && storedMime !== reference.mimeType) {
			throw new Error(`V27 ${reference.role} body ${reference.storageKey} has a conflicting media type.`);
		}
		assets.push(Object.freeze({
			source: Object.freeze({
				name: `${reference.role}:${reference.archiveId}`,
				archiveReference: reference,
			}),
			sourceId: reference.archiveId,
			storageKey: reference.storageKey,
			kind: reference.kind,
			entry: reference.entry,
			encoding: reference.encoding,
			mimeType: reference.mimeType,
			size,
			expectedSha256: reference.sha256,
			...(reference.timingReference ? { timingReference: reference.timingReference } : {}),
		}));
	}
	return Object.freeze(assets);
}

export function validateFramescaperScapeImportAssetsV27(
	project: FramescaperProjectV27,
	manifest: ScapeManifest,
): Readonly<FramescaperScapeImportValidationV27> {
	const references = collectFramescaperScapeAssetReferencesV27(project);
	const kinds = new Set<string>(FRAMESCAPER_SCAPE_ASSET_KINDS_V27);
	const descriptors = manifest.assets.filter(({ kind }) => kinds.has(kind));
	if (descriptors.length !== references.length) {
		throw new Error('The V27 Scape archive has an incomplete durable finishing asset inventory.');
	}
	const descriptorByArchiveId = new Map<string, ScapeAssetDescriptor>();
	for (const descriptor of descriptors) {
		if (descriptorByArchiveId.has(descriptor.sourceId)) {
			throw new Error(`The V27 Scape asset ${descriptor.sourceId} is duplicated.`);
		}
		descriptorByArchiveId.set(descriptor.sourceId, descriptor);
	}
	for (const reference of references) {
		const descriptor = descriptorByArchiveId.get(reference.archiveId);
		if (!descriptor || descriptor.kind !== reference.kind
			|| descriptor.encoding !== reference.encoding || descriptor.entry !== reference.entry
			|| descriptor.mimeType !== reference.mimeType || descriptor.sha256 !== reference.sha256
			|| !Number.isSafeInteger(descriptor.size) || descriptor.size < 1
			|| descriptor.size > reference.maximumBytes
			|| (reference.byteLength !== null && descriptor.size !== reference.byteLength)) {
			throw new Error(`The V27 Scape ${reference.role} descriptor is missing or conflicts with project authority.`);
		}
	}
	return Object.freeze({ references, descriptorByArchiveId });
}

export async function validateFramescaperScapeExportAssetBodyV27(
	asset: PlannedScapeExportAsset,
	body: Blob,
	signal?: AbortSignal,
): Promise<void> {
	const reference = plannedReference(asset);
	if (body.size !== asset.size || body.size > reference.maximumBytes
		|| await digestMediaContent(body, { signal }) !== reference.sha256) {
		throw new Error(`The V27 ${reference.role} archive body changed after admission.`);
	}
	if (reference.role === 'lut' || reference.role === 'motion') {
		validateFramescaperScapeAssetReferenceBytesV27(
			reference, new Uint8Array(await body.arrayBuffer()),
		);
	}
}

export function validateFramescaperScapeAssetReferenceBytesV27(
	reference: FramescaperScapeAssetReferenceV27,
	bytes: Uint8Array,
): void {
	if (reference.role === 'lut') validateLut(reference, bytes);
	if (reference.role === 'motion') validateMotion(reference, bytes);
}

export function collectFramescaperScapeAssetReferencesV27(
	project: FramescaperProjectV27,
): readonly FramescaperScapeAssetReferenceV27[] {
	const references: FramescaperScapeAssetReferenceV27[] = [];
	const byArchiveId = new Map<string, FramescaperScapeAssetReferenceV27>();
	const byEntry = new Map<string, FramescaperScapeAssetReferenceV27>();
	const byStorageKey = new Map<string, FramescaperScapeAssetReferenceV27>();
	const freezeFallbacks = project.videoFreezeFallbacks as readonly Readonly<{ renderedSourceId: string }>[];
	const sources = project.sources as readonly Readonly<Record<string, unknown>>[];
	const freezeIds = new Set(freezeFallbacks.map(({ renderedSourceId }) => renderedSourceId));
	for (const source of sources) {
		if (source.kind === 'still') addReference(stillReference(source, freezeIds.has(String(source.id))), references,
			byArchiveId, byEntry, byStorageKey);
		if (source.kind !== 'video' || source.proxyAttachment === null) continue;
		const attachment = source.proxyAttachment as Readonly<VideoProxyAttachmentV18>;
		addReference(proxyReference(attachment), references, byArchiveId, byEntry, byStorageKey);
		addReference(proxyTimingReference(attachment.timingAsset), references, byArchiveId, byEntry, byStorageKey);
	}
	for (const lut of projectLuts(project)) {
		addReference(lutReference(lut), references, byArchiveId, byEntry, byStorageKey);
	}
	const stackById = new Map(project.videoProcessorStacks.map((stack) => [stack.id, stack]));
	for (const motion of project.videoMotionAnalyses) {
		const stack = stackById.get(motion.processorStackId);
		if (!stack) throw new Error(`V27 motion analysis ${motion.id} has no processor stack.`);
		addReference(motionReference(motion, stack), references, byArchiveId, byEntry, byStorageKey);
	}
	return Object.freeze(references);
}

function stillReference(
	source: Readonly<Record<string, unknown>>,
	freeze: boolean,
): FramescaperScapeAssetReferenceV27 {
	const sourceId = stableId(source.id, 'V27 still source ID');
	const mimeType = String(source.mimeType);
	if (!STILL_MIME.test(mimeType)) throw new TypeError(`V27 still ${sourceId} has an invalid media type.`);
	const role = freeze ? 'freeze-render' as const : 'still' as const;
	const digest = sha(source.contentSha256, `V27 ${role} digest`);
	return reference({
		role, archiveId: `framescaper-v27:${role}:${sourceId}`,
		kind: freeze ? 'framescaper-freeze-render' : 'framescaper-still',
		encoding: freeze ? 'freeze-render-v1' : 'still-image-v1',
		entry: `framescaper/v27/${freeze ? 'freeze' : 'still'}/${safeScapeEntryId(sourceId)}/body`,
		mimeType, storageKey: stableId(source.storageKey, `V27 ${role} storage key`),
		sha256: digest, byteLength: null, maximumBytes: MAXIMUM_STILL_BYTES,
		sourceId, timingReference: null, lutReference: null, motionReference: null,
		processorStack: null,
	});
}

function proxyReference(attachment: Readonly<VideoProxyAttachmentV18>): FramescaperScapeAssetReferenceV27 {
	return reference({
		role: 'proxy', archiveId: `framescaper-v27:proxy:${attachment.sha256}`,
		kind: 'framescaper-video-proxy', encoding: 'video-proxy-v1',
		entry: `framescaper/v27/proxy/${attachment.sha256}/body`, mimeType: attachment.mimeType,
		storageKey: attachment.storageKey, sha256: attachment.sha256,
		byteLength: attachment.byteLength, maximumBytes: VIDEO_PROXY_MAXIMUM_BODY_BYTES,
		sourceId: null, timingReference: null, lutReference: null, motionReference: null,
		processorStack: null,
	});
}

function proxyTimingReference(timing: Readonly<VideoTimingAssetReference>): FramescaperScapeAssetReferenceV27 {
	return reference({
		role: 'proxy-timing', archiveId: `framescaper-v27:proxy-timing:${timing.sha256}`,
		kind: 'framescaper-proxy-timing', encoding: timing.encoding,
		entry: `framescaper/v27/proxy-timing/${timing.sha256}.scti`, mimeType: TIMING_MIME,
		storageKey: timing.storageKey, sha256: timing.sha256,
		byteLength: timing.byteLength, maximumBytes: VIDEO_TIMING_ASSET_MAXIMUM_BYTES,
		sourceId: null, timingReference: timing, lutReference: null, motionReference: null,
		processorStack: null,
	});
}

function lutReference(lut: Readonly<VideoCubeLutReferenceV1>): FramescaperScapeAssetReferenceV27 {
	return reference({
		role: 'lut', archiveId: `framescaper-v27:lut:${lut.sha256}`,
		kind: 'framescaper-cube-lut', encoding: 'cube-lut-v1',
		entry: `framescaper/v27/lut/${lut.sha256}.cube`, mimeType: LUT_MIME,
		storageKey: lut.storageKey, sha256: lut.sha256,
		byteLength: lut.byteLength, maximumBytes: VIDEO_COLOR_LIMITS_V1.maximumCubeLutBytes,
		sourceId: null, timingReference: null, lutReference: lut, motionReference: null,
		processorStack: null,
	});
}

function motionReference(
	motion: Readonly<VideoMotionAnalysisReferenceV1>,
	stack: Readonly<VideoProcessorStackV1>,
): FramescaperScapeAssetReferenceV27 {
	return reference({
		role: 'motion', archiveId: `framescaper-v27:motion:${motion.sha256}`,
		kind: 'framescaper-motion-analysis', encoding: 'motion-analysis-json-v1',
		entry: `framescaper/v27/motion/${motion.sha256}.json`, mimeType: MOTION_MIME,
		storageKey: motion.storageKey, sha256: motion.sha256,
		byteLength: motion.byteLength, maximumBytes: VIDEO_MOTION_LIMITS_V1.maximumAnalysisBytes,
		sourceId: motion.sourceId, timingReference: null, lutReference: null,
		motionReference: motion, processorStack: stack,
	});
}

function projectLuts(project: FramescaperProjectV27): readonly VideoCubeLutReferenceV1[] {
	const values = [
		...project.videoVisualPresentations.map(({ grade }) => grade?.lut ?? null),
		...project.videoFinishingPresets.map(({ template }) => template.grade?.lut ?? null),
	].filter((value): value is VideoCubeLutReferenceV1 => value !== null);
	return values;
}

function addReference(
	value: FramescaperScapeAssetReferenceV27,
	references: FramescaperScapeAssetReferenceV27[],
	byArchiveId: Map<string, FramescaperScapeAssetReferenceV27>,
	byEntry: Map<string, FramescaperScapeAssetReferenceV27>,
	byStorageKey: Map<string, FramescaperScapeAssetReferenceV27>,
): void {
	const matches = [byArchiveId.get(value.archiveId), byEntry.get(value.entry), byStorageKey.get(value.storageKey)]
		.filter((candidate): candidate is FramescaperScapeAssetReferenceV27 => candidate !== undefined);
	if (matches.length > 0) {
		if (matches.every((candidate) => sameReference(candidate, value))) return;
		throw new Error(`V27 Scape asset ${value.archiveId} has a conflicting identity or role.`);
	}
	references.push(value);
	byArchiveId.set(value.archiveId, value);
	byEntry.set(value.entry, value);
	byStorageKey.set(value.storageKey, value);
}

function sameReference(left: FramescaperScapeAssetReferenceV27, right: FramescaperScapeAssetReferenceV27): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

function reference(value: FramescaperScapeAssetReferenceV27): FramescaperScapeAssetReferenceV27 {
	if (!SHA256.test(value.sha256) || value.maximumBytes < 1
		|| (value.byteLength !== null && (value.byteLength < 1 || value.byteLength > value.maximumBytes))) {
		throw new RangeError(`V27 ${value.role} archive reference exceeds its digest or size bound.`);
	}
	return Object.freeze({ ...value });
}

function plannedReference(asset: PlannedScapeExportAsset): FramescaperScapeAssetReferenceV27 {
	const source = record(asset.source, 'V27 planned archive source');
	const referenceValue = source.archiveReference;
	if (!referenceValue || typeof referenceValue !== 'object' || Array.isArray(referenceValue)) {
		throw new TypeError('The V27 planned archive asset lost its exact reference.');
	}
	const reference = referenceValue as FramescaperScapeAssetReferenceV27;
	if (reference.archiveId !== asset.sourceId || reference.kind !== asset.kind
		|| reference.storageKey !== asset.storageKey || reference.sha256 !== asset.expectedSha256) {
		throw new Error('The V27 planned archive asset drifted from its reference.');
	}
	return reference;
}

function validateLut(reference: FramescaperScapeAssetReferenceV27, bytes: Uint8Array): void {
	const parsed = parseCubeLutV1(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
	const expected = reference.lutReference!;
	if (parsed.sha256 !== expected.sha256 || parsed.byteLength !== expected.byteLength
		|| parsed.size !== expected.size || JSON.stringify(parsed.domainMin) !== JSON.stringify(expected.domainMin)
		|| JSON.stringify(parsed.domainMax) !== JSON.stringify(expected.domainMax)) {
		throw new Error('The V27 cube LUT archive body conflicts with its project reference.');
	}
}

function validateMotion(reference: FramescaperScapeAssetReferenceV27, bytes: Uint8Array): void {
	requireVideoMotionAnalysisBodyV1(reference.motionReference, bytes, {
		inputSha256: reference.motionReference!.inputSha256,
		processorStack: reference.processorStack,
	});
}

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)) {
		throw new TypeError(`${name} must be a stable ID.`);
	}
	return value;
}

function sha(value: unknown, name: string): string {
	if (typeof value !== 'string' || !SHA256.test(value)) throw new TypeError(`${name} is invalid.`);
	return value;
}

function positiveInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1) throw new RangeError(`${name} must be positive.`);
	return Number(value);
}

function record(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} is missing.`);
	return value as Record<string, unknown>;
}
