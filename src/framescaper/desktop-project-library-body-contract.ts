/* SPDX-License-Identifier: AGPL-3.0-only */

import { SCAPE_ARCHIVE_LIMITS } from '../common/editor/scape-archive-envelope.ts';
import {
	ASSISTANCE_ASSET_REFERENCE_LIMITS_V1,
	ASSISTANCE_TRANSCRIPT_BODY_MIME_TYPE_V1,
	type AssistanceTranscriptAssetReferenceV1,
} from '../common/editor/assistance/assistance-asset-reference-v1.ts';
import type { VideoTimingAssetReference } from '../common/editor/video-timing-asset.ts';
import {
	validateFramescaperDesktopCoreBodies,
	type FramescaperDesktopCoreBodyDescriptor,
} from './desktop-project-library-core-body-transfer.ts';
import type { FramescaperProject } from './editor-project.ts';
import {
	collectFramescaperScapeAssetReferences,
	type FramescaperScapeAssetReference,
} from './editor-scape-asset-plan.ts';
import {
	createFramescaperProfessionalMediaArchivePlan,
	type FramescaperProfessionalMediaArchiveAsset,
} from './editor-professional-media-archive-plan.ts';

export const FRAMESCAPER_DESKTOP_ASSISTANCE_BODY_KIND = 'assistance-transcript' as const;
export const FRAMESCAPER_DESKTOP_ASSISTANCE_BODY_ENCODING = 'assistance-transcript-v1' as const;

export const FRAMESCAPER_DESKTOP_EXTENSION_BODY_KINDS = Object.freeze([
	'framescaper-still', 'framescaper-freeze-render',
	'framescaper-cube-lut', 'framescaper-motion-analysis',
	'image-sequence-inventory', 'image-sequence-source-pack',
	FRAMESCAPER_DESKTOP_ASSISTANCE_BODY_KIND,
] as const);

export type FramescaperDesktopExtensionBodyKind =
	typeof FRAMESCAPER_DESKTOP_EXTENSION_BODY_KINDS[number];
export type FramescaperDesktopBodyKind =
	| FramescaperDesktopCoreBodyDescriptor['kind']
	| FramescaperDesktopExtensionBodyKind;

export interface FramescaperDesktopBodyDescriptor {
	readonly kind: FramescaperDesktopBodyKind;
	readonly encoding: string;
	readonly bindingId?: string;
	readonly sourceId: string;
	readonly storageKey: string;
	readonly mimeType: string;
	readonly byteLength: number;
	readonly sha256: string;
}

export interface FramescaperDesktopAssistanceBodyDescriptor
	extends FramescaperDesktopBodyDescriptor {
	readonly kind: typeof FRAMESCAPER_DESKTOP_ASSISTANCE_BODY_KIND;
	readonly encoding: typeof FRAMESCAPER_DESKTOP_ASSISTANCE_BODY_ENCODING;
	readonly mimeType: typeof ASSISTANCE_TRANSCRIPT_BODY_MIME_TYPE_V1;
}

export interface FramescaperDesktopAssistanceBodyReference {
	readonly descriptor: Readonly<FramescaperDesktopAssistanceBodyDescriptor>;
	readonly name: string;
}

export interface FramescaperDesktopExtensionBodyReference {
	readonly archiveReference: FramescaperScapeAssetReference | null;
	readonly professionalReference: FramescaperProfessionalMediaArchiveAsset | null;
	readonly kind: FramescaperDesktopExtensionBodyKind;
	readonly encoding: string;
	readonly storageKey: string;
	readonly mimeType: string;
	readonly byteLength: number | null;
	readonly sha256: string;
	readonly maximumBytes: number;
	readonly name: string;
	readonly timing: Readonly<VideoTimingAssetReference> | null;
}

