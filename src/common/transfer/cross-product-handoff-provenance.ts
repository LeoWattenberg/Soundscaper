/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Durable retry identity embedded in the destination project's existing
 * `opaqueExtensions` root. Import may remap media ids, so persisted canonical
 * JSON is not a stable retry proof; this closed invocation marker is.
 */

import { canonicalJsonSha256 } from '../canonical-json-sha256.ts';

export const CROSS_PRODUCT_HANDOFF_PROVENANCE_KEY =
	'org.soundscaper.cross-product-handoff.v1' as const;
export const CROSS_PRODUCT_HANDOFF_PROVENANCE_KIND =
	'cross-product-editable-copy-provenance' as const;
export const CROSS_PRODUCT_HANDOFF_PROVENANCE_VERSION = 1 as const;

const HASH_PATTERN = /^[0-9a-f]{64}$/u;
const MAXIMUM_ID_LENGTH = 256;
const MAXIMUM_REPORT_ROOTS = 128;
const PROVENANCE_FIELDS = Object.freeze([
	'kind', 'version', 'invocationId', 'source', 'destination', 'reportClaimsSha256',
] as const);
const SOURCE_FIELDS = Object.freeze([
	'schemaFamily', 'schemaVersion', 'projectId', 'sha256',
] as const);
const DESTINATION_FIELDS = Object.freeze([
	'schemaFamily', 'schemaVersion', 'projectId',
] as const);
const REPORT_SOURCE_FIELDS = Object.freeze([
	'schemaFamily', 'schemaVersion', 'projectId', 'sha256',
] as const);
const REPORT_ROOT_FIELDS = Object.freeze([
	'root', 'disposition', 'reason', 'sourceRef', 'destinationRef',
	'sourceSha256', 'destinationSha256',
] as const);

interface ProvenanceSourceRef {
	readonly schemaFamily: 'soundscaper' | 'framescaper';
	readonly schemaVersion: 1;
	readonly projectId: string;
	readonly sha256: string;
}

interface ProvenanceDestinationRef {
	readonly schemaFamily: 'soundscaper' | 'framescaper';
	readonly schemaVersion: 1;
	readonly projectId: string;
}

export interface CrossProductHandoffProvenanceV1 {
	readonly kind: typeof CROSS_PRODUCT_HANDOFF_PROVENANCE_KIND;
	readonly version: typeof CROSS_PRODUCT_HANDOFF_PROVENANCE_VERSION;
	readonly invocationId: string;
	readonly source: Readonly<ProvenanceSourceRef>;
	readonly destination: Readonly<ProvenanceDestinationRef>;
	readonly reportClaimsSha256: string;
}

export interface CreateCrossProductHandoffProvenanceOptions {
	readonly invocationId: unknown;
	readonly source: unknown;
	readonly destination: unknown;
	readonly reportClaimsSha256: unknown;
}

/** Create and close the identity written by the destination converter. */
export function createCrossProductHandoffProvenance(
	options: CreateCrossProductHandoffProvenanceOptions,
): Readonly<CrossProductHandoffProvenanceV1> {
	return admitCrossProductHandoffProvenance({
		kind: CROSS_PRODUCT_HANDOFF_PROVENANCE_KIND,
		version: CROSS_PRODUCT_HANDOFF_PROVENANCE_VERSION,
		invocationId: options?.invocationId,
		source: options?.source,
		destination: options?.destination,
		reportClaimsSha256: options?.reportClaimsSha256,
	});
}

/** Commit the report fields that do not depend on the destination archive digest. */
export function crossProductHandoffReportClaimsSha256(value: unknown): string {
	const report = record(value, 'Conversion report');
	const source = exactRecord(report.source, REPORT_SOURCE_FIELDS, 'Conversion report source');
	if (!Array.isArray(report.roots) || Object.getPrototypeOf(report.roots) !== Array.prototype
		|| report.roots.length < 1 || report.roots.length > MAXIMUM_REPORT_ROOTS) {
		throw new TypeError('Conversion report roots must be a bounded ordinary array.');
	}
	const roots = report.roots.map((value, index) => {
		const root = exactRecord(value, REPORT_ROOT_FIELDS, `Conversion report root ${String(index)}`);
		return Object.freeze({
			root: root.root,
			disposition: root.disposition,
			reason: root.reason,
			sourceRef: root.sourceRef,
			destinationRef: root.destinationRef,
			sourceSha256: root.sourceSha256,
		});
	});
	return canonicalJsonSha256(Object.freeze({ source: Object.freeze({ ...source }), roots }));
}

