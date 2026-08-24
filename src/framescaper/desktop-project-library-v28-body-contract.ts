/* SPDX-License-Identifier: AGPL-3.0-only */

import { SCAPE_ARCHIVE_LIMITS } from '../common/editor/scape-archive-envelope.ts';
import type { VideoTimingAssetReference } from '../common/editor/video-timing-asset.ts';
import {
	validateFramescaperDesktopV12Bodies,
	type FramescaperDesktopV12BodyDescriptor,
} from './desktop-project-library-v12-body-transfer.ts';
import type { FramescaperProjectV20 } from './editor-project-v20.ts';
import {
	collectFramescaperScapeAssetReferencesV27,
	type FramescaperScapeAssetReferenceV27,
} from './editor-scape-asset-plan-v27.ts';
import {
	createFramescaperProfessionalMediaArchivePlanV25,
	type FramescaperProfessionalMediaArchiveAssetV25,
} from './editor-project-v25-source-rebind.ts';
import { framescaperProjectV27FoundationShapeV28 } from './editor-project-v28-foundation.ts';
import type { FramescaperProjectV28 } from './editor-project-v28.ts';

export const FRAMESCAPER_DESKTOP_V28_EXTENSION_BODY_KINDS = Object.freeze([
	'framescaper-still', 'framescaper-freeze-render',
	'framescaper-cube-lut', 'framescaper-motion-analysis',
	'image-sequence-inventory', 'image-sequence-source-pack',
] as const);

export type FramescaperDesktopV28ExtensionBodyKind =
	typeof FRAMESCAPER_DESKTOP_V28_EXTENSION_BODY_KINDS[number];
export type FramescaperDesktopV28BodyKind =
	| FramescaperDesktopV12BodyDescriptor['kind']
	| FramescaperDesktopV28ExtensionBodyKind;

export interface FramescaperDesktopV28BodyDescriptor {
	readonly kind: FramescaperDesktopV28BodyKind;
	readonly encoding: string;
	readonly bindingId?: string;
	readonly sourceId: string;
	readonly storageKey: string;
	readonly mimeType: string;
	readonly byteLength: number;
	readonly sha256: string;
}