const BASE_KINDS = new Set<string>(['video-original', 'video-proxy', 'video-timing']);
const EXTENSION_KINDS = new Set<string>(FRAMESCAPER_DESKTOP_EXTENSION_BODY_KINDS);
const BODY_FIELDS = [
	'kind', 'encoding', 'sourceId', 'storageKey', 'mimeType', 'byteLength', 'sha256',
] as const;
const PROXY_FIELDS = [
	'kind', 'encoding', 'bindingId', 'sourceId', 'storageKey', 'mimeType', 'byteLength', 'sha256',
] as const;
const DIGEST = /^[a-f0-9]{64}$/u;
const PROXY_BINDING = /^p[a-f0-9]{64}$/u;
const IMAGE_MIME = /^image\/[a-z0-9][a-z0-9.+-]{0,126}$/u;
const MAXIMUM_BODIES = 4_094 + ASSISTANCE_ASSET_REFERENCE_LIMITS_V1.maximumAssets;

/** Validate the selected sequence main's one closed descriptor shape before any body read. */
export function validateFramescaperDesktopBodyDescriptor(
	value: unknown,
): Readonly<FramescaperDesktopBodyDescriptor> {
	const kind = own(value as object, 'kind');
	if (kind === FRAMESCAPER_DESKTOP_ASSISTANCE_BODY_KIND) {
		return validateAssistanceBodyDescriptor(value);
	}
	const record = closedRecord(value, kind === 'video-proxy' ? PROXY_FIELDS : BODY_FIELDS,
		'Framescaper desktop baseline body descriptor');
	if (typeof kind !== 'string' || (!BASE_KINDS.has(kind) && !EXTENSION_KINDS.has(kind))) {
		throw new TypeError('Framescaper desktop baseline body kind is unsupported.');
	}
	const encoding = text(record.encoding, 'body encoding');
	assertKindEncoding(kind as FramescaperDesktopBodyKind, encoding);
	const result: FramescaperDesktopBodyDescriptor = {
		kind: kind as FramescaperDesktopBodyKind,
		encoding,
		...(kind === 'video-proxy' ? { bindingId: text(record.bindingId, 'proxy binding') } : {}),
		sourceId: text(record.sourceId, 'body source id'),
		storageKey: text(record.storageKey, 'body storage key'),
		mimeType: text(record.mimeType, 'body MIME type'),
		byteLength: bodyLength(record.byteLength),
		sha256: digest(record.sha256, 'body'),
	};
	if (result.sourceId !== result.storageKey
		|| (kind === 'video-proxy' && !PROXY_BINDING.test(result.bindingId!))) {
		throw new TypeError('Framescaper desktop baseline body identity is invalid.');
	}
	assertRoleBound(result);
	return Object.freeze(result);
}

/** Bind the complete sequence inventory to the exact baseline project and canonical body order. */
export function validateFramescaperDesktopBodies(
	project: FramescaperProject,
	projectSha256: string,
	value: unknown,
): readonly Readonly<FramescaperDesktopBodyDescriptor>[] {
	digest(projectSha256, 'project');
	const supplied = denseArray(value).map(validateFramescaperDesktopBodyDescriptor);
	const base = validateFramescaperDesktopCoreBodies(
		framescaperDesktopCoreBodyProject(project),
		projectSha256,
		supplied.filter(({ kind }) => BASE_KINDS.has(kind)),
	) as readonly Readonly<FramescaperDesktopBodyDescriptor>[];
	const extensionSupplied = supplied.filter(({ kind }) => EXTENSION_KINDS.has(kind));
	const byKey = new Map<string, Readonly<FramescaperDesktopBodyDescriptor>>();
	for (const descriptor of extensionSupplied) {
		const identity = bodyKey(descriptor);
		if (byKey.has(identity)) throw new Error(`baseline desktop body ${descriptor.storageKey} is duplicated.`);
		byKey.set(identity, descriptor);
	}
	const extension: FramescaperDesktopBodyDescriptor[] = [];
	for (const reference of collectFramescaperDesktopExtensionBodyReferences(project)) {
		const descriptor = byKey.get(bodyKey(reference));
		if (!descriptor) throw new Error(`baseline desktop ${reference.kind} body is missing.`);
		assertDescriptorMatches(reference, descriptor);
		extension.push(descriptor);
		byKey.delete(bodyKey(reference));
	}
	if (byKey.size) throw new Error('baseline desktop body inventory contains an unbound finishing body.');
	const expected = Object.freeze([...base, ...extension]);
	if (JSON.stringify(expected) !== JSON.stringify(supplied)) {
		throw new Error('baseline desktop body inventory order or role changed.');
	}
	return expected;
}

