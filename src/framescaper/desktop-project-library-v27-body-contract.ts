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
import type { FramescaperProjectV27 } from './editor-project-v27.ts';

export const FRAMESCAPER_DESKTOP_V27_EXTENSION_BODY_KINDS = Object.freeze([
	'framescaper-still', 'framescaper-freeze-render',
	'framescaper-cube-lut', 'framescaper-motion-analysis',
] as const);

export type FramescaperDesktopV27ExtensionBodyKind =
	typeof FRAMESCAPER_DESKTOP_V27_EXTENSION_BODY_KINDS[number];
export type FramescaperDesktopV27BodyKind =
	| FramescaperDesktopV12BodyDescriptor['kind']
	| FramescaperDesktopV27ExtensionBodyKind;

export interface FramescaperDesktopV27BodyDescriptor {
	readonly kind: FramescaperDesktopV27BodyKind;
	readonly encoding: string;
	readonly bindingId?: string;
	readonly sourceId: string;
	readonly storageKey: string;
	readonly mimeType: string;
	readonly byteLength: number;
	readonly sha256: string;
}

export interface FramescaperDesktopV27ExtensionBodyReference {
	readonly archiveReference: FramescaperScapeAssetReferenceV27;
	readonly kind: FramescaperDesktopV27ExtensionBodyKind;
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
const EXTENSION_KINDS = new Set<string>(FRAMESCAPER_DESKTOP_V27_EXTENSION_BODY_KINDS);
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
export function validateFramescaperDesktopV27BodyDescriptor(
	value: unknown,
): Readonly<FramescaperDesktopV27BodyDescriptor> {
	const kind = own(value as object, 'kind');
	const record = closedRecord(value, kind === 'video-proxy' ? PROXY_FIELDS : BODY_FIELDS,
		'Framescaper desktop V27 body descriptor');
	if (typeof kind !== 'string' || (!BASE_KINDS.has(kind) && !EXTENSION_KINDS.has(kind))) {
		throw new TypeError('Framescaper desktop V27 body kind is unsupported.');
	}
	const encoding = text(record.encoding, 'body encoding');
	assertKindEncoding(kind as FramescaperDesktopV27BodyKind, encoding);
	const result: FramescaperDesktopV27BodyDescriptor = {
		kind: kind as FramescaperDesktopV27BodyKind,
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
		throw new TypeError('Framescaper desktop V27 body identity is invalid.');
	}
	assertRoleBound(result);
	return Object.freeze(result);
}

/** Bind the complete V18 inventory to the exact V27 project and canonical body order. */
export function validateFramescaperDesktopV27Bodies(
	project: FramescaperProjectV27,
	projectSha256: string,
	value: unknown,
): readonly Readonly<FramescaperDesktopV27BodyDescriptor>[] {
	digest(projectSha256, 'project');
	const supplied = denseArray(value).map(validateFramescaperDesktopV27BodyDescriptor);
	const base = validateFramescaperDesktopV12Bodies(
		project as unknown as FramescaperProjectV20,
		projectSha256,
		supplied.filter(({ kind }) => BASE_KINDS.has(kind)),
	) as readonly Readonly<FramescaperDesktopV27BodyDescriptor>[];
	const extensionSupplied = supplied.filter(({ kind }) => EXTENSION_KINDS.has(kind));
	const byKey = new Map<string, Readonly<FramescaperDesktopV27BodyDescriptor>>();
	for (const descriptor of extensionSupplied) {
		const identity = bodyKey(descriptor);
		if (byKey.has(identity)) throw new Error(`V27 desktop body ${descriptor.storageKey} is duplicated.`);
		byKey.set(identity, descriptor);
	}
	const extension: FramescaperDesktopV27BodyDescriptor[] = [];
	for (const reference of collectFramescaperDesktopV27ExtensionBodyReferences(project)) {
		const descriptor = byKey.get(bodyKey(reference));
		if (!descriptor) throw new Error(`V27 desktop ${reference.kind} body is missing.`);
		assertDescriptorMatches(reference, descriptor);
		extension.push(descriptor);
		byKey.delete(bodyKey(reference));
	}
	if (byKey.size) throw new Error('V27 desktop body inventory contains an unbound finishing body.');
	const expected = Object.freeze([...base, ...extension]);
	if (JSON.stringify(expected) !== JSON.stringify(supplied)) {
		throw new Error('V27 desktop body inventory order or role changed.');
	}
	return expected;
}

export function collectFramescaperDesktopV27ExtensionBodyReferences(
	project: FramescaperProjectV27,
): readonly Readonly<FramescaperDesktopV27ExtensionBodyReference>[] {
	return Object.freeze(collectFramescaperScapeAssetReferencesV27(project)
		.filter((reference) => reference.role !== 'proxy' && reference.role !== 'proxy-timing')
		.map((reference) => extensionReference(reference)));
}

function extensionReference(
	reference: FramescaperScapeAssetReferenceV27,
): Readonly<FramescaperDesktopV27ExtensionBodyReference> {
	if (!EXTENSION_KINDS.has(reference.kind)) {
		throw new TypeError(`V27 desktop archive role ${reference.role} is not transportable.`);
	}
	return Object.freeze({
		archiveReference: reference,
		kind: reference.kind as FramescaperDesktopV27ExtensionBodyKind,
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

function assertDescriptorMatches(
	reference: FramescaperDesktopV27ExtensionBodyReference,
	descriptor: FramescaperDesktopV27BodyDescriptor,
): void {
	if (descriptor.kind !== reference.kind || descriptor.encoding !== reference.encoding
		|| descriptor.sourceId !== reference.storageKey || descriptor.storageKey !== reference.storageKey
		|| descriptor.mimeType !== reference.mimeType || descriptor.sha256 !== reference.sha256
		|| descriptor.byteLength > reference.maximumBytes
		|| (reference.byteLength !== null && descriptor.byteLength !== reference.byteLength)) {
		throw new Error(`V27 desktop ${reference.kind} descriptor conflicts with project authority.`);
	}
}

function assertKindEncoding(kind: FramescaperDesktopV27BodyKind, encoding: string): void {
	const expected: Readonly<Record<FramescaperDesktopV27BodyKind, string>> = Object.freeze({
		'video-original': 'framescaper-video-original-v1',
		'video-proxy': 'video-proxy-v1',
		'video-timing': 'soundscaper-video-timing-v1',
		'framescaper-still': 'still-image-v1',
		'framescaper-freeze-render': 'freeze-render-v1',
		'framescaper-cube-lut': 'cube-lut-v1',
		'framescaper-motion-analysis': 'motion-analysis-json-v1',
	});
	if (encoding !== expected[kind]) throw new TypeError(`V27 desktop ${kind} encoding is unsupported.`);
}

function assertRoleBound(value: FramescaperDesktopV27BodyDescriptor): void {
	if ((value.kind === 'framescaper-still' || value.kind === 'framescaper-freeze-render')
		&& (value.byteLength > 512 * 1024 * 1024 || !IMAGE_MIME.test(value.mimeType))) {
		throw new RangeError(`V27 desktop ${value.kind} exceeds its image role bound.`);
	}
	if (value.kind === 'framescaper-cube-lut'
		&& (value.byteLength > 16 * 1024 * 1024 || value.mimeType !== 'text/plain')) {
		throw new RangeError('V27 desktop cube LUT exceeds its role bound.');
	}
	if (value.kind === 'framescaper-motion-analysis'
		&& (value.byteLength > 1024 * 1024 * 1024
			|| value.mimeType !== 'application/vnd.framescaper.motion-analysis+json')) {
		throw new RangeError('V27 desktop motion analysis exceeds its role bound.');
	}
}

function bodyKey(value: Pick<FramescaperDesktopV27BodyDescriptor, 'kind' | 'storageKey'>): string {
	return JSON.stringify([value.kind, value.storageKey]);
}

function denseArray(value: unknown): readonly unknown[] {
	if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
		|| value.length > MAXIMUM_BODIES || Reflect.ownKeys(value).length !== value.length + 1) {
		throw new TypeError('Framescaper desktop V27 bodies must be a bounded dense array.');
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
		throw new TypeError(`V27 desktop ${label} is invalid.`);
	}
	return value;
}

function digest(value: unknown, label: string): string {
	if (typeof value !== 'string' || !DIGEST.test(value)) throw new TypeError(`V27 desktop ${label} digest is invalid.`);
	return value;
}

function bodyLength(value: unknown): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1
		|| Number(value) > SCAPE_ARCHIVE_LIMITS.maximumExpandedBytes) {
		throw new RangeError('V27 desktop body length is invalid.');
	}
	return Number(value);
}
