/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	planScapeVideoProxyArchiveAssetsV2,
	type ScapeVideoProxyArchiveAssetDescriptorV2,
	type ScapeVideoProxyArchiveReferenceV2,
} from '../common/editor/scape-video-proxy-archive-plan-v2.ts';
import { normalizeVideoProxyAttachmentV18 } from '../common/editor/video-proxy-attachment-v18.ts';
import type { EditorProjectRuntimeProfile } from '../common/editor/project-runtime-profile.ts';
import { assertFramescaperProjectV18Profile } from './editor-project-v18-profile.ts';
import {
	validateFramescaperProjectV18,
	type FramescaperProjectV18,
} from './editor-project-v18-validation.ts';

export type FramescaperScapeEnvelopeDecisionV18 = 'continue' | 'cancel';

export interface FramescaperScapeProjectEnvelopeInspectionV18 {
	readonly status: 'metadata-ready' | 'cancelled';
	readonly formatVersion: 1 | 2;
	readonly project: FramescaperProjectV18;
	readonly proxyAssets: readonly Readonly<ScapeVideoProxyArchiveAssetDescriptorV2>[];
}

interface ManifestSnapshot {
	readonly format: unknown;
	readonly formatVersion: unknown;
	readonly project: unknown;
	readonly assets: unknown;
	readonly createdAt?: unknown;
}

interface AssetSnapshot {
	readonly sourceId: string;
	readonly kind: string;
	readonly encoding: string;
	readonly entry: string;
	readonly mimeType?: string;
	readonly size: number;
	readonly sha256: string;
}

const MANIFEST_REQUIRED_FIELDS = ['format', 'formatVersion', 'project', 'assets'] as const;
const MANIFEST_OPTIONAL_FIELDS = ['createdAt'] as const;
const PROJECT_REQUIRED_FIELDS = ['entry', 'schemaVersion', 'size', 'sha256'] as const;
const PROJECT_OPTIONAL_FIELDS = ['mimeType'] as const;
const ASSET_REQUIRED_FIELDS = ['sourceId', 'kind', 'encoding', 'entry', 'size', 'sha256'] as const;
const ASSET_OPTIONAL_FIELDS = ['mimeType'] as const;
const SHA256 = /^[a-f0-9]{64}$/u;
const MAXIMUM_ASSETS = 4_094;
const PROXY_PREFIX = 'video-proxy-sha256:';
const TIMING_PREFIX = 'video-timing-sha256:';

/**
 * Inspects parsed V18 project and manifest metadata. No asset-body capability is
 * accepted here; a cancelled result therefore cannot observe or publish a body.
 */