/** V12 owns ordinary originals/proxies/timing; baseline owns sequence inventory and pack bodies. */
export function framescaperDesktopCoreBodyProject(project: FramescaperProject): FramescaperProject {
	const foundation = structuredClone(project) as unknown as Record<string, unknown>;
	foundation.sources = (foundation.sources as Record<string, unknown>[]).filter((source) => source.imageSequence === null);
	return foundation as unknown as FramescaperProject;
}

export function collectFramescaperDesktopExtensionBodyReferences(
	project: FramescaperProject,
): readonly Readonly<FramescaperDesktopExtensionBodyReference>[] {
	const finishing = collectFramescaperScapeAssetReferences(project)
		.filter((reference) => reference.role !== 'proxy' && reference.role !== 'proxy-timing')
		.map((reference) => extensionReference(reference));
	const professional = createFramescaperProfessionalMediaArchivePlan(project).assets
		.filter(({ kind }) => kind === 'image-sequence-inventory' || kind === 'image-sequence-source-pack')
		.map(professionalExtensionReference);
	const assistance = collectFramescaperDesktopAssistanceBodyReferences(project)
		.map(({ descriptor }) => assistanceExtensionReference(descriptor));
	return Object.freeze([...finishing, ...professional, ...assistance]);
}

export function collectFramescaperDesktopAssistanceBodyReferences(
	project: FramescaperProject,
): readonly Readonly<FramescaperDesktopAssistanceBodyReference>[] {
	const references = new Map<string, Readonly<FramescaperDesktopAssistanceBodyReference>>();
	for (const asset of project.assistanceAssets as readonly AssistanceTranscriptAssetReferenceV1[]) {
		const descriptor = Object.freeze({
			kind: FRAMESCAPER_DESKTOP_ASSISTANCE_BODY_KIND,
			encoding: FRAMESCAPER_DESKTOP_ASSISTANCE_BODY_ENCODING,
			sourceId: asset.body.storageKey,
			storageKey: asset.body.storageKey,
			mimeType: asset.body.mimeType,
			byteLength: asset.body.byteLength,
			sha256: asset.body.sha256,
		});
		const prior = references.get(descriptor.storageKey);
		if (prior) {
			if (JSON.stringify(prior.descriptor) !== JSON.stringify(descriptor)) {
				throw new Error(`Transcript body ${descriptor.storageKey} has conflicting references.`);
			}
			continue;
		}
		references.set(descriptor.storageKey, Object.freeze({
			descriptor,
			name: `assistance:transcript:${asset.id}`,
		}));
	}
	return Object.freeze([...references.values()]);
}

function extensionReference(
	reference: FramescaperScapeAssetReference,
): Readonly<FramescaperDesktopExtensionBodyReference> {
	if (!EXTENSION_KINDS.has(reference.kind)) {
		throw new TypeError(`baseline desktop archive role ${reference.role} is not transportable.`);
	}
	return Object.freeze({
		archiveReference: reference,
		professionalReference: null,
		kind: reference.kind as FramescaperDesktopExtensionBodyKind,
		encoding: reference.encoding,
		storageKey: reference.storageKey,
		mimeType: reference.mimeType,
		byteLength: reference.byteLength,
		sha256: reference.sha256,
		maximumBytes: reference.maximumBytes,
		name: `${reference.role}:${reference.archiveId}`,
		timing: null,
	});
}