/** Select exactly the non-circular identity fields from an admitted report. */
export function createCrossProductHandoffProvenanceFromReport(
	value: unknown,
): Readonly<CrossProductHandoffProvenanceV1> {
	const report = record(value, 'Conversion report');
	const source = record(report.source, 'Conversion report source');
	const destination = record(report.destination, 'Conversion report destination');
	return createCrossProductHandoffProvenance({
		invocationId: report.invocationId,
		source: {
			schemaFamily: source.schemaFamily,
			schemaVersion: source.schemaVersion,
			projectId: source.projectId,
			sha256: source.sha256,
		},
		destination: {
			schemaFamily: destination.schemaFamily,
			schemaVersion: destination.schemaVersion,
			projectId: destination.projectId,
		},
		reportClaimsSha256: crossProductHandoffReportClaimsSha256(report),
	});
}

/** Read the reserved marker without treating any other opaque data as provenance. */
export function readCrossProductHandoffProvenance(
	project: unknown,
): Readonly<CrossProductHandoffProvenanceV1> | null {
	const held = record(project, 'Cross-product destination project');
	const extensions = record(held.opaqueExtensions, 'Cross-product destination opaqueExtensions');
	if (!Object.hasOwn(extensions, CROSS_PRODUCT_HANDOFF_PROVENANCE_KEY)) return null;
	return admitCrossProductHandoffProvenance(extensions[CROSS_PRODUCT_HANDOFF_PROVENANCE_KEY]);
}

export function crossProductHandoffProvenanceMatchesReport(
	value: unknown,
	report: unknown,
): boolean {
	try {
		const held = admitCrossProductHandoffProvenance(value);
		const expected = createCrossProductHandoffProvenanceFromReport(report);
		return JSON.stringify(held) === JSON.stringify(expected);
	} catch {
		return false;
	}
}

function admitCrossProductHandoffProvenance(
	value: unknown,
): Readonly<CrossProductHandoffProvenanceV1> {
	const held = exactRecord(value, PROVENANCE_FIELDS, 'Cross-product handoff provenance');
	if (held.kind !== CROSS_PRODUCT_HANDOFF_PROVENANCE_KIND
		|| held.version !== CROSS_PRODUCT_HANDOFF_PROVENANCE_VERSION) {
		throw new TypeError('Cross-product handoff provenance kind or version is unsupported.');
	}
	const source = exactRecord(held.source, SOURCE_FIELDS, 'Cross-product handoff provenance source');
	const destination = exactRecord(
		held.destination, DESTINATION_FIELDS, 'Cross-product handoff provenance destination',
	);
	return Object.freeze({
		kind: CROSS_PRODUCT_HANDOFF_PROVENANCE_KIND,
		version: CROSS_PRODUCT_HANDOFF_PROVENANCE_VERSION,
		invocationId: boundedId(held.invocationId, 'invocationId'),
		source: Object.freeze({
			...projectRef(source, 'source'),
			sha256: hash(source.sha256, 'source.sha256'),
		}),
		destination: projectRef(destination, 'destination'),
		reportClaimsSha256: hash(held.reportClaimsSha256, 'reportClaimsSha256'),
	});
}

function projectRef(
	value: Record<string, unknown>,
	label: string,
): Readonly<ProvenanceDestinationRef> {
	if (value.schemaFamily !== 'soundscaper' && value.schemaFamily !== 'framescaper') {
		throw new TypeError(`Cross-product handoff provenance ${label} family is unsupported.`);
	}
	if (value.schemaVersion !== 1) {
		throw new TypeError(`Cross-product handoff provenance ${label} schemaVersion must be family v1.`);
	}
	return Object.freeze({
		schemaFamily: value.schemaFamily,
		schemaVersion: 1,
		projectId: boundedId(value.projectId, `${label}.projectId`),
	});
}

function boundedId(value: unknown, label: string): string {
	if (typeof value !== 'string' || value.length < 1 || value.length > MAXIMUM_ID_LENGTH
		|| /[\u0000-\u001f\u007f]/u.test(value)) {
		throw new TypeError(`Cross-product handoff provenance ${label} is not a bounded identifier.`);
	}
	return value;
}

function hash(value: unknown, label: string): string {
	if (typeof value !== 'string' || !HASH_PATTERN.test(value)) {
		throw new TypeError(`Cross-product handoff provenance ${label} is not a SHA-256 digest.`);
	}
	return value;
}

function exactRecord<const Fields extends readonly string[]>(
	value: unknown,
	fields: Fields,
	label: string,
): Record<Fields[number], unknown> {
	const held = record(value, label);
	const expected = new Set<string>(fields);
	const keys = Reflect.ownKeys(held);
	if (keys.length !== fields.length || keys.some((key) => typeof key !== 'string' || !expected.has(key))) {
		throw new TypeError(`${label} must be a closed record.`);
	}
	for (const field of fields) {
		const descriptor = Object.getOwnPropertyDescriptor(held, field);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${label}.${field} must be an own enumerable data property.`);
		}
	}
	return held as Record<Fields[number], unknown>;
}

function record(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`${label} must be a plain record.`);
	}
	return value as Record<string, unknown>;
}