export function inspectFramescaperScapeProjectEnvelopeV18(
	profile: EditorProjectRuntimeProfile | unknown,
	manifestValue: unknown,
	projectValue: unknown,
	decision: FramescaperScapeEnvelopeDecisionV18 = 'continue',
): Readonly<FramescaperScapeProjectEnvelopeInspectionV18> {
	assertFramescaperProjectV18Profile(profile);
	if (decision !== 'continue' && decision !== 'cancel') {
		throw new RangeError(`Unsupported Framescaper Scape decision: ${String(decision)}.`);
	}
	const manifest = snapshotAllowedRecord(
		manifestValue,
		MANIFEST_REQUIRED_FIELDS,
		MANIFEST_OPTIONAL_FIELDS,
		'Framescaper Scape manifest',
	) as unknown as ManifestSnapshot;
	if (manifest.format !== 'scape-project') throw new RangeError('This is not a Scape project.');
	const formatVersion = formatVersionV18(manifest.formatVersion);
	if (manifest.createdAt !== undefined && typeof manifest.createdAt !== 'string') {
		throw new TypeError('Framescaper Scape manifest createdAt must be a string.');
	}
	const projectDescriptor = snapshotAllowedRecord(
		manifest.project,
		PROJECT_REQUIRED_FIELDS,
		PROJECT_OPTIONAL_FIELDS,
		'Framescaper Scape project descriptor',
	);
	validateProjectDescriptor(projectDescriptor);
	const descriptorSchema = projectDescriptor.schemaVersion;
	if (descriptorSchema !== 18) {
		throw new RangeError(`Framescaper Scape format ${String(formatVersion)} requires schema version 18.`);
	}
	const projectRecord = dataRecord(projectValue, 'Framescaper Scape project');
	const projectSchema = dataProperty(projectRecord, 'schemaVersion', 'Framescaper Scape project');
	if (projectSchema !== 18) {
		throw new RangeError(`Framescaper Scape format ${String(formatVersion)} requires schema version 18.`);
	}
	validateFramescaperProjectV18(profile, projectValue);
	const project = projectValue as FramescaperProjectV18;
	const { references, originalTimingKeys } = attachmentReferences(project);
	const plan = planScapeVideoProxyArchiveAssetsV2(references);
	if (formatVersion !== plan.formatVersion) {
		if (formatVersion === 1) {
			throw new RangeError('Scape format 1 cannot carry a V18 proxy attachment; format 2 is required.');
		}
		throw new RangeError('Scape format 2 requires at least one V18 proxy attachment.');
	}
	const assets = snapshotDenseArray(manifest.assets, 'Framescaper Scape assets', MAXIMUM_ASSETS)
		.map((value, index) => normalizeAsset(value, index));
	validateAssetMatrix(assets, plan.assets, originalTimingKeys);
	return Object.freeze({
		status: decision === 'cancel' ? 'cancelled' : 'metadata-ready',
		formatVersion,
		project,
		proxyAssets: plan.assets,
	});
}

function formatVersionV18(value: unknown): 1 | 2 {
	if (value !== 1 && value !== 2) {
		throw new RangeError(`Unsupported Framescaper Scape format version: ${String(value)}.`);
	}
	return value;
}

function validateProjectDescriptor(value: Readonly<Record<string, unknown>>): void {
	if (value.entry !== 'project.json') {
		throw new Error('The Framescaper Scape project descriptor must own project.json.');
	}
	if (value.mimeType !== undefined && value.mimeType !== 'application/json') {
		throw new TypeError('The Framescaper Scape project descriptor MIME type is invalid.');
	}
	nonNegativeSafeInteger(value.size, 'Framescaper Scape project descriptor size');
	digest(value.sha256, 'Framescaper Scape project descriptor');
}

function attachmentReferences(project: FramescaperProjectV18): Readonly<{
	readonly references: readonly Readonly<ScapeVideoProxyArchiveReferenceV2 | null>[];
	readonly originalTimingKeys: ReadonlySet<string>;
}> {
	const sources = snapshotDenseArray(
		dataProperty(project, 'sources', 'Framescaper Scape project'),
		'Framescaper Scape project sources',
		MAXIMUM_ASSETS,
	);
	const references: Readonly<ScapeVideoProxyArchiveReferenceV2 | null>[] = [];
	const originalTimingKeys = new Set<string>();
	for (const [index, value] of sources.entries()) {
		const source = dataRecord(value, `Framescaper Scape project source ${String(index)}`);
		if (dataProperty(source, 'kind', `Framescaper Scape project source ${String(index)}`) !== 'video') {
			continue;
		}
		const timing = optionalDataProperty(source, 'timingAsset', `Framescaper Scape video source ${String(index)}`);
		if (timing !== undefined && timing !== null) {
			const timingRecord = dataRecord(timing, `Framescaper Scape video source ${String(index)} timing`);
			const storageKey = dataProperty(
				timingRecord,
				'storageKey',
				`Framescaper Scape video source ${String(index)} timing`,
			);
			if (typeof storageKey !== 'string' || !storageKey.startsWith(TIMING_PREFIX)) {
				throw new TypeError('A Framescaper Scape original timing storage key is invalid.');
			}
			originalTimingKeys.add(storageKey);
		}
		const attachmentValue = dataProperty(
			source,
			'proxyAttachment',
			`Framescaper Scape video source ${String(index)}`,
		);
		if (attachmentValue === null) {
			references.push(null);
			continue;
		}
		const attachment = normalizeVideoProxyAttachmentV18(attachmentValue);
		references.push(Object.freeze({
			storageKey: attachment.storageKey,
			mimeType: attachment.mimeType,
			byteLength: attachment.byteLength,
			sha256: attachment.sha256,
			timingAsset: attachment.timingAsset,
		}));
	}
	return Object.freeze({ references: Object.freeze(references), originalTimingKeys });
}