function professionalExtensionReference(
	reference: FramescaperProfessionalMediaArchiveAsset,
): Readonly<FramescaperDesktopExtensionBodyReference> {
	if (reference.kind !== 'image-sequence-inventory' && reference.kind !== 'image-sequence-source-pack') {
		throw new TypeError(`baseline desktop professional role ${reference.kind} is not transportable.`);
	}
	return Object.freeze({
		archiveReference: null,
		professionalReference: reference,
		kind: reference.kind,
		encoding: reference.encoding,
		storageKey: reference.sourceId,
		mimeType: reference.mimeType,
		byteLength: reference.size,
		sha256: reference.sha256,
		maximumBytes: reference.size,
		name: `professional:${reference.kind}:${reference.sourceId}`,
		timing: null,
	});
}

function assistanceExtensionReference(
	descriptor: Readonly<FramescaperDesktopAssistanceBodyDescriptor>,
): Readonly<FramescaperDesktopExtensionBodyReference> {
	return Object.freeze({
		archiveReference: null,
		professionalReference: null,
		kind: descriptor.kind,
		encoding: descriptor.encoding,
		storageKey: descriptor.storageKey,
		mimeType: descriptor.mimeType,
		byteLength: descriptor.byteLength,
		sha256: descriptor.sha256,
		maximumBytes: ASSISTANCE_ASSET_REFERENCE_LIMITS_V1.maximumBodyBytes,
		name: `assistance:transcript:${descriptor.storageKey}`,
		timing: null,
	});
}

function assertDescriptorMatches(
	reference: FramescaperDesktopExtensionBodyReference,
	descriptor: FramescaperDesktopBodyDescriptor,
): void {
	if (descriptor.kind !== reference.kind || descriptor.encoding !== reference.encoding
		|| descriptor.sourceId !== reference.storageKey || descriptor.storageKey !== reference.storageKey
		|| descriptor.mimeType !== reference.mimeType || descriptor.sha256 !== reference.sha256
		|| descriptor.byteLength > reference.maximumBytes
		|| (reference.byteLength !== null && descriptor.byteLength !== reference.byteLength)) {
		throw new Error(`baseline desktop ${reference.kind} descriptor conflicts with project authority.`);
	}
}

function assertKindEncoding(kind: FramescaperDesktopBodyKind, encoding: string): void {
	const expected: Readonly<Record<FramescaperDesktopBodyKind, string>> = Object.freeze({
		'video-original': 'framescaper-video-original-v1',
		'video-proxy': 'video-proxy-v1',
		'video-timing': 'soundscaper-video-timing-v1',
		'framescaper-still': 'still-image-v1',
		'framescaper-freeze-render': 'freeze-render-v1',
		'framescaper-cube-lut': 'cube-lut-v1',
		'framescaper-motion-analysis': 'motion-analysis-json-v1',
		'image-sequence-inventory': 'framescaper-image-sequence-inventory-v1',
		'image-sequence-source-pack': 'framescaper-image-sequence-source-pack-v1',
		'assistance-transcript': FRAMESCAPER_DESKTOP_ASSISTANCE_BODY_ENCODING,
	});
	if (encoding !== expected[kind]) throw new TypeError(`baseline desktop ${kind} encoding is unsupported.`);
}

function assertRoleBound(value: FramescaperDesktopBodyDescriptor): void {
	if ((value.kind === 'framescaper-still' || value.kind === 'framescaper-freeze-render')
		&& (value.byteLength > 512 * 1024 * 1024 || !IMAGE_MIME.test(value.mimeType))) {
		throw new RangeError(`baseline desktop ${value.kind} exceeds its image role bound.`);
	}
	if (value.kind === 'framescaper-cube-lut'
		&& (value.byteLength > 16 * 1024 * 1024 || value.mimeType !== 'text/plain')) {
		throw new RangeError('baseline desktop cube LUT exceeds its role bound.');
	}
	if (value.kind === 'framescaper-motion-analysis'
		&& (value.byteLength > 1024 * 1024 * 1024
			|| value.mimeType !== 'application/vnd.framescaper.motion-analysis+json')) {
		throw new RangeError('baseline desktop motion analysis exceeds its role bound.');
	}
	if (value.kind === 'image-sequence-inventory'
		&& (value.byteLength > 64 * 1024 * 1024 || value.mimeType !== 'application/json')) {
		throw new RangeError('baseline desktop image-sequence inventory exceeds its role bound.');
	}
	if (value.kind === 'image-sequence-source-pack'
		&& value.mimeType !== 'application/vnd.soundscaper.image-sequence-pack') {
		throw new RangeError('baseline desktop image-sequence source pack has an unsupported media type.');
	}
	if (value.kind === FRAMESCAPER_DESKTOP_ASSISTANCE_BODY_KIND
		&& (value.mimeType !== ASSISTANCE_TRANSCRIPT_BODY_MIME_TYPE_V1
			|| value.byteLength > ASSISTANCE_ASSET_REFERENCE_LIMITS_V1.maximumBodyBytes)) {
		throw new RangeError('Framescaper desktop transcript body exceeds its role bound.');
	}
}

