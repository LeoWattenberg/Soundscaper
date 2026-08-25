/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	ASSISTANCE_ASSET_REFERENCE_LIMITS_V1,
	ASSISTANCE_TRANSCRIPT_BODY_MIME_TYPE_V1,
	type AssistanceTranscriptAssetReferenceV1,
} from '../common/editor/assistance/assistance-asset-reference-v1.ts';
import {
	validateFramescaperDesktopV28Bodies,
	validateFramescaperDesktopV28BodyDescriptor,
	type FramescaperDesktopV28BodyDescriptor,
} from './desktop-project-library-v28-body-contract.ts';
import { framescaperProjectV28FoundationShapeV31 } from './editor-project-v31-foundation.ts';
import type { FramescaperProjectV31 } from './editor-project-v31.ts';

export const FRAMESCAPER_DESKTOP_V31_ASSISTANCE_BODY_KIND = 'assistance-transcript' as const;
export const FRAMESCAPER_DESKTOP_V31_ASSISTANCE_BODY_ENCODING = 'assistance-transcript-v1' as const;

export interface FramescaperDesktopV31AssistanceBodyDescriptor {
	readonly kind: typeof FRAMESCAPER_DESKTOP_V31_ASSISTANCE_BODY_KIND;
	readonly encoding: typeof FRAMESCAPER_DESKTOP_V31_ASSISTANCE_BODY_ENCODING;
	readonly sourceId: string;
	readonly storageKey: string;
	readonly mimeType: typeof ASSISTANCE_TRANSCRIPT_BODY_MIME_TYPE_V1;
	readonly byteLength: number;
	readonly sha256: string;
}

export type FramescaperDesktopV31BodyDescriptor =
	| FramescaperDesktopV28BodyDescriptor
	| FramescaperDesktopV31AssistanceBodyDescriptor;

export interface FramescaperDesktopV31AssistanceBodyReference {
	readonly descriptor: Readonly<FramescaperDesktopV31AssistanceBodyDescriptor>;
	readonly name: string;
}

const BODY_FIELDS = [
	'kind', 'encoding', 'sourceId', 'storageKey', 'mimeType', 'byteLength', 'sha256',
] as const;
const DIGEST = /^[a-f0-9]{64}$/u;
const MAXIMUM_BODIES = 4_094 + ASSISTANCE_ASSET_REFERENCE_LIMITS_V1.maximumAssets;

export function collectFramescaperDesktopV31AssistanceBodyReferences(
	project: FramescaperProjectV31,
): readonly Readonly<FramescaperDesktopV31AssistanceBodyReference>[] {
	const references = new Map<string, Readonly<FramescaperDesktopV31AssistanceBodyReference>>();
	for (const asset of project.assistanceAssets as readonly AssistanceTranscriptAssetReferenceV1[]) {
		const descriptor = Object.freeze({
			kind: FRAMESCAPER_DESKTOP_V31_ASSISTANCE_BODY_KIND,
			encoding: FRAMESCAPER_DESKTOP_V31_ASSISTANCE_BODY_ENCODING,
			sourceId: asset.body.storageKey,
			storageKey: asset.body.storageKey,
			mimeType: asset.body.mimeType,
			byteLength: asset.body.byteLength,
			sha256: asset.body.sha256,
		});
		const prior = references.get(descriptor.storageKey);
		if (prior) {
			if (JSON.stringify(prior.descriptor) !== JSON.stringify(descriptor)) {
				throw new Error(`F31 transcript body ${descriptor.storageKey} has conflicting references.`);
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

export function validateFramescaperDesktopV31BodyDescriptor(
	value: unknown,
): Readonly<FramescaperDesktopV31BodyDescriptor> {
	const kind = data(value, 'kind');
	if (kind !== FRAMESCAPER_DESKTOP_V31_ASSISTANCE_BODY_KIND) {
		return validateFramescaperDesktopV28BodyDescriptor(value);
	}
	const row = closedRecord(value, BODY_FIELDS, 'Framescaper desktop F31 transcript body');
	if (row.encoding !== FRAMESCAPER_DESKTOP_V31_ASSISTANCE_BODY_ENCODING
		|| row.mimeType !== ASSISTANCE_TRANSCRIPT_BODY_MIME_TYPE_V1
		|| typeof row.sha256 !== 'string' || !DIGEST.test(row.sha256)
		|| row.storageKey !== `assistance-transcript-sha256:${row.sha256}`
		|| row.sourceId !== row.storageKey
		|| !Number.isSafeInteger(row.byteLength) || Number(row.byteLength) < 1
		|| Number(row.byteLength) > ASSISTANCE_ASSET_REFERENCE_LIMITS_V1.maximumBodyBytes) {
		throw new TypeError('The Framescaper desktop F31 transcript descriptor is invalid.');
	}
	return Object.freeze({
		kind,
		encoding: FRAMESCAPER_DESKTOP_V31_ASSISTANCE_BODY_ENCODING,
		sourceId: String(row.sourceId),
		storageKey: String(row.storageKey),
		mimeType: ASSISTANCE_TRANSCRIPT_BODY_MIME_TYPE_V1,
		byteLength: Number(row.byteLength),
		sha256: row.sha256,
	});
}

export function validateFramescaperDesktopV31Bodies(
	project: FramescaperProjectV31,
	projectSha256: string,
	value: unknown,
): readonly Readonly<FramescaperDesktopV31BodyDescriptor>[] {
	if (typeof projectSha256 !== 'string' || !DIGEST.test(projectSha256)) {
		throw new TypeError('The Framescaper desktop F31 project digest is invalid.');
	}
	const supplied = denseArray(value).map(validateFramescaperDesktopV31BodyDescriptor);
	const baseSupplied = supplied.filter(({ kind }) => kind !== FRAMESCAPER_DESKTOP_V31_ASSISTANCE_BODY_KIND);
	const base = validateFramescaperDesktopV28Bodies(
		framescaperProjectV28FoundationShapeV31(project), projectSha256, baseSupplied,
	);
	const assistance = collectFramescaperDesktopV31AssistanceBodyReferences(project)
		.map(({ descriptor }) => descriptor);
	const expected = Object.freeze([...base, ...assistance]);
	if (JSON.stringify(expected) !== JSON.stringify(supplied)) {
		throw new Error('Framescaper desktop F31 body inventory order or authority changed.');
	}
	return expected;
}

function denseArray(value: unknown): readonly unknown[] {
	if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
		|| value.length > MAXIMUM_BODIES || Reflect.ownKeys(value).length !== value.length + 1) {
		throw new TypeError('Framescaper desktop F31 bodies must be a bounded dense array.');
	}
	return value.map((_, index) => data(value, String(index)));
}

function closedRecord<const Field extends string>(value: unknown, fields: readonly Field[], label: string) {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`${label} must be a plain record.`);
	}
	const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.length
		|| keys.some((key) => typeof key !== 'string' || !fields.includes(key as Field))) {
		throw new TypeError(`${label} has missing or unsupported fields.`);
	}
	return value as Record<Field, unknown>;
}

function data(value: unknown, field: PropertyKey): unknown {
	if (!value || typeof value !== 'object') return undefined;
	const descriptor = Object.getOwnPropertyDescriptor(value, field);
	return descriptor?.enumerable && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
}