function normalizeAsset(value: unknown, index: number): Readonly<AssetSnapshot> {
	const name = `Framescaper Scape asset ${String(index)}`;
	const raw = snapshotAllowedRecord(value, ASSET_REQUIRED_FIELDS, ASSET_OPTIONAL_FIELDS, name);
	const sourceId = nonEmptyString(raw.sourceId, `${name} sourceId`);
	const kind = nonEmptyString(raw.kind, `${name} kind`);
	if (kind !== 'audio' && kind !== 'video' && kind !== 'video-timing' && kind !== 'video-proxy') {
		throw new TypeError(`${name} kind is invalid.`);
	}
	const encoding = nonEmptyString(raw.encoding, `${name} encoding`);
	const entry = safeEntry(raw.entry, `${name} entry`);
	const mimeType = raw.mimeType === undefined
		? undefined
		: nonEmptyString(raw.mimeType, `${name} MIME type`);
	const size = nonNegativeSafeInteger(raw.size, `${name} size`);
	const sha256 = digest(raw.sha256, name);
	return Object.freeze({ sourceId, kind, encoding, entry, ...(mimeType === undefined ? {} : { mimeType }), size, sha256 });
}

function validateAssetMatrix(
	assets: readonly Readonly<AssetSnapshot>[],
	expected: readonly Readonly<ScapeVideoProxyArchiveAssetDescriptorV2>[],
	originalTimingKeys: ReadonlySet<string>,
): void {
	const expectedBySource = new Map(expected.map((asset) => [asset.sourceId, asset]));
	const expectedByEntry = new Map(expected.map((asset) => [asset.entry, asset]));
	const matched = new Set<Readonly<ScapeVideoProxyArchiveAssetDescriptorV2>>();
	const sourceIds = new Set<string>();
	const entries = new Set<string>(['manifest.json', 'project.json']);
	for (const asset of assets) {
		if (sourceIds.has(asset.sourceId) || entries.has(asset.entry)) {
			throw new Error(`Duplicate or conflicting Scape asset descriptor: ${asset.sourceId}.`);
		}
		sourceIds.add(asset.sourceId);
		entries.add(asset.entry);
		const sourceMatch = expectedBySource.get(asset.sourceId);
		const entryMatch = expectedByEntry.get(asset.entry);
		if (sourceMatch || entryMatch) {
			if (!sourceMatch || !entryMatch || sourceMatch !== entryMatch || !sameAsset(sourceMatch, asset)) {
				throw new Error(`The Scape proxy descriptor ${asset.sourceId} conflicts with its V18 attachment.`);
			}
			matched.add(sourceMatch);
			continue;
		}
		if (isProxyExtensionMarker(asset)) {
			throw new Error(`Orphan Scape proxy descriptor: ${asset.sourceId}.`);
		}
		if (isTimingMarker(asset) && !originalTimingKeys.has(asset.sourceId)) {
			throw new Error(`Orphan Scape proxy timing descriptor: ${asset.sourceId}.`);
		}
	}
	for (const asset of expected) {
		if (!matched.has(asset)) throw new Error(`Missing Scape proxy descriptor: ${asset.sourceId}.`);
	}
}

function sameAsset(
	left: Readonly<ScapeVideoProxyArchiveAssetDescriptorV2>,
	right: Readonly<AssetSnapshot>,
): boolean {
	return left.sourceId === right.sourceId
		&& left.kind === right.kind
		&& left.encoding === right.encoding
		&& left.entry === right.entry
		&& left.mimeType === right.mimeType
		&& left.size === right.size
		&& left.sha256 === right.sha256;
}

