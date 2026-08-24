/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The durable Soundscaper delivery wire.
 *
 * A description is deliberately only authority and a bounded exact plan. It
 * carries neither media bytes nor a filesystem path, and encoded audio always
 * declares atomic restart: no current Soundscaper encoder proves a checkpoint.
 * A result is the equally small publication witness plus the report that was
 * sealed before publication.
 */

import type { DeliveryReport, DeliveryReportItem, DeliveryReportSubject } from './delivery-report.ts';
import {
	BoundedJsonStructureError,
	assertBoundedJsonStructureV1,
} from './bounded-json-structure-v1.ts';
import {
	NativeMediaPlanViolationError,
	fingerprintNativeMediaPlan,
	type NativeMediaPlanFingerprint,
} from './native-media-plan-canonical-form.ts';
import {
	PLATFORM_TRANSFER_HARD_LIMITS,
	createBoundedPortMessage,
} from './platform/bounded-transfer.ts';

export const SOUNDSCAPER_DELIVERY_CONTRACT_VERSION = 1 as const;
export const SOUNDSCAPER_DELIVERY_DESCRIPTION_MESSAGE_TYPE =
	'soundscaper-delivery-description-v1' as const;
export const SOUNDSCAPER_DELIVERY_RESULT_MESSAGE_TYPE =
	'soundscaper-delivery-result-v1' as const;

export interface SoundscaperDeliveryProjectIdentityV1 {
	readonly projectId: string;
	readonly projectRevision: number;
	readonly projectSha256: string;
}

export interface SoundscaperDeliveryDescriptionV1 {
	readonly kind: 'soundscaper-delivery';
	readonly version: typeof SOUNDSCAPER_DELIVERY_CONTRACT_VERSION;
	readonly label: string;
	readonly projectIdentity: SoundscaperDeliveryProjectIdentityV1;
	readonly planPayload: string;
	readonly planFingerprint: string;
	readonly destinationGrantId: string;
	readonly recoveryClass: 'atomic-restart';
}

export interface SoundscaperDeliveryPublicationV1 {
	readonly fileName: string;
	readonly byteLength: number;
	readonly sha256: string;
}

export interface SoundscaperDeliveryResultV1 {
	readonly kind: 'soundscaper-delivery-result';
	readonly version: typeof SOUNDSCAPER_DELIVERY_CONTRACT_VERSION;
	readonly projectIdentity: SoundscaperDeliveryProjectIdentityV1;
	readonly planFingerprint: string;
	readonly publication: SoundscaperDeliveryPublicationV1;
	readonly report: DeliveryReport;
}

export interface SoundscaperDeliveryCurrentAuthorityV1 {
	readonly projectIdentity: SoundscaperDeliveryProjectIdentityV1;
	/** Re-derived from the plan the current project and delivery options produce. */
	readonly planFingerprint: string;
}

export type SoundscaperDeliveryContractErrorCode =
	| 'malformed'
	| 'oversized'
	| 'stale-project'
	| 'stale-plan';

export class SoundscaperDeliveryContractError extends Error {
	readonly code: SoundscaperDeliveryContractErrorCode;

	constructor(code: SoundscaperDeliveryContractErrorCode, message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = 'SoundscaperDeliveryContractError';
		this.code = code;
	}
}

const DESCRIPTION_FIELDS = Object.freeze([
	'kind', 'version', 'label', 'projectIdentity', 'planPayload',
	'planFingerprint', 'destinationGrantId', 'recoveryClass',
] as const);
const RESULT_FIELDS = Object.freeze([
	'kind', 'version', 'projectIdentity', 'planFingerprint', 'publication', 'report',
] as const);
const PROJECT_FIELDS = Object.freeze(['projectId', 'projectRevision', 'projectSha256'] as const);
const CURRENT_FIELDS = Object.freeze(['projectIdentity', 'planFingerprint'] as const);
const PUBLICATION_FIELDS = Object.freeze(['fileName', 'byteLength', 'sha256'] as const);
const REPORT_FIELDS = Object.freeze(['schemaVersion', 'format', 'direction', 'subject', 'items', 'counts'] as const);
const SUBJECT_FIELDS = Object.freeze([
	'format', 'container', 'codec', 'sampleRate', 'channelCount', 'lossless',
] as const);
const ITEM_FIELDS = Object.freeze(['code', 'severity', 'disposition', 'scope', 'data'] as const);
const ITEM_WITH_MESSAGE_FIELDS = Object.freeze([...ITEM_FIELDS, 'message'] as const);
const COUNT_FIELDS = Object.freeze(['preserved', 'converted', 'missing', 'omitted'] as const);
const SHA256 = /^[a-f0-9]{64}$/u;
const PROJECT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const GRANT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/u;
const ITEM_CODE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const DISPOSITIONS = Object.freeze(['preserved', 'converted', 'missing', 'omitted'] as const);
const SEVERITIES = Object.freeze(['info', 'warning', 'error'] as const);
const MAXIMUM_LABEL_BYTES = 1_024;
const MAXIMUM_FILE_NAME_BYTES = 1_024;
const MAXIMUM_REPORT_ITEMS = 4_096;

