/* SPDX-License-Identifier: AGPL-3.0-only */

import { checkedPublicationByteSum } from './publication-byte-estimates.ts';
import { serializeScapeProjectDocument } from './scape-project-document.ts';

const MIB = 1024 * 1024;

export const MAXIMUM_PROJECT_PUBLICATION_DOCUMENT_BYTES = 256 * MIB;

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

/**
 * Admits one canonical project document and reports the two logical payloads
 * published by local persistence: the current snapshot and its revision row.
 * Browser-defined record overhead and process-resident serialization memory are
 * deliberately outside this payload estimate.
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