function isProxyExtensionMarker(asset: Readonly<AssetSnapshot>): boolean {
	return asset.kind === 'video-proxy'
		|| asset.encoding === 'video-proxy-v1'
		|| asset.sourceId.startsWith(PROXY_PREFIX)
		|| asset.entry.startsWith('proxy/');
}

function isTimingMarker(asset: Readonly<AssetSnapshot>): boolean {
	return asset.kind === 'video-timing'
		|| asset.encoding === 'soundscaper-video-timing-v1'
		|| asset.sourceId.startsWith(TIMING_PREFIX)
		|| asset.entry.startsWith('timing/');
}

function snapshotAllowedRecord<const Required extends string, const Optional extends string>(
	value: unknown,
	required: readonly Required[],
	optional: readonly Optional[],
	name: string,
): Readonly<Record<Required | Optional, unknown>> {
	const record = dataRecord(value, name);
	const prototype = Object.getPrototypeOf(record);
	if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${name} must be a plain record.`);
	const allowed = new Set<string>([...required, ...optional]);
	const keys = Reflect.ownKeys(record);
	if (keys.some((key) => typeof key !== 'string' || !allowed.has(key))) {
		throw new TypeError(`${name} has unsupported fields.`);
	}
	const snapshot = Object.create(null) as Record<Required | Optional, unknown>;
	for (const field of required) snapshot[field] = dataProperty(record, field, name);
	for (const field of optional) {
		const candidate = optionalDataProperty(record, field, name);
		if (candidate !== undefined || Object.hasOwn(record, field)) snapshot[field] = candidate;
	}
	return Object.freeze(snapshot);
}

function snapshotDenseArray(value: unknown, name: string, maximumLength: number): readonly unknown[] {
	if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
		throw new TypeError(`${name} must be a plain dense array.`);
	}
	const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
	if (!lengthDescriptor || lengthDescriptor.enumerable || !Object.hasOwn(lengthDescriptor, 'value')) {
		throw new TypeError(`${name} must have a canonical length.`);
	}
	const length = lengthDescriptor.value;
	if (!Number.isSafeInteger(length) || length < 0 || length > maximumLength) {
		throw new RangeError(`${name} has an invalid length.`);
	}
	const keys = Reflect.ownKeys(value);
	const expectedKeys = new Set<PropertyKey>(['length']);
	for (let index = 0; index < length; index += 1) expectedKeys.add(String(index));
	if (keys.length !== expectedKeys.size || keys.some((key) => !expectedKeys.has(key))) {
		throw new TypeError(`${name} must be dense and have no extra fields.`);
	}
	const snapshot: unknown[] = [];
	for (let index = 0; index < length; index += 1) {
		snapshot.push(dataProperty(value, String(index), name));
	}
	return Object.freeze(snapshot);
}

function dataRecord(value: unknown, name: string): Record<string, unknown> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} must be a record.`);
	}
	return value as Record<string, unknown>;
}

function dataProperty(value: object, key: string, name: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`${name}.${key} must be an own enumerable data property.`);
	}
	return descriptor.value;
}

function optionalDataProperty(value: object, key: string, name: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor) return undefined;
	if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`${name}.${key} must be an own enumerable data property.`);
	}
	return descriptor.value;
}

function nonEmptyString(value: unknown, name: string): string {
	if (typeof value !== 'string' || !value || value.trim() !== value) {
		throw new TypeError(`${name} must be a non-empty canonical string.`);
	}
	return value;
}

function safeEntry(value: unknown, name: string): string {
	const entry = nonEmptyString(value, name);
	if (entry.startsWith('/') || entry.includes('\\') || entry.includes('\0') || entry.split('/').includes('..')) {
		throw new TypeError(`${name} is unsafe.`);
	}
	return entry;
}

function nonNegativeSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) {
		throw new RangeError(`${name} must be a non-negative safe integer.`);
	}
	return Number(value);
}

function digest(value: unknown, name: string): string {
	if (typeof value !== 'string' || !SHA256.test(value)) {
		throw new TypeError(`${name} must have a lowercase SHA-256 digest.`);
	}
	return value;
}