export function fingerprintSoundscaperDeliveryPlanV1(value: unknown): NativeMediaPlanFingerprint {
	try {
		return fingerprintNativeMediaPlan(value);
	} catch (error) {
		if (error instanceof NativeMediaPlanViolationError) {
			throw violation(error.code === 'oversized' ? 'oversized' : 'malformed',
				`The Soundscaper delivery plan is ${error.code}.`, error);
		}
		throw error;
	}
}

export function createSoundscaperDeliveryDescriptionV1(input: Readonly<{
	readonly label: string;
	readonly projectIdentity: SoundscaperDeliveryProjectIdentityV1;
	readonly plan: unknown;
	readonly destinationGrantId: string;
	readonly recoveryClass?: 'atomic-restart';
}>): SoundscaperDeliveryDescriptionV1 {
	if (input?.recoveryClass !== undefined && input.recoveryClass !== 'atomic-restart') {
		throw violation('malformed', 'A Soundscaper encoded delivery can only declare atomic restart.');
	}
	const fingerprint = fingerprintSoundscaperDeliveryPlanV1(input?.plan);
	return validateSoundscaperDeliveryDescriptionV1({
		kind: 'soundscaper-delivery',
		version: SOUNDSCAPER_DELIVERY_CONTRACT_VERSION,
		label: input?.label,
		projectIdentity: input?.projectIdentity,
		planPayload: fingerprint.canonical,
		planFingerprint: fingerprint.sha256,
		destinationGrantId: input?.destinationGrantId,
		recoveryClass: 'atomic-restart',
	});
}

/** Validate, clone and deeply freeze a description received across a boundary. */
export function validateSoundscaperDeliveryDescriptionV1(
	value: unknown,
): SoundscaperDeliveryDescriptionV1 {
	preflightStructure(value, 'Soundscaper delivery description');
	const row = closedRecord(value, DESCRIPTION_FIELDS, 'Soundscaper delivery description');
	if (row.kind !== 'soundscaper-delivery' || row.version !== SOUNDSCAPER_DELIVERY_CONTRACT_VERSION) {
		throw violation('malformed', 'The Soundscaper delivery description has an unsupported kind or version.');
	}
	const label = boundedText(row.label, MAXIMUM_LABEL_BYTES, 'delivery label');
	const projectIdentity = projectIdentityV1(row.projectIdentity);
	const planPayload = boundedPlanPayload(row.planPayload);
	const planFingerprint = digest(row.planFingerprint, 'delivery plan fingerprint');
	let parsedPlan: unknown;
	try {
		parsedPlan = JSON.parse(planPayload) as unknown;
	} catch (error) {
		throw violation('malformed', 'The Soundscaper delivery plan payload is not JSON.', error);
	}
	const observed = fingerprintSoundscaperDeliveryPlanV1(parsedPlan);
	if (observed.canonical !== planPayload || observed.sha256 !== planFingerprint) {
		throw violation('stale-plan', 'The Soundscaper delivery plan payload and fingerprint disagree.');
	}
	const destinationGrantId = patternText(row.destinationGrantId, GRANT_ID, 'destination grant id');
	if (row.recoveryClass !== 'atomic-restart') {
		throw violation('malformed', 'A Soundscaper encoded delivery can only declare atomic restart.');
	}
	return boundedSnapshot(SOUNDSCAPER_DELIVERY_DESCRIPTION_MESSAGE_TYPE, {
		kind: 'soundscaper-delivery' as const,
		version: SOUNDSCAPER_DELIVERY_CONTRACT_VERSION,
		label,
		projectIdentity,
		planPayload,
		planFingerprint,
		destinationGrantId,
		recoveryClass: 'atomic-restart' as const,
	});
}

export function assertSoundscaperDeliveryDescriptionV1(
	value: unknown,
): asserts value is SoundscaperDeliveryDescriptionV1 {
	validateSoundscaperDeliveryDescriptionV1(value);
}