export interface FramescaperDesktopV28ExtensionBodyReference {
	readonly archiveReference: FramescaperScapeAssetReferenceV27 | null;
	readonly professionalReference: FramescaperProfessionalMediaArchiveAssetV25 | null;
	readonly kind: FramescaperDesktopV28ExtensionBodyKind;
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
const EXTENSION_KINDS = new Set<string>(FRAMESCAPER_DESKTOP_V28_EXTENSION_BODY_KINDS);
const BODY_FIELDS = [
	'kind', 'encoding', 'sourceId', 'storageKey', 'mimeType', 'byteLength', 'sha256',
] as const;
const PROXY_FIELDS = [
	'kind', 'encoding', 'bindingId', 'sourceId', 'storageKey', 'mimeType', 'byteLength', 'sha256',
] as const;
const DIGEST = /^[a-f0-9]{64}$/u;
const PROXY_BINDING = /^p[a-f0-9]{64}$/u;
const IMAGE_MIME = /^image\/[a-z0-9][a-z0-9.+-]{0,126}$/u;
const MAXIMUM_BODIES = 4_094;

/** Validate the selected V18 main's one closed descriptor shape before any body read. */
export function validateFramescaperDesktopV28BodyDescriptor(
	value: unknown,
): Readonly<FramescaperDesktopV28BodyDescriptor> {
	const kind = own(value as object, 'kind');
	const record = closedRecord(value, kind === 'video-proxy' ? PROXY_FIELDS : BODY_FIELDS,
		'Framescaper desktop V28 body descriptor');
	if (typeof kind !== 'string' || (!BASE_KINDS.has(kind) && !EXTENSION_KINDS.has(kind))) {
		throw new TypeError('Framescaper desktop V28 body kind is unsupported.');
	}
	const encoding = text(record.encoding, 'body encoding');
	assertKindEncoding(kind as FramescaperDesktopV28BodyKind, encoding);
	const result: FramescaperDesktopV28BodyDescriptor = {
		kind: kind as FramescaperDesktopV28BodyKind,
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
		throw new TypeError('Framescaper desktop V28 body identity is invalid.');
	}
	assertRoleBound(result);
	return Object.freeze(result);
}

/** Bind the complete V18 inventory to the exact V28 project and canonical body order. */
export function validateFramescaperDesktopV28Bodies(
	project: FramescaperProjectV28,
	projectSha256: string,
	value: unknown,
): readonly Readonly<FramescaperDesktopV28BodyDescriptor>[] {
	digest(projectSha256, 'project');
	const supplied = denseArray(value).map(validateFramescaperDesktopV28BodyDescriptor);
	const base = validateFramescaperDesktopV12Bodies(
		framescaperDesktopV12BodyProjectV28(project),
		projectSha256,
		supplied.filter(({ kind }) => BASE_KINDS.has(kind)),
	) as readonly Readonly<FramescaperDesktopV28BodyDescriptor>[];
	const extensionSupplied = supplied.filter(({ kind }) => EXTENSION_KINDS.has(kind));
	const byKey = new Map<string, Readonly<FramescaperDesktopV28BodyDescriptor>>();
	for (const descriptor of extensionSupplied) {
		const identity = bodyKey(descriptor);
		if (byKey.has(identity)) throw new Error(`V28 desktop body ${descriptor.storageKey} is duplicated.`);
		byKey.set(identity, descriptor);
	}
	const extension: FramescaperDesktopV28BodyDescriptor[] = [];
	for (const reference of collectFramescaperDesktopV28ExtensionBodyReferences(project)) {
		const descriptor = byKey.get(bodyKey(reference));
		if (!descriptor) throw new Error(`V28 desktop ${reference.kind} body is missing.`);
		assertDescriptorMatches(reference, descriptor);
		extension.push(descriptor);
		byKey.delete(bodyKey(reference));
	}
	if (byKey.size) throw new Error('V28 desktop body inventory contains an unbound finishing body.');
	const expected = Object.freeze([...base, ...extension]);
	if (JSON.stringify(expected) !== JSON.stringify(supplied)) {
		throw new Error('V28 desktop body inventory order or role changed.');
	}
	return expected;
}

/** V12 owns ordinary originals/proxies/timing; V28 owns sequence inventory and pack bodies. */
export function framescaperDesktopV12BodyProjectV28(project: FramescaperProjectV28): FramescaperProjectV20 {
	const foundation = structuredClone(project) as unknown as Record<string, unknown>;
	foundation.sources = (foundation.sources as Record<string, unknown>[]).filter((source) => source.imageSequence === null);
	return foundation as unknown as FramescaperProjectV20;
}

export function collectFramescaperDesktopV28ExtensionBodyReferences(
	project: FramescaperProjectV28,
): readonly Readonly<FramescaperDesktopV28ExtensionBodyReference>[] {
	const finishing = collectFramescaperScapeAssetReferencesV27(framescaperProjectV27FoundationShapeV28(project))
		.filter((reference) => reference.role !== 'proxy' && reference.role !== 'proxy-timing')
		.map((reference) => extensionReference(reference));
	const professional = createFramescaperProfessionalMediaArchivePlanV25(project).assets
		.filter(({ kind }) => kind === 'image-sequence-inventory' || kind === 'image-sequence-source-pack')
		.map(professionalExtensionReference);
	return Object.freeze([...finishing, ...professional]);
}

function extensionReference(
	reference: FramescaperScapeAssetReferenceV27,
): Readonly<FramescaperDesktopV28ExtensionBodyReference> {
	if (!EXTENSION_KINDS.has(reference.kind)) {
		throw new TypeError(`V28 desktop archive role ${reference.role} is not transportable.`);
	}
	return Object.freeze({
		archiveReference: reference,
		professionalReference: null,
		kind: reference.kind as FramescaperDesktopV28ExtensionBodyKind,
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
	reference: FramescaperProfessionalMediaArchiveAssetV25,
): Readonly<FramescaperDesktopV28ExtensionBodyReference> {
	if (reference.kind !== 'image-sequence-inventory' && reference.kind !== 'image-sequence-source-pack') {
		throw new TypeError(`V28 desktop professional role ${reference.kind} is not transportable.`);
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

function assertDescriptorMatches(
	reference: FramescaperDesktopV28ExtensionBodyReference,
	descriptor: FramescaperDesktopV28BodyDescriptor,
): void {
	if (descriptor.kind !== reference.kind || descriptor.encoding !== reference.encoding
		|| descriptor.sourceId !== reference.storageKey || descriptor.storageKey !== reference.storageKey
		|| descriptor.mimeType !== reference.mimeType || descriptor.sha256 !== reference.sha256
		|| descriptor.byteLength > reference.maximumBytes
		|| (reference.byteLength !== null && descriptor.byteLength !== reference.byteLength)) {
		throw new Error(`V28 desktop ${reference.kind} descriptor conflicts with project authority.`);
	}
}

function assertKindEncoding(kind: FramescaperDesktopV28BodyKind, encoding: string): void {
	const expected: Readonly<Record<FramescaperDesktopV28BodyKind, string>> = Object.freeze({
		'video-original': 'framescaper-video-original-v1',
		'video-proxy': 'video-proxy-v1',
		'video-timing': 'soundscaper-video-timing-v1',
		'framescaper-still': 'still-image-v1',
		'framescaper-freeze-render': 'freeze-render-v1',
		'framescaper-cube-lut': 'cube-lut-v1',
		'framescaper-motion-analysis': 'motion-analysis-json-v1',
		'image-sequence-inventory': 'framescaper-image-sequence-inventory-v1',
		'image-sequence-source-pack': 'framescaper-image-sequence-source-pack-v1',
	});
	if (encoding !== expected[kind]) throw new TypeError(`V28 desktop ${kind} encoding is unsupported.`);
}

function assertRoleBound(value: FramescaperDesktopV28BodyDescriptor): void {
	if ((value.kind === 'framescaper-still' || value.kind === 'framescaper-freeze-render')
		&& (value.byteLength > 512 * 1024 * 1024 || !IMAGE_MIME.test(value.mimeType))) {
		throw new RangeError(`V28 desktop ${value.kind} exceeds its image role bound.`);
	}
	if (value.kind === 'framescaper-cube-lut'
		&& (value.byteLength > 16 * 1024 * 1024 || value.mimeType !== 'text/plain')) {
		throw new RangeError('V28 desktop cube LUT exceeds its role bound.');
	}
	if (value.kind === 'framescaper-motion-analysis'
		&& (value.byteLength > 1024 * 1024 * 1024
			|| value.mimeType !== 'application/vnd.framescaper.motion-analysis+json')) {
		throw new RangeError('V28 desktop motion analysis exceeds its role bound.');
	}
	if (value.kind === 'image-sequence-inventory'
		&& (value.byteLength > 64 * 1024 * 1024 || value.mimeType !== 'application/json')) {
		throw new RangeError('V28 desktop image-sequence inventory exceeds its role bound.');
	}
	if (value.kind === 'image-sequence-source-pack'
		&& value.mimeType !== 'application/vnd.soundscaper.image-sequence-pack') {
		throw new RangeError('V28 desktop image-sequence source pack has an unsupported media type.');
	}
}

function bodyKey(value: Pick<FramescaperDesktopV28BodyDescriptor, 'kind' | 'storageKey'>): string {
	return JSON.stringify([value.kind, value.storageKey]);
}

function denseArray(value: unknown): readonly unknown[] {
	if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
		|| value.length > MAXIMUM_BODIES || Reflect.ownKeys(value).length !== value.length + 1) {
		throw new TypeError('Framescaper desktop V28 bodies must be a bounded dense array.');
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
		throw new TypeError(`V28 desktop ${label} is invalid.`);
	}
	return value;
}

function digest(value: unknown, label: string): string {
	if (typeof value !== 'string' || !DIGEST.test(value)) throw new TypeError(`V28 desktop ${label} digest is invalid.`);
	return value;
}

function bodyLength(value: unknown): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1
		|| Number(value) > SCAPE_ARCHIVE_LIMITS.maximumExpandedBytes) {
		throw new RangeError('V28 desktop body length is invalid.');
	}
	return Number(value);
}
