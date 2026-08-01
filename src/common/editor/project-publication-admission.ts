/* SPDX-License-Identifier: AGPL-3.0-only */

import { checkedPublicationByteSum } from './publication-byte-estimates.ts';
import { serializeScapeProjectDocument } from './scape-project-document.ts';

const MIB = 1024 * 1024;

export const MAXIMUM_PROJECT_PUBLICATION_DOCUMENT_BYTES = 256 * MIB;
export const PROJECT_PUBLICATION_QUOTA_ERROR_CODE = 'QUOTA_EXCEEDED' as const;

export type ProjectPublicationByteScope =
	| 'canonical-project-document-payload'
	| 'current-and-revision-project-document-payload';

export interface ProjectPublicationByteBound {
	readonly bytes: number;
	readonly certainty: 'exact';
	readonly scope: ProjectPublicationByteScope;
}

export interface ProjectRevisionPublicationEstimate {
	readonly document: ProjectPublicationByteBound;
	readonly currentAndRevision: ProjectPublicationByteBound;
	readonly peakResidentBytes: null;
}

export interface ProjectRevisionPublicationOptions {
	readonly maximumDocumentBytes?: number;
}

export interface ProjectRevisionPublicationCapacityRequirement {
	readonly publicationBytes: number;
	readonly headroomBytes: number;
	readonly requiredFreeBytes: number;
}

export interface ProjectPublicationQuotaErrorDetails
	extends ProjectRevisionPublicationCapacityRequirement {
	readonly usage: number;
	readonly quota: number;
	readonly availableBytes: number;
}

export class ProjectPublicationQuotaError extends Error {
	readonly code = PROJECT_PUBLICATION_QUOTA_ERROR_CODE;
	readonly details: Readonly<ProjectPublicationQuotaErrorDetails>;

	constructor(details: ProjectPublicationQuotaErrorDetails) {
		super('There is not enough browser storage available to save this project.');
		this.name = 'ProjectPublicationQuotaError';
		this.details = Object.freeze({ ...details });
	}
}

/**
 * Admits one canonical project snapshot and reports its exact UTF-8 size plus
 * the checked twice-the-snapshot planning amount used for current-and-revision
 * publication. Repository compaction, revision wrappers, structured-clone
 * storage bytes, and process-resident serialization memory remain outside it.
 */
export function estimateProjectRevisionPublication(
	project: unknown,
	options: ProjectRevisionPublicationOptions = {},
): Readonly<ProjectRevisionPublicationEstimate> {
	const maximumBytes = maximumDocumentBytes(options);
	const canonicalDocument = serializeScapeProjectDocument(project);
	const documentBytes = boundedUtf8ByteLength(canonicalDocument, maximumBytes);
	const currentAndRevisionBytes = checkedPublicationByteSum(documentBytes, documentBytes);
	return Object.freeze({
		document: bound(documentBytes, 'canonical-project-document-payload'),
		currentAndRevision: bound(
			currentAndRevisionBytes,
			'current-and-revision-project-document-payload',
		),
		peakResidentBytes: null,
	});
}

/** Checked twice-canonical planning bytes plus the fixed ten-percent headroom. */
export function projectRevisionPublicationCapacityRequirement(
	publicationBytes: unknown,
): Readonly<ProjectRevisionPublicationCapacityRequirement> {
	if (!Number.isSafeInteger(publicationBytes) || Number(publicationBytes) < 0) {
		throw new RangeError('Project publication bytes must be a safe non-negative integer.');
	}
	const bytes = Number(publicationBytes);
	const headroomBytes = Math.floor(bytes / 10) + (bytes % 10 === 0 ? 0 : 1);
	if (bytes > Number.MAX_SAFE_INTEGER - headroomBytes) {
		throw new RangeError('Project publication required free bytes exceed the supported safe integer range.');
	}
	return Object.freeze({
		publicationBytes: bytes,
		headroomBytes,
		requiredFreeBytes: bytes + headroomBytes,
	});
}

/** Refuses a known shortage; missing or malformed estimates remain advisory. */
export function assertProjectRevisionPublicationCapacity(
	publicationBytes: unknown,
	estimate: unknown,
): Readonly<ProjectRevisionPublicationCapacityRequirement> {
	const requirement = projectRevisionPublicationCapacityRequirement(publicationBytes);
	const known = knownStorageEstimate(estimate);
	if (!known) return requirement;
	const availableBytes = Math.max(0, known.quota - known.usage);
	if (availableBytes >= requirement.requiredFreeBytes) return requirement;
	throw new ProjectPublicationQuotaError({
		...requirement,
		usage: known.usage,
		quota: known.quota,
		availableBytes,
	});
}

function maximumDocumentBytes(options: ProjectRevisionPublicationOptions): number {
	if (!isPlainObject(options)) {
		throw new TypeError('Project publication options must be a plain object.');
	}
	for (const name of Object.keys(options)) {
		if (name !== 'maximumDocumentBytes') {
			throw new TypeError(`Unsupported project publication option: ${name}.`);
		}
	}
	const maximum: unknown = options.maximumDocumentBytes
		?? MAXIMUM_PROJECT_PUBLICATION_DOCUMENT_BYTES;
	if (typeof maximum !== 'number'
		|| !Number.isSafeInteger(maximum)
		|| maximum < 1
		|| maximum > MAXIMUM_PROJECT_PUBLICATION_DOCUMENT_BYTES) {
		throw new RangeError('Project publication document byte limit is invalid.');
	}
	return maximum;
}

function knownStorageEstimate(value: unknown): Readonly<{ usage: number; quota: number }> | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const candidate = value as Readonly<{ usage?: unknown; quota?: unknown }>;
	if (!isKnownByteEstimate(candidate.usage) || !isKnownByteEstimate(candidate.quota)) return null;
	return { usage: candidate.usage, quota: candidate.quota };
}

function isKnownByteEstimate(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function boundedUtf8ByteLength(value: string, maximumBytes: number): number {
	if (value.length > maximumBytes) {
		throw new RangeError('Project publication document exceeds its byte limit.');
	}
	let bytes = 0;
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		if (code <= 0x7f) bytes += 1;
		else if (code <= 0x7ff) bytes += 2;
		else if (isHighSurrogate(code) && isLowSurrogate(value.charCodeAt(index + 1))) {
			bytes += 4;
			index += 1;
		} else bytes += 3;
		if (bytes > maximumBytes) {
			throw new RangeError('Project publication document exceeds its byte limit.');
		}
	}
	return bytes;
}

function bound(
	bytes: number,
	scope: ProjectPublicationByteScope,
): Readonly<ProjectPublicationByteBound> {
	return Object.freeze({ bytes, certainty: 'exact', scope });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return Boolean(value)
		&& typeof value === 'object'
		&& !Array.isArray(value)
		&& Object.getPrototypeOf(value) === Object.prototype;
}

function isHighSurrogate(value: number): boolean {
	return value >= 0xd800 && value <= 0xdbff;
}

function isLowSurrogate(value: number): boolean {
	return value >= 0xdc00 && value <= 0xdfff;
}