/** Parse only after the description's exact stored bytes and digest agree. */
export function parseSoundscaperDeliveryPlanV1(descriptionValue: unknown): unknown {
	const description = validateSoundscaperDeliveryDescriptionV1(descriptionValue);
	return frozenCanonicalValue(JSON.parse(description.planPayload) as unknown, 'Soundscaper delivery plan');
}

/** Refuse a queued plan unless both document identity and re-derived semantics remain exact. */
export function assertSoundscaperDeliveryCurrentV1(
	descriptionValue: unknown,
	currentValue: unknown,
): void {
	const description = validateSoundscaperDeliveryDescriptionV1(descriptionValue);
	const current = closedRecord(currentValue, CURRENT_FIELDS, 'Soundscaper delivery current authority');
	const project = projectIdentityV1(current.projectIdentity);
	if (!sameProjectIdentity(description.projectIdentity, project)) {
		throw violation('stale-project', 'The Soundscaper project changed after this delivery was queued.');
	}
	if (digest(current.planFingerprint, 'current delivery plan fingerprint') !== description.planFingerprint) {
		throw violation('stale-plan', 'The current Soundscaper delivery plan no longer matches the queued plan.');
	}
}

/** Validate, clone and deeply freeze the report before any publication commit. */
export function sealSoundscaperDeliveryReportV1(value: unknown): DeliveryReport {
	preflightStructure(value, 'Soundscaper delivery report');
	const row = closedRecord(value, REPORT_FIELDS, 'Soundscaper delivery report');
	if (row.schemaVersion !== 1 || row.format !== 'delivery' || row.direction !== 'export') {
		throw violation('malformed', 'The Soundscaper delivery report has an unsupported schema or direction.');
	}
	const subject = reportSubject(row.subject);
	if (!Array.isArray(row.items) || row.items.length > MAXIMUM_REPORT_ITEMS) {
		throw violation('malformed', 'The Soundscaper delivery report has an invalid item inventory.');
	}
	const items = row.items.map((item, index) => reportItem(item, index));
	const counts = reportCounts(row.counts, items);
	return boundedSnapshot(SOUNDSCAPER_DELIVERY_RESULT_MESSAGE_TYPE, {
		schemaVersion: 1 as const,
		format: 'delivery' as const,
		direction: 'export' as const,
		subject,
		items,
		counts,
	});
}

/**
 * Admit a successful result and, when supplied, bind it to the exact request.
 * Failures and cancellations reject through the job port and therefore never
 * masquerade as a successful result document.
 */
export function validateSoundscaperDeliveryResultV1(
	value: unknown,
	expectedDescription?: SoundscaperDeliveryDescriptionV1 | unknown,
): SoundscaperDeliveryResultV1 {
	preflightStructure(value, 'Soundscaper delivery result');
	const row = closedRecord(value, RESULT_FIELDS, 'Soundscaper delivery result');
	if (row.kind !== 'soundscaper-delivery-result' || row.version !== SOUNDSCAPER_DELIVERY_CONTRACT_VERSION) {
		throw violation('malformed', 'The Soundscaper delivery result has an unsupported kind or version.');
	}
	const projectIdentity = projectIdentityV1(row.projectIdentity);
	const planFingerprint = digest(row.planFingerprint, 'result plan fingerprint');
	const publication = deliveryPublication(row.publication);
	const report = sealSoundscaperDeliveryReportV1(row.report);
	if (expectedDescription !== undefined) {
		const expected = validateSoundscaperDeliveryDescriptionV1(expectedDescription);
		if (!sameProjectIdentity(expected.projectIdentity, projectIdentity)) {
			throw violation('stale-project', 'The delivery result belongs to a different project identity.');
		}
		if (expected.planFingerprint !== planFingerprint) {
			throw violation('stale-plan', 'The delivery result belongs to a different exact plan.');
		}
	}
	return boundedSnapshot(SOUNDSCAPER_DELIVERY_RESULT_MESSAGE_TYPE, {
		kind: 'soundscaper-delivery-result' as const,
		version: SOUNDSCAPER_DELIVERY_CONTRACT_VERSION,
		projectIdentity,
		planFingerprint,
		publication,
		report,
	});
}

export function assertSoundscaperDeliveryResultV1(
	value: unknown,
): asserts value is SoundscaperDeliveryResultV1 {
	validateSoundscaperDeliveryResultV1(value);
}

