/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * A conversion ledger travels beside, never inside, a product-native Scape
 * archive. This module owns its closed JSON schema and its archive binding so
 * live postMessage traffic and downloaded/manual fallback files admit exactly
 * the same artifact.
 */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import type {
	CrossProductHandoffConversionReportV1,
	CrossProductHandoffDisposition,
} from './cross-product-handoff-conversion.ts';
import { crossProductHandoffRootNames } from './cross-product-handoff-root-contract.ts';

export const CROSS_PRODUCT_HANDOFF_REPORT_SIDECAR_KIND =
	'cross-product-editable-copy-report-sidecar' as const;
export const CROSS_PRODUCT_HANDOFF_REPORT_SIDECAR_VERSION = 1 as const;
export const CROSS_PRODUCT_HANDOFF_REPORT_SIDECAR_SUFFIX = '.conversion-report.json' as const;
export const CROSS_PRODUCT_HANDOFF_REPORT_SIDECAR_MIME_TYPE = 'application/json' as const;
export const CROSS_PRODUCT_HANDOFF_REPORT_SIDECAR_MAX_BYTES = 128 * 1024;
export const CROSS_PRODUCT_HANDOFF_FILE_NAME_MAX_BYTES = 255;

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder('utf-8', { fatal: true });
const MAXIMUM_ID_LENGTH = 256;
const MAXIMUM_ROOTS = 128;
const MAXIMUM_ROOT_LENGTH = 128;
const MAXIMUM_REASON_LENGTH = 512;
const MAXIMUM_REF_LENGTH = 1024;
const MAXIMUM_ARCHIVE_BYTES = 8 * 1024 * 1024 * 1024;
const HASH_PATTERN = /^[0-9a-f]{64}$/u;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;
const UNSAFE_FILE_NAME_CHARACTERS = /[\\/:*?"<>|\u0000-\u001f]+/gu;
const TRAILING_FILE_NAME_CHARACTERS = /[. ]+$/gu;
const PROJECT_FILE_EXTENSION_PATTERN = /\.(?:sscape|fscape|liscape|scape)$/iu;
const ARCHIVE_FILE_NAME_MAX_BYTES = CROSS_PRODUCT_HANDOFF_FILE_NAME_MAX_BYTES
	- TEXT_ENCODER.encode(CROSS_PRODUCT_HANDOFF_REPORT_SIDECAR_SUFFIX).byteLength;

const SIDECAR_FIELDS = Object.freeze([
	'kind', 'version', 'entryId', 'archiveByteLength', 'archiveSha256', 'report',
] as const);
const REPORT_FIELDS = Object.freeze([
	'kind', 'version', 'invocationId', 'refused', 'source', 'destination', 'roots',
] as const);
const PROJECT_REF_FIELDS = Object.freeze([
	'schemaFamily', 'schemaVersion', 'projectId', 'sha256',
] as const);
const ROOT_FIELDS = Object.freeze([
	'root', 'disposition', 'reason', 'sourceRef', 'destinationRef',
	'sourceSha256', 'destinationSha256',
] as const);

const DISPOSITIONS: ReadonlySet<string> = new Set([
	'copy', 'materialize-fallback', 'omit-with-report', 'refuse',
]);

interface AdmittedProjectRef {
	readonly schemaFamily: 'soundscaper' | 'framescaper';
	readonly schemaVersion: 1;
	readonly projectId: string;
	readonly sha256: string;
}

export interface CrossProductHandoffReportSidecarV1 {
	readonly kind: typeof CROSS_PRODUCT_HANDOFF_REPORT_SIDECAR_KIND;
	readonly version: typeof CROSS_PRODUCT_HANDOFF_REPORT_SIDECAR_VERSION;
	readonly entryId: string;
	readonly archiveByteLength: number;
	readonly archiveSha256: string;
	readonly report: Readonly<CrossProductHandoffConversionReportV1>;
}

export interface CrossProductHandoffReportArchiveBinding {
	readonly entryId: string;
	readonly archive: Uint8Array;
}

export interface CreateCrossProductHandoffReportSidecarOptions
	extends CrossProductHandoffReportArchiveBinding {
	readonly report: unknown;
}

export interface CreateCrossProductHandoffReportSidecarFromBindingOptions {
	readonly entryId: string;
	readonly archiveByteLength: number;
	readonly archiveSha256: string;
	readonly report: unknown;
}

/** Construct and re-admit the exact sidecar live and fallback transports share. */
export function createCrossProductHandoffReportSidecar(
	options: CreateCrossProductHandoffReportSidecarOptions,
): Readonly<CrossProductHandoffReportSidecarV1> {
	const entryId = boundedText(options?.entryId, MAXIMUM_ID_LENGTH, 'entryId');
	const archive = archiveBytes(options?.archive);
	return createCrossProductHandoffReportSidecarFromBinding({
		entryId,
		archiveByteLength: archive.byteLength,
		archiveSha256: digest(archive),
		report: options?.report,
	});
}

/**
 * Build from a digest already computed over the exact archive stream. This is
 * the zero-copy seam for desktop Blob writers; later receive admission still
 * verifies the binding against payload bytes before exposing the report.
 */
export function createCrossProductHandoffReportSidecarFromBinding(
	options: CreateCrossProductHandoffReportSidecarFromBindingOptions,
): Readonly<CrossProductHandoffReportSidecarV1> {
	return admitSidecarShape({
		kind: CROSS_PRODUCT_HANDOFF_REPORT_SIDECAR_KIND,
		version: CROSS_PRODUCT_HANDOFF_REPORT_SIDECAR_VERSION,
		entryId: options?.entryId,
		archiveByteLength: options?.archiveByteLength,
		archiveSha256: options?.archiveSha256,
		report: options?.report,
	});
}

/** Closed object admission plus entry id, byte length, and SHA-256 verification. */
export function admitCrossProductHandoffReportSidecar(
	value: unknown,
	binding: CrossProductHandoffReportArchiveBinding,
): Readonly<CrossProductHandoffReportSidecarV1> {
	const admitted = admitSidecarShape(value);
	const entryId = boundedText(binding?.entryId, MAXIMUM_ID_LENGTH, 'binding.entryId');
	const archive = archiveBytes(binding?.archive);
	if (admitted.entryId !== entryId) {
		throw new TypeError('The conversion report sidecar entryId does not match its archive entry.');
	}
	if (admitted.archiveByteLength !== archive.byteLength) {
		throw new TypeError('The conversion report sidecar archive byte length does not match its payload.');
	}
	if (admitted.archiveSha256 !== digest(archive)) {
		throw new TypeError('The conversion report sidecar archive digest does not match its payload.');
	}
	return admitted;
}

/** Decode one bounded UTF-8 JSON sidecar and verify it against its archive. */
export function decodeCrossProductHandoffReportSidecar(
	bytes: Uint8Array,
	binding: CrossProductHandoffReportArchiveBinding,
): Readonly<CrossProductHandoffReportSidecarV1> {
	if (!(bytes instanceof Uint8Array) || bytes.byteLength > CROSS_PRODUCT_HANDOFF_REPORT_SIDECAR_MAX_BYTES) {
		throw new RangeError(
			`A conversion report sidecar must be at most ${CROSS_PRODUCT_HANDOFF_REPORT_SIDECAR_MAX_BYTES} bytes.`,
		);
	}
	let decoded: unknown;
	try {
		decoded = JSON.parse(TEXT_DECODER.decode(bytes));
	} catch (error) {
		throw new SyntaxError('The conversion report sidecar is not bounded UTF-8 JSON.', { cause: error });
	}
	return admitCrossProductHandoffReportSidecar(decoded, binding);
}

/** Manual fallback has no trusted entry id until this closed sidecar is read. */
export function decodeCrossProductHandoffReportSidecarFile(
	bytes: Uint8Array,
	archive: Uint8Array,
): Readonly<CrossProductHandoffReportSidecarV1> {
	if (!(bytes instanceof Uint8Array) || bytes.byteLength > CROSS_PRODUCT_HANDOFF_REPORT_SIDECAR_MAX_BYTES) {
		throw new RangeError(
			`A conversion report sidecar must be at most ${CROSS_PRODUCT_HANDOFF_REPORT_SIDECAR_MAX_BYTES} bytes.`,
		);
	}
	let decoded: unknown;
	try {
		decoded = JSON.parse(TEXT_DECODER.decode(bytes));
	} catch (error) {
		throw new SyntaxError('The conversion report sidecar is not bounded UTF-8 JSON.', { cause: error });
	}
	const shaped = admitSidecarShape(decoded);
	return admitCrossProductHandoffReportSidecar(shaped, {
		entryId: shaped.entryId,
		archive,
	});
}

/** Stable JSON bytes used unchanged by download fallback. */
export function encodeCrossProductHandoffReportSidecar(value: unknown): Uint8Array<ArrayBuffer> {
	const admitted = admitSidecarShape(value);
	const bytes = TEXT_ENCODER.encode(JSON.stringify(admitted));
	if (bytes.byteLength > CROSS_PRODUCT_HANDOFF_REPORT_SIDECAR_MAX_BYTES) {
		throw new RangeError(
			`The conversion report sidecar exceeds ${CROSS_PRODUCT_HANDOFF_REPORT_SIDECAR_MAX_BYTES} bytes.`,
		);
	}
	return bytes;
}

/** Reserve the exact companion suffix while retaining a canonical project extension. */
export function boundCrossProductHandoffArchiveFileName(value: unknown): string {
	const sanitized = String(value ?? '')
		.trim()
		.replace(UNSAFE_FILE_NAME_CHARACTERS, '-')
		.replace(TRAILING_FILE_NAME_CHARACTERS, '') || 'project.sscape';
	const extension = PROJECT_FILE_EXTENSION_PATTERN.exec(sanitized)?.[0] ?? null;
	if (extension === null) {
		throw new TypeError('A conversion-report archive file name needs an accepted project extension.');
	}
	const rawStem = sanitized.slice(0, -extension.length).replace(TRAILING_FILE_NAME_CHARACTERS, '');
	const maximumStemBytes = ARCHIVE_FILE_NAME_MAX_BYTES - TEXT_ENCODER.encode(extension).byteLength;
	let stem = '';
	let stemBytes = 0;
	for (const character of rawStem || 'project') {
		const bytes = TEXT_ENCODER.encode(character).byteLength;
		if (stemBytes + bytes > maximumStemBytes) break;
		stem += character;
		stemBytes += bytes;
	}
	if (!stem) stem = 'project';
	return `${stem}${extension}`;
}

export function crossProductHandoffReportSidecarFileName(archiveFileName: unknown): string {
	if (typeof archiveFileName !== 'string') {
		throw new TypeError('A conversion-report archive file name must be text.');
	}
	const bounded = boundCrossProductHandoffArchiveFileName(archiveFileName);
	if (bounded !== archiveFileName) {
		throw new RangeError('The conversion-report archive file name is not canonical inside its filename budget.');
	}
	return `${bounded}${CROSS_PRODUCT_HANDOFF_REPORT_SIDECAR_SUFFIX}`;
}

export function isCrossProductHandoffReportSidecarFileName(value: unknown): boolean {
	return typeof value === 'string'
		&& value.toLowerCase().endsWith(CROSS_PRODUCT_HANDOFF_REPORT_SIDECAR_SUFFIX);
}

export function archiveFileNameForCrossProductHandoffReportSidecar(value: unknown): string | null {
	if (!isCrossProductHandoffReportSidecarFileName(value)) return null;
	return (value as string).slice(0, -CROSS_PRODUCT_HANDOFF_REPORT_SIDECAR_SUFFIX.length);
}

function admitSidecarShape(value: unknown): Readonly<CrossProductHandoffReportSidecarV1> {
	const sidecar = exactRecord(value, SIDECAR_FIELDS, 'Conversion report sidecar');
	if (sidecar.kind !== CROSS_PRODUCT_HANDOFF_REPORT_SIDECAR_KIND
		|| sidecar.version !== CROSS_PRODUCT_HANDOFF_REPORT_SIDECAR_VERSION) {
		throw new RangeError('The conversion report sidecar kind or version is unsupported.');
	}
	const entryId = boundedText(sidecar.entryId, MAXIMUM_ID_LENGTH, 'sidecar.entryId');
	const archiveByteLength = boundedInteger(
		sidecar.archiveByteLength, 0, MAXIMUM_ARCHIVE_BYTES, 'sidecar.archiveByteLength',
	);
	const archiveSha256 = admittedHash(sidecar.archiveSha256, 'sidecar.archiveSha256');
	const report = admittedReport(sidecar.report);
	if (report.refused || report.destination === null) {
		throw new TypeError('Only a successful conversion report may be bound to an exported archive.');
	}
	if (report.destination.projectId !== entryId) {
		throw new TypeError('The conversion report destination does not match the sidecar entryId.');
	}
	const admitted = Object.freeze({
		kind: CROSS_PRODUCT_HANDOFF_REPORT_SIDECAR_KIND,
		version: CROSS_PRODUCT_HANDOFF_REPORT_SIDECAR_VERSION,
		entryId,
		archiveByteLength,
		archiveSha256,
		report,
	});
	const encoded = TEXT_ENCODER.encode(JSON.stringify(admitted));
	if (encoded.byteLength > CROSS_PRODUCT_HANDOFF_REPORT_SIDECAR_MAX_BYTES) {
		throw new RangeError(
			`The conversion report sidecar exceeds ${CROSS_PRODUCT_HANDOFF_REPORT_SIDECAR_MAX_BYTES} bytes.`,
		);
	}
	return admitted;
}

function admittedReport(value: unknown): Readonly<CrossProductHandoffConversionReportV1> {
	const report = exactRecord(value, REPORT_FIELDS, 'Conversion report');
	if (report.kind !== 'cross-product-editable-copy-report' || report.version !== 1) {
		throw new RangeError('The conversion report kind or version is unsupported.');
	}
	if (typeof report.refused !== 'boolean') {
		throw new TypeError('Conversion report refused must be boolean.');
	}
	const source = admittedProjectRef(report.source, 'report.source');
	const destination = report.destination === null
		? null : admittedProjectRef(report.destination, 'report.destination');
	if (destination !== null && destination.schemaFamily === source.schemaFamily) {
		throw new TypeError('A cross-product conversion report must name different product families.');
	}
	if (destination !== null && destination.projectId === source.projectId) {
		throw new TypeError('A cross-product conversion report must use a separately identified destination project id.');
	}
	const roots = admittedRoots(report.roots, source, destination);
	const refused = roots.some(({ disposition }) => disposition === 'refuse');
	if (report.refused !== refused) {
		throw new TypeError('A conversion report refused flag must agree with its root dispositions.');
	}
	if (report.refused !== (destination === null)) {
		throw new TypeError('A conversion report destination must be null exactly when conversion was refused.');
	}
	return Object.freeze({
		kind: 'cross-product-editable-copy-report',
		version: 1,
		invocationId: boundedText(report.invocationId, MAXIMUM_ID_LENGTH, 'report.invocationId'),
		refused: report.refused,
		source,
		destination,
		roots,
	});
}

function admittedProjectRef(value: unknown, label: string): Readonly<AdmittedProjectRef> {
	const ref = exactRecord(value, PROJECT_REF_FIELDS, label);
	if (ref.schemaFamily !== 'soundscaper' && ref.schemaFamily !== 'framescaper') {
		throw new TypeError(`${label}.schemaFamily is unsupported.`);
	}
	if (ref.schemaVersion !== 1) throw new TypeError(`${label}.schemaVersion must be family v1.`);
	return Object.freeze({
		schemaFamily: ref.schemaFamily,
		schemaVersion: 1,
		projectId: boundedText(ref.projectId, MAXIMUM_ID_LENGTH, `${label}.projectId`),
		sha256: admittedHash(ref.sha256, `${label}.sha256`),
	});
}

function admittedRoots(
	value: unknown,
	source: Readonly<AdmittedProjectRef>,
	destination: Readonly<AdmittedProjectRef> | null,
): readonly CrossProductHandoffConversionReportV1['roots'][number][] {
	const rows = admittedDenseDataArray(value, 'Conversion report roots', 1, MAXIMUM_ROOTS);
	const seen = new Set<string>();
	const roots = rows.map((held, index) => {
		const row = exactRecord(held, ROOT_FIELDS, `Conversion report root ${index}`);
		const root = boundedText(row.root, MAXIMUM_ROOT_LENGTH, `report.roots[${index}].root`);
		if (seen.has(root)) throw new TypeError(`Conversion report root ${root} is duplicated.`);
		seen.add(root);
		if (typeof row.disposition !== 'string' || !DISPOSITIONS.has(row.disposition)) {
			throw new TypeError(`Conversion report root ${root} has an unsupported disposition.`);
		}
		const sourceRef = boundedText(row.sourceRef, MAXIMUM_REF_LENGTH, `report.roots[${index}].sourceRef`);
		const expectedSourceRef = `${source.schemaFamily}:${source.projectId}#/${root}`;
		if (sourceRef !== expectedSourceRef) throw new TypeError(`Conversion report root ${root} has the wrong sourceRef.`);
		const destinationRef = nullableText(
			row.destinationRef, MAXIMUM_REF_LENGTH, `report.roots[${index}].destinationRef`,
		);
		const destinationSha256 = nullableHash(
			row.destinationSha256, `report.roots[${index}].destinationSha256`,
		);
		if ((destinationRef === null) !== (destinationSha256 === null)) {
			throw new TypeError(`Conversion report root ${root} has an incomplete destination binding.`);
		}
		if (destinationRef !== null) {
			if (destination === null
				|| destinationRef !== `${destination.schemaFamily}:${destination.projectId}#/${root}`) {
				throw new TypeError(`Conversion report root ${root} has the wrong destinationRef.`);
			}
			if (!crossProductHandoffRootNames(destination.schemaFamily).includes(root)) {
				throw new TypeError(`Conversion report root ${root} is not owned by its destination family.`);
			}
		}
		const sourceSha256 = admittedHash(
			row.sourceSha256, `report.roots[${index}].sourceSha256`,
		);
		if (row.disposition === 'copy'
			&& (destinationSha256 === null || destinationSha256 !== sourceSha256)) {
			throw new TypeError(`Conversion report root ${root} copy digests do not match.`);
		}
		return Object.freeze({
			root,
			disposition: row.disposition as CrossProductHandoffDisposition,
			reason: boundedText(row.reason, MAXIMUM_REASON_LENGTH, `report.roots[${index}].reason`),
			sourceRef,
			destinationRef,
			sourceSha256,
			destinationSha256,
		});
	});
	const expected = crossProductHandoffRootNames(source.schemaFamily);
	if (roots.length !== expected.length || expected.some((root) => !seen.has(root))) {
		throw new TypeError(`A conversion report must classify every ${source.schemaFamily} family-v1 root exactly once.`);
	}
	return Object.freeze(roots);
}

function admittedDenseDataArray(
	value: unknown,
	label: string,
	minimumLength: number,
	maximumLength: number,
): readonly unknown[] {
	if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
		throw new TypeError(`${label} must be an ordinary array.`);
	}
	const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
	const length = lengthDescriptor?.value;
	if (!lengthDescriptor || lengthDescriptor.enumerable || !Object.hasOwn(lengthDescriptor, 'value')
		|| !Number.isSafeInteger(length) || length < minimumLength || length > maximumLength) {
		throw new TypeError(`${label} must contain ${String(minimumLength)} to ${String(maximumLength)} rows.`);
	}
	if (Reflect.ownKeys(value).length !== length + 1) {
		throw new TypeError(`${label} must be dense and cannot carry extra authority.`);
	}
	const result: unknown[] = [];
	for (let index = 0; index < length; index += 1) {
		const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${label} indices must be own enumerable data.`);
		}
		result.push(descriptor.value);
	}
	return result;
}

function archiveBytes(value: unknown): Uint8Array {
	if (!(value instanceof Uint8Array) || value.byteLength > MAXIMUM_ARCHIVE_BYTES) {
		throw new TypeError(`A conversion report archive must be a Uint8Array of at most ${MAXIMUM_ARCHIVE_BYTES} bytes.`);
	}
	return value;
}

function digest(bytes: Uint8Array): string { return bytesToHex(sha256(bytes)); }

function admittedHash(value: unknown, label: string): string {
	if (typeof value !== 'string' || !HASH_PATTERN.test(value)) {
		throw new TypeError(`${label} must be a lowercase SHA-256 digest.`);
	}
	return value;
}

function nullableHash(value: unknown, label: string): string | null {
	return value === null ? null : admittedHash(value, label);
}

function nullableText(value: unknown, maximum: number, label: string): string | null {
	return value === null ? null : boundedText(value, maximum, label);
}

function boundedText(value: unknown, maximum: number, label: string): string {
	if (typeof value !== 'string' || value.length < 1 || value.length > maximum
		|| CONTROL_CHARACTERS.test(value)) {
		throw new TypeError(`${label} must be printable text of 1 to ${maximum} characters.`);
	}
	return value;
}

function boundedInteger(value: unknown, minimum: number, maximum: number, label: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
		throw new TypeError(`${label} must be an integer in [${minimum}, ${maximum}].`);
	}
	return value;
}

function exactRecord<const Fields extends readonly string[]>(
	value: unknown,
	fields: Fields,
	label: string,
): Record<Fields[number], unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`${label} must be a plain record.`);
	}
	const candidate = value as Record<string, unknown>;
	const expected = new Set<string>(fields);
	const keys = Reflect.ownKeys(candidate);
	const unknown = keys.find((key) => typeof key !== 'string' || !expected.has(key));
	if (unknown !== undefined || keys.length !== fields.length) {
		throw new TypeError(`${label} has an unknown field or is not closed: ${String(unknown ?? '(missing)')}.`);
	}
	for (const field of fields) {
		const descriptor = Object.getOwnPropertyDescriptor(candidate, field);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${label}.${field} must be an own enumerable data property.`);
		}
	}
	return candidate as Record<Fields[number], unknown>;
}
