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

export const FRAMESCAPER_DURABLE_SCAPE_ASSET_KINDS = Object.freeze([
	'framescaper-still', 'framescaper-freeze-render', 'framescaper-video-proxy',
	'framescaper-proxy-timing', 'framescaper-cube-lut', 'framescaper-motion-analysis',
] as const);

export type FramescaperDurableScapeAssetKind = typeof FRAMESCAPER_DURABLE_SCAPE_ASSET_KINDS[number];
export type FramescaperDurableScapeAssetPlanLabel = 'Framescaper' | 'finishing';
export type FramescaperDurableScapeAssetRole =
	| 'still' | 'freeze-render' | 'proxy' | 'proxy-timing' | 'lut' | 'motion';

export interface FramescaperDurableScapeAssetReference {
	readonly role: FramescaperDurableScapeAssetRole;
	readonly archiveId: string;
	readonly kind: FramescaperDurableScapeAssetKind;
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

export interface FramescaperDurableScapeAssetProject {
	readonly sources: readonly Readonly<Record<string, unknown>>[];
	readonly freezeRenderedSourceIds: ReadonlySet<string>;
	readonly luts: () => readonly Readonly<VideoCubeLutReferenceV1>[];
	readonly processorStacks: () => readonly Readonly<VideoProcessorStackV1>[];
	readonly motionAnalyses: () => readonly Readonly<VideoMotionAnalysisReferenceV1>[];
}

export interface FramescaperDurableScapeImportValidation {
	readonly references: readonly FramescaperDurableScapeAssetReference[];
	readonly descriptorByArchiveId: ReadonlyMap<string, ScapeAssetDescriptor>;
}

export interface FramescaperDurableScapeMetadataStore {
	getMediaAssetMetadata(storageKey: string): PromiseLike<unknown> | unknown;
}

const MAXIMUM_STILL_BYTES = 512 * 1024 * 1024;
const STILL_MIME = /^image\/[a-z0-9][a-z0-9.+-]{0,126}$/u;
const MOTION_MIME = 'application/vnd.framescaper.motion-analysis+json';
const TIMING_MIME = 'application/vnd.soundscaper.video-timing';
const LUT_MIME = 'text/plain';
const SHA256 = /^[a-f0-9]{64}$/u;

export async function planFramescaperDurableScapeExportAssets(
	references: readonly FramescaperDurableScapeAssetReference[],
	store: FramescaperDurableScapeMetadataStore,
	label: FramescaperDurableScapeAssetPlanLabel,
	signal?: AbortSignal,
): Promise<readonly PlannedScapeExportAsset[]> {
	const assets: PlannedScapeExportAsset[] = [];
	for (const reference of references) {
		throwIfScapeAborted(signal);
		const metadata = record(
			await awaitScapeOperation(store.getMediaAssetMetadata(reference.storageKey), signal),
			`${label} ${reference.role} archive metadata`,
		);
		const size = positiveInteger(metadata.size, `${label} ${reference.role} archive size`);
		if (size > reference.maximumBytes
			|| (reference.byteLength !== null && size !== reference.byteLength)
			|| metadata.sha256 !== reference.sha256) {
			throw new Error(`${label} ${reference.role} body ${reference.storageKey} is missing or stale.`);
		}
		const storedMime = String(metadata.mimeType ?? '');
		if (storedMime && storedMime !== reference.mimeType) {
			throw new Error(`${label} ${reference.role} body ${reference.storageKey} has a conflicting media type.`);
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

export function validateFramescaperDurableScapeImportAssets(
	references: readonly FramescaperDurableScapeAssetReference[],
	manifest: ScapeManifest,
	label: FramescaperDurableScapeAssetPlanLabel,
): Readonly<FramescaperDurableScapeImportValidation> {
	const kinds = new Set<string>(FRAMESCAPER_DURABLE_SCAPE_ASSET_KINDS);
	const descriptors = manifest.assets.filter(({ kind }) => kinds.has(kind));
	if (descriptors.length !== references.length) {
		throw new Error(`The ${label} Scape archive has an incomplete durable finishing asset inventory.`);
	}
	const descriptorByArchiveId = new Map<string, ScapeAssetDescriptor>();
	for (const descriptor of descriptors) {
		if (descriptorByArchiveId.has(descriptor.sourceId)) {
			throw new Error(`The ${label} Scape asset ${descriptor.sourceId} is duplicated.`);
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
			throw new Error(`The ${label} Scape ${reference.role} descriptor is missing or conflicts with project authority.`);
		}
	}
	return Object.freeze({ references, descriptorByArchiveId });
}

export async function validateFramescaperDurableScapeExportAssetBody(
	asset: PlannedScapeExportAsset,
	body: Blob,
	label: FramescaperDurableScapeAssetPlanLabel,
	signal?: AbortSignal,
): Promise<void> {
	const reference = plannedReference(asset, label);
	if (body.size !== asset.size || body.size > reference.maximumBytes
		|| await digestMediaContent(body, { signal }) !== reference.sha256) {
		throw new Error(`The ${label} ${reference.role} archive body changed after admission.`);
	}
	if (reference.role === 'lut' || reference.role === 'motion') {
		validateFramescaperDurableScapeAssetReferenceBytes(
			reference, new Uint8Array(await body.arrayBuffer()), label,
		);
	}
}

export function validateFramescaperDurableScapeAssetReferenceBytes(
	reference: FramescaperDurableScapeAssetReference,
	bytesValue: Uint8Array,
	label: FramescaperDurableScapeAssetPlanLabel,
): void {
	if (reference.role === 'lut') validateLut(reference, bytesValue, label);
	if (reference.role === 'motion') validateMotion(reference, bytesValue);
}

export function collectFramescaperDurableScapeAssetReferences(
	project: FramescaperDurableScapeAssetProject,
	label: FramescaperDurableScapeAssetPlanLabel,
): readonly FramescaperDurableScapeAssetReference[] {
	const references: FramescaperDurableScapeAssetReference[] = [];
	const byArchiveId = new Map<string, FramescaperDurableScapeAssetReference>();
	const byEntry = new Map<string, FramescaperDurableScapeAssetReference>();
	const byStorageKey = new Map<string, FramescaperDurableScapeAssetReference>();
	for (const source of project.sources) {
		if (source.kind === 'still') {
			addReference(stillReference(
				source, project.freezeRenderedSourceIds.has(String(source.id)), label,
			), references, byArchiveId, byEntry, byStorageKey, label);
		}
		if (source.kind !== 'video' || source.proxyAttachment === null) continue;
		const attachment = source.proxyAttachment as Readonly<VideoProxyAttachmentV18>;
		addReference(proxyReference(attachment, label), references, byArchiveId, byEntry, byStorageKey, label);
		addReference(proxyTimingReference(attachment.timingAsset, label), references, byArchiveId, byEntry, byStorageKey, label);
	}
	for (const lut of project.luts()) {
		addReference(lutReference(lut, label), references, byArchiveId, byEntry, byStorageKey, label);
	}
	const stackById = new Map(project.processorStacks().map((stack) => [
		label === 'Framescaper' ? String(stack.id) : stack.id, stack,
	]));
	for (const motion of project.motionAnalyses()) {
		const stack = stackById.get(motion.processorStackId);
		if (!stack) throw new Error(`${label} motion analysis ${motion.id} has no processor stack.`);
		addReference(motionReference(motion, stack, label), references, byArchiveId, byEntry, byStorageKey, label);
	}
	return Object.freeze(references);
}

function stillReference(
	source: Readonly<Record<string, unknown>>,
	freeze: boolean,
	label: FramescaperDurableScapeAssetPlanLabel,
): FramescaperDurableScapeAssetReference {
	const sourceId = stableId(source.id, `${label} still source ID`);
	const mimeType = String(source.mimeType);
	if (!STILL_MIME.test(mimeType)) throw new TypeError(`${label} still ${sourceId} has an invalid media type.`);
	const role = freeze ? 'freeze-render' as const : 'still' as const;
	const digest = sha(source.contentSha256, `${label} ${role} digest`);
	return reference({
		role, archiveId: `framescaper:${role}:${sourceId}`,
		kind: freeze ? 'framescaper-freeze-render' : 'framescaper-still',
		encoding: freeze ? 'freeze-render-v1' : 'still-image-v1',
		entry: `framescaper/finishing/${freeze ? 'freeze' : 'still'}/${safeScapeEntryId(sourceId)}/body`,
		mimeType, storageKey: stableId(source.storageKey, `${label} ${role} storage key`),
		sha256: digest, byteLength: null, maximumBytes: MAXIMUM_STILL_BYTES,
		sourceId, timingReference: null, lutReference: null, motionReference: null,
		processorStack: null,
	}, label);
}

function proxyReference(
	attachment: Readonly<VideoProxyAttachmentV18>,
	label: FramescaperDurableScapeAssetPlanLabel,
): FramescaperDurableScapeAssetReference {
	return reference({
		role: 'proxy', archiveId: `framescaper:proxy:${attachment.sha256}`,
		kind: 'framescaper-video-proxy', encoding: 'video-proxy-v1',
		entry: `framescaper/finishing/proxy/${attachment.sha256}/body`, mimeType: attachment.mimeType,
		storageKey: attachment.storageKey, sha256: attachment.sha256,
		byteLength: attachment.byteLength, maximumBytes: VIDEO_PROXY_MAXIMUM_BODY_BYTES,
		sourceId: null, timingReference: null, lutReference: null, motionReference: null,
		processorStack: null,
	}, label);
}

function proxyTimingReference(
	timing: Readonly<VideoTimingAssetReference>,
	label: FramescaperDurableScapeAssetPlanLabel,
): FramescaperDurableScapeAssetReference {
	return reference({
		role: 'proxy-timing', archiveId: `framescaper:proxy-timing:${timing.sha256}`,
		kind: 'framescaper-proxy-timing', encoding: timing.encoding,
		entry: `framescaper/finishing/proxy-timing/${timing.sha256}.scti`, mimeType: TIMING_MIME,
		storageKey: timing.storageKey, sha256: timing.sha256,
		byteLength: timing.byteLength, maximumBytes: VIDEO_TIMING_ASSET_MAXIMUM_BYTES,
		sourceId: null, timingReference: timing, lutReference: null, motionReference: null,
		processorStack: null,
	}, label);
}

function lutReference(
	lut: Readonly<VideoCubeLutReferenceV1>,
	label: FramescaperDurableScapeAssetPlanLabel,
): FramescaperDurableScapeAssetReference {
	return reference({
		role: 'lut', archiveId: `framescaper:lut:${lut.sha256}`,
		kind: 'framescaper-cube-lut', encoding: 'cube-lut-v1',
		entry: `framescaper/finishing/lut/${lut.sha256}.cube`, mimeType: LUT_MIME,
		storageKey: lut.storageKey, sha256: lut.sha256,
		byteLength: lut.byteLength, maximumBytes: VIDEO_COLOR_LIMITS_V1.maximumCubeLutBytes,
		sourceId: null, timingReference: null, lutReference: lut, motionReference: null,
		processorStack: null,
	}, label);
}

function motionReference(
	motion: Readonly<VideoMotionAnalysisReferenceV1>,
	stack: Readonly<VideoProcessorStackV1>,
	label: FramescaperDurableScapeAssetPlanLabel,
): FramescaperDurableScapeAssetReference {
	return reference({
		role: 'motion', archiveId: `framescaper:motion:${motion.sha256}`,
		kind: 'framescaper-motion-analysis', encoding: 'motion-analysis-json-v1',
		entry: `framescaper/finishing/motion/${motion.sha256}.json`, mimeType: MOTION_MIME,
		storageKey: motion.storageKey, sha256: motion.sha256,
		byteLength: motion.byteLength, maximumBytes: VIDEO_MOTION_LIMITS_V1.maximumAnalysisBytes,
		sourceId: motion.sourceId, timingReference: null, lutReference: null,
		motionReference: motion, processorStack: stack,
	}, label);
}

function addReference(
	value: FramescaperDurableScapeAssetReference,
	references: FramescaperDurableScapeAssetReference[],
	byArchiveId: Map<string, FramescaperDurableScapeAssetReference>,
	byEntry: Map<string, FramescaperDurableScapeAssetReference>,
	byStorageKey: Map<string, FramescaperDurableScapeAssetReference>,
	label: FramescaperDurableScapeAssetPlanLabel,
): void {
	const matches = [byArchiveId.get(value.archiveId), byEntry.get(value.entry), byStorageKey.get(value.storageKey)]
		.filter((candidate): candidate is FramescaperDurableScapeAssetReference => candidate !== undefined);
	if (matches.length > 0) {
		if (matches.every((candidate) => JSON.stringify(candidate) === JSON.stringify(value))) return;
		throw new Error(`${label} Scape asset ${value.archiveId} has a conflicting identity or role.`);
	}
	references.push(value);
	byArchiveId.set(value.archiveId, value);
	byEntry.set(value.entry, value);
	byStorageKey.set(value.storageKey, value);
}

function reference(
	value: FramescaperDurableScapeAssetReference,
	label: FramescaperDurableScapeAssetPlanLabel,
): FramescaperDurableScapeAssetReference {
	if (!SHA256.test(value.sha256) || value.maximumBytes < 1
		|| (value.byteLength !== null && (value.byteLength < 1 || value.byteLength > value.maximumBytes))) {
		throw new RangeError(`${label} ${value.role} archive reference exceeds its digest or size bound.`);
	}
	return Object.freeze({ ...value });
}

function plannedReference(
	asset: PlannedScapeExportAsset,
	label: FramescaperDurableScapeAssetPlanLabel,
): FramescaperDurableScapeAssetReference {
	const source = record(asset.source, `${label} planned archive source`);
	const referenceValue = source.archiveReference;
	if (!referenceValue || typeof referenceValue !== 'object' || Array.isArray(referenceValue)) {
		throw new TypeError(`The ${label} planned archive asset lost its exact reference.`);
	}
	const referenceValueTyped = referenceValue as FramescaperDurableScapeAssetReference;
	if (referenceValueTyped.archiveId !== asset.sourceId || referenceValueTyped.kind !== asset.kind
		|| referenceValueTyped.storageKey !== asset.storageKey
		|| referenceValueTyped.sha256 !== asset.expectedSha256) {
		throw new Error(`The ${label} planned archive asset drifted from its reference.`);
	}
	return referenceValueTyped;
}

function validateLut(
	referenceValue: FramescaperDurableScapeAssetReference,
	bytesValue: Uint8Array,
	label: FramescaperDurableScapeAssetPlanLabel,
): void {
	const parsed = parseCubeLutV1(new TextDecoder('utf-8', { fatal: true }).decode(bytesValue));
	const expected = referenceValue.lutReference!;
	if (parsed.sha256 !== expected.sha256 || parsed.byteLength !== expected.byteLength
		|| parsed.size !== expected.size || JSON.stringify(parsed.domainMin) !== JSON.stringify(expected.domainMin)
		|| JSON.stringify(parsed.domainMax) !== JSON.stringify(expected.domainMax)) {
		throw new Error(`The ${label} cube LUT archive body conflicts with its project reference.`);
	}
}

function validateMotion(
	referenceValue: FramescaperDurableScapeAssetReference,
	bytesValue: Uint8Array,
): void {
	requireVideoMotionAnalysisBodyV1(referenceValue.motionReference, bytesValue, {
		inputSha256: referenceValue.motionReference!.inputSha256,
		processorStack: referenceValue.processorStack,
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