function projectIdentityV1(value: unknown): SoundscaperDeliveryProjectIdentityV1 {
	const row = closedRecord(value, PROJECT_FIELDS, 'Soundscaper delivery project identity');
	return Object.freeze({
		projectId: patternText(row.projectId, PROJECT_ID, 'project id'),
		projectRevision: nonNegativeInteger(row.projectRevision, 'project revision'),
		projectSha256: digest(row.projectSha256, 'project sha256'),
	});
}

function sameProjectIdentity(
	left: SoundscaperDeliveryProjectIdentityV1,
	right: SoundscaperDeliveryProjectIdentityV1,
): boolean {
	return left.projectId === right.projectId
		&& left.projectRevision === right.projectRevision
		&& left.projectSha256 === right.projectSha256;
}

function deliveryPublication(value: unknown): SoundscaperDeliveryPublicationV1 {
	const row = closedRecord(value, PUBLICATION_FIELDS, 'Soundscaper delivery publication');
	const fileName = boundedText(row.fileName, MAXIMUM_FILE_NAME_BYTES, 'delivery file name');
	if (fileName === '.' || fileName === '..' || /[/\\]/u.test(fileName)) {
		throw violation('malformed', 'The delivery file name must not contain a path.');
	}
	return Object.freeze({
		fileName,
		byteLength: nonNegativeInteger(row.byteLength, 'publication byte length'),
		sha256: digest(row.sha256, 'publication sha256'),
	});
}

function reportSubject(value: unknown): DeliveryReportSubject {
	const row = closedRecord(value, SUBJECT_FIELDS, 'Soundscaper delivery report subject');
	return Object.freeze({
		format: boundedText(row.format, 256, 'report subject format'),
		container: nullableBoundedText(row.container, 256, 'report subject container'),
		codec: nullableBoundedText(row.codec, 256, 'report subject codec'),
		sampleRate: nullablePositiveFinite(row.sampleRate, 'report subject sample rate'),
		channelCount: nullablePositiveInteger(row.channelCount, 'report subject channel count'),
		lossless: row.lossless === null || typeof row.lossless === 'boolean'
			? row.lossless
			: malformed('Report subject lossless must be boolean or null.'),
	});
}

function reportItem(value: unknown, index: number): DeliveryReportItem {
	const candidate = plainRecord(value, `Soundscaper delivery report item ${String(index)}`);
	const hasMessage = Object.hasOwn(candidate, 'message');
	const row = closedRecord(
		candidate,
		hasMessage ? ITEM_WITH_MESSAGE_FIELDS : ITEM_FIELDS,
		`Soundscaper delivery report item ${String(index)}`,
	);
	const disposition = member(row.disposition, DISPOSITIONS, 'report item disposition');
	const message = hasMessage ? boundedText(row.message, 4_096, 'report item message') : null;
	return Object.freeze({
		code: patternText(row.code, ITEM_CODE, 'report item code'),
		severity: member(row.severity, SEVERITIES, 'report item severity'),
		disposition,
		scope: jsonRecord(row.scope, 'report item scope'),
		data: jsonRecord(row.data, 'report item data'),
		...(message === null ? {} : { message }),
	});
}

function reportCounts(
	value: unknown,
	items: readonly DeliveryReportItem[],
): Readonly<Record<(typeof DISPOSITIONS)[number], number>> {
	const row = closedRecord(value, COUNT_FIELDS, 'Soundscaper delivery report counts');
	const observed = { preserved: 0, converted: 0, missing: 0, omitted: 0 };
	for (const item of items) observed[item.disposition] += 1;
	for (const field of COUNT_FIELDS) {
		const count = nonNegativeInteger(row[field], `report count ${field}`);
		if (count !== observed[field]) {
			throw violation('malformed', 'Soundscaper delivery report counts do not match its items.');
		}
	}
	return Object.freeze(observed);
}

function jsonRecord(value: unknown, label: string): Readonly<Record<string, unknown>> {
	plainRecord(value, label);
	const snapshot = frozenCanonicalValue(value, label);
	if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
		throw violation('malformed', `${label} must be a record.`);
	}
	return snapshot as Readonly<Record<string, unknown>>;
}

function frozenCanonicalValue(value: unknown, label: string): unknown {
	try {
		const canonical = fingerprintNativeMediaPlan(value).canonical;
		return deepFreeze(JSON.parse(canonical) as unknown);
	} catch (error) {
		if (error instanceof NativeMediaPlanViolationError) {
			throw violation(error.code === 'oversized' ? 'oversized' : 'malformed', `${label} is not bounded JSON.`, error);
		}
		throw error;
	}
}