function validateAssistanceBodyDescriptor(
	value: unknown,
): Readonly<FramescaperDesktopAssistanceBodyDescriptor> {
	const row = closedRecord(value, BODY_FIELDS, 'Framescaper desktop transcript body');
	const sha256 = digest(row.sha256, 'transcript body');
	const storageKey = text(row.storageKey, 'transcript storage key');
	const byteLength = bodyLength(row.byteLength);
	if (row.encoding !== FRAMESCAPER_DESKTOP_ASSISTANCE_BODY_ENCODING
		|| row.mimeType !== ASSISTANCE_TRANSCRIPT_BODY_MIME_TYPE_V1
		|| storageKey !== `assistance-transcript-sha256:${sha256}`
		|| row.sourceId !== storageKey
		|| byteLength > ASSISTANCE_ASSET_REFERENCE_LIMITS_V1.maximumBodyBytes) {
		throw new TypeError('The Framescaper desktop transcript descriptor is invalid.');
	}
	return Object.freeze({
		kind: FRAMESCAPER_DESKTOP_ASSISTANCE_BODY_KIND,
		encoding: FRAMESCAPER_DESKTOP_ASSISTANCE_BODY_ENCODING,
		sourceId: storageKey,
		storageKey,
		mimeType: ASSISTANCE_TRANSCRIPT_BODY_MIME_TYPE_V1,
		byteLength,
		sha256,
	});
}

function bodyKey(value: Pick<FramescaperDesktopBodyDescriptor, 'kind' | 'storageKey'>): string {
	return JSON.stringify([value.kind, value.storageKey]);
}

function denseArray(value: unknown): readonly unknown[] {
	if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
		|| value.length > MAXIMUM_BODIES || Reflect.ownKeys(value).length !== value.length + 1) {
		throw new TypeError('Framescaper desktop baseline bodies must be a bounded dense array.');
	}
	return value.map((_, index) => own(value, String(index)));
}

function closedRecord<const Field extends string>(value: unknown, fields: readonly Field[], label: string) {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`${label} must be a plain record.`);
	}
	const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.length || keys.some((key) => typeof key !== 'string' || !fields.includes(key as Field))) {
		throw new TypeError(`${label} has missing or unsupported fields.`);
	}
	const result = Object.create(null) as Record<Field, unknown>;
	for (const field of fields) result[field] = own(value, field);
	return result;
}

function own(value: object, field: PropertyKey): unknown {
	if (!value || typeof value !== 'object') throw new TypeError(`${String(field)} requires a record.`);
	const descriptor = Object.getOwnPropertyDescriptor(value, field);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`${String(field)} must be an own enumerable data property.`);
	}
	return descriptor.value;
}

function text(value: unknown, label: string): string {
	if (typeof value !== 'string' || value.length < 1 || value.length > 4_096) {
		throw new TypeError(`baseline desktop ${label} is invalid.`);
	}
	return value;
}

function digest(value: unknown, label: string): string {
	if (typeof value !== 'string' || !DIGEST.test(value)) throw new TypeError(`baseline desktop ${label} digest is invalid.`);
	return value;
}

function bodyLength(value: unknown): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1
		|| Number(value) > SCAPE_ARCHIVE_LIMITS.maximumExpandedBytes) {
		throw new RangeError('baseline desktop body length is invalid.');
	}
	return Number(value);
}