function deepFreeze(value: unknown): unknown {
	if (value === null || typeof value !== 'object') return value;
	for (const nested of Array.isArray(value)
		? value
		: Object.values(value as Record<string, unknown>)) deepFreeze(nested);
	return Object.freeze(value);
}

function boundedPlanPayload(value: unknown): string {
	if (typeof value !== 'string' || value.length === 0) {
		throw violation('malformed', 'The Soundscaper delivery plan payload must be non-empty.');
	}
	if (new TextEncoder().encode(value).byteLength > PLATFORM_TRANSFER_HARD_LIMITS.messageBytes) {
		throw violation('oversized', 'The Soundscaper delivery plan payload exceeds the message ceiling.');
	}
	return value;
}

function boundedSnapshot<Value>(type: string, value: Value): Value {
	try {
		assertBoundedJsonStructureV1(value);
		return createBoundedPortMessage(type, value, {
			sequence: 0,
			maximumEncodedBytes: PLATFORM_TRANSFER_HARD_LIMITS.messageBytes,
		}).payload;
	} catch (error) {
		if (error instanceof BoundedJsonStructureError) {
			throw violation(error.code, error.message, error);
		}
		throw violation('oversized', `The ${type} payload exceeds its bounded port message.`, error);
	}
}

function preflightStructure(value: unknown, label: string): void {
	try {
		assertBoundedJsonStructureV1(value);
	} catch (error) {
		if (error instanceof BoundedJsonStructureError) {
			throw violation(error.code, `${label}: ${error.message}`, error);
		}
		throw error;
	}
}

function closedRecord<const Field extends string>(
	value: unknown,
	fields: readonly Field[],
	label: string,
): Readonly<Record<Field, unknown>> {
	const row = plainRecord(value, label);
	const keys = Reflect.ownKeys(row);
	if (keys.length !== fields.length || keys.some(
		(key) => typeof key !== 'string' || !fields.includes(key as Field),
	)) throw violation('malformed', `${label} has missing or unsupported fields.`);
	for (const field of fields) {
		const descriptor = Object.getOwnPropertyDescriptor(row, field);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw violation('malformed', `${label}.${field} must be an own enumerable data property.`);
		}
	}
	return row as Readonly<Record<Field, unknown>>;
}

function plainRecord(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw violation('malformed', `${label} must be a plain record.`);
	}
	return value as Record<string, unknown>;
}

function member<const Value extends string>(value: unknown, values: readonly Value[], label: string): Value {
	if (typeof value !== 'string' || !(values as readonly string[]).includes(value)) {
		throw violation('malformed', `${label} is invalid.`);
	}
	return value as Value;
}

function patternText(value: unknown, pattern: RegExp, label: string): string {
	if (typeof value !== 'string' || !pattern.test(value)) {
		throw violation('malformed', `The ${label} is invalid.`);
	}
	return value;
}

function boundedText(value: unknown, maximumBytes: number, label: string): string {
	if (typeof value !== 'string' || value.length === 0 || value !== value.trim()
		|| new TextEncoder().encode(value).byteLength > maximumBytes) {
		throw violation('malformed', `The ${label} must be a bounded non-empty string.`);
	}
	return value;
}

function nullableBoundedText(value: unknown, maximumBytes: number, label: string): string | null {
	return value === null ? null : boundedText(value, maximumBytes, label);
}

function nonNegativeInteger(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) {
		throw violation('malformed', `The ${label} must be a non-negative safe integer.`);
	}
	return Number(value);
}

function positiveInteger(value: unknown, label: string): number {
	const output = nonNegativeInteger(value, label);
	if (output === 0) throw violation('malformed', `The ${label} must be greater than zero.`);
	return output;
}

function nullablePositiveInteger(value: unknown, label: string): number | null {
	return value === null ? null : positiveInteger(value, label);
}

function nullablePositiveFinite(value: unknown, label: string): number | null {
	if (value === null) return null;
	if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
		throw violation('malformed', `The ${label} must be a positive finite number or null.`);
	}
	return value;
}

function digest(value: unknown, label: string): string {
	return patternText(value, SHA256, label);
}

function malformed(message: string): never {
	throw violation('malformed', message);
}

function violation(
	code: SoundscaperDeliveryContractErrorCode,
	message: string,
	cause?: unknown,
): SoundscaperDeliveryContractError {
	return new SoundscaperDeliveryContractError(code, message, cause === undefined ? undefined : { cause });
}
