/* SPDX-License-Identifier: AGPL-3.0-only */

/** Deterministic seed and sealed result for one Framescaper native delivery job. */

import { assertNativeMediaRelativeDestination } from '../common/editor/native-media-atomic-publication.ts';
import { fingerprintNativeMediaPlan } from '../common/editor/native-media-plan-canonical-form.ts';
import {
	nativeMediaV14EncodeDispatch,
	type NativeMediaV14EncodeProfileId,
} from '../common/editor/native-media-v14-native-dispatch.ts';
import {
	findPlatformDeliveryPreset,
	type PlatformNativeMediaV15Execution,
} from '../common/editor/platform-delivery-presets.ts';
import type { UnifiedExactRenderTimingSidecars } from '../common/editor/unified-exact-render-plan.ts';
import {
	deriveFramescaperNativeDeliveryClosureV1,
	type FramescaperNativeCaptionDispositionV1,
	type FramescaperNativeDeliveryArtifactManifestEntryV1,
} from './delivery-native-report-closure-v1.ts';
import type {
	DeliveryDisposition,
	DeliveryReport,
	DeliveryReportItem,
	DeliveryReportSubject,
} from '../common/editor/delivery-report.ts';

export type {
	FramescaperNativeCaptionDispositionV1,
	FramescaperNativeDeliveryArtifactManifestEntryV1,
} from './delivery-native-report-closure-v1.ts';

export interface FramescaperNativeDeliveryReportSeedV1 {
	readonly schemaVersion: 1;
	readonly jobId: string;
	readonly planFingerprint: string;
	readonly targetId: string;
	readonly profileId: NativeMediaV14EncodeProfileId;
	readonly hardwarePolicy: PlatformNativeMediaV15Execution['hardwarePolicy'];
	readonly captionDisposition: FramescaperNativeCaptionDispositionV1;
	readonly requiredArtifactManifest: readonly FramescaperNativeDeliveryArtifactManifestEntryV1[];
	readonly requiredConformanceCheckIds: readonly string[];
	readonly plannedReport: DeliveryReport;
	readonly seedFingerprint: string;
}

export interface FramescaperNativeDeliveryBackendAttemptV1 {
	readonly attempt: number;
	readonly backend: string;
	readonly outcome: 'succeeded' | 'failed' | 'web-core-required';
	readonly failureCode: string | null;
}

export interface FramescaperNativeDeliveryConformanceV1 {
	readonly checkId: string;
	readonly passed: boolean;
	readonly detail: string | null;
}

export interface FramescaperNativeDeliveryArtifactV1 {
	readonly artifactId: string;
	readonly kind: 'file' | 'directory';
	readonly relativePath: string;
	readonly byteLength: number;
	readonly sha256: string;
}

export interface FramescaperNativeDeliveryReportV1 {
	readonly schemaVersion: 1;
	readonly jobId: string;
	readonly seedFingerprint: string;
	readonly planFingerprint: string;
	readonly targetId: string;
	readonly profileId: NativeMediaV14EncodeProfileId;
	readonly hardwarePolicy: PlatformNativeMediaV15Execution['hardwarePolicy'];
	readonly captionDisposition: FramescaperNativeCaptionDispositionV1;
	readonly status: 'succeeded' | 'failed';
	readonly backendAttempts: readonly FramescaperNativeDeliveryBackendAttemptV1[];
	readonly conformance: readonly FramescaperNativeDeliveryConformanceV1[];
	readonly artifacts: readonly FramescaperNativeDeliveryArtifactV1[];
	readonly publication: 'complete' | 'not-published';
	readonly report: DeliveryReport;
}

const JOB_ID = /^[a-f0-9]{40}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,4095}$/u;
const FAILURE = /^[a-z][a-z0-9-]{0,63}$/u;
const CAPTION_DISPOSITIONS = Object.freeze([
	'none', 'sidecar', 'mux', 'burn-in', 'mux-and-burn-in',
	'mux-and-sidecar', 'burn-in-and-sidecar', 'mux-and-burn-in-and-sidecar',
] as const);
const DISPOSITIONS = Object.freeze(['preserved', 'converted', 'missing', 'omitted'] as const);

export function createFramescaperNativeDeliveryReportSeedV1(input: Readonly<{
	readonly jobId: string;
	readonly targetId: string;
	readonly envelope: unknown;
	readonly timingSidecars?: UnifiedExactRenderTimingSidecars;
	readonly deliveryBundle?: unknown;
	readonly plannedReport: DeliveryReport;
}>): FramescaperNativeDeliveryReportSeedV1 {
	const row = exactRecord(input, [
		'jobId', 'targetId', 'envelope', 'timingSidecars', 'deliveryBundle', 'plannedReport',
	], 'native delivery report seed input', ['timingSidecars', 'deliveryBundle']);
	const authority = deriveFramescaperNativeDeliveryClosureV1({
		targetId: row.targetId as string,
		envelope: row.envelope,
		timingSidecars: row.timingSidecars as UnifiedExactRenderTimingSidecars | undefined,
		deliveryBundle: row.deliveryBundle,
	});
	return createSeed({
		jobId: row.jobId,
		planFingerprint: authority.planFingerprint,
		targetId: row.targetId,
		profileId: authority.profileId,
		captionDisposition: authority.captionDisposition,
		requiredArtifactManifest: authority.requiredArtifactManifest,
		requiredConformanceCheckIds: authority.requiredConformanceCheckIds,
		plannedReport: row.plannedReport,
	});
}

function createSeed(input: Readonly<{
	readonly jobId: unknown;
	readonly planFingerprint: unknown;
	readonly targetId: unknown;
	readonly profileId: unknown;
	readonly captionDisposition: unknown;
	readonly requiredArtifactManifest: unknown;
	readonly requiredConformanceCheckIds: unknown;
	readonly plannedReport: unknown;
}>): FramescaperNativeDeliveryReportSeedV1 {
	const profileId = text(input.profileId, ID, 'native delivery report profile ID');
	nativeMediaV14EncodeDispatch(profileId as NativeMediaV14EncodeProfileId);
	const targetId = text(input.targetId, ID, 'native delivery report target ID');
	const execution = nativeTargetExecution(targetId, profileId as NativeMediaV14EncodeProfileId);
	const foundation = Object.freeze({
		schemaVersion: 1 as const,
		jobId: text(input.jobId, JOB_ID, 'native delivery report jobId'),
		planFingerprint: text(input.planFingerprint, SHA256, 'native delivery report plan fingerprint'),
		targetId,
		profileId: profileId as NativeMediaV14EncodeProfileId,
		hardwarePolicy: execution.hardwarePolicy,
		captionDisposition: member(
			input.captionDisposition, CAPTION_DISPOSITIONS, 'native delivery caption disposition',
		),
		requiredArtifactManifest: artifactManifest(input.requiredArtifactManifest),
		requiredConformanceCheckIds: conformanceCheckIds(input.requiredConformanceCheckIds),
		plannedReport: snapshotDeliveryReport(input.plannedReport),
	});
	return Object.freeze({
		...foundation,
		seedFingerprint: fingerprintNativeMediaPlan(foundation).sha256,
	});
}

export function assertFramescaperNativeDeliveryReportSeedV1(
	value: unknown,
): asserts value is FramescaperNativeDeliveryReportSeedV1 {
	const input = exactRecord(value, [
		'schemaVersion', 'jobId', 'planFingerprint', 'targetId', 'profileId',
		'hardwarePolicy', 'captionDisposition', 'requiredArtifactManifest',
		'requiredConformanceCheckIds', 'plannedReport', 'seedFingerprint',
	], 'native delivery report seed');
	if (input.schemaVersion !== 1) throw new RangeError('Native delivery report seed version is unsupported.');
	const derived = createSeed({
		jobId: input.jobId,
		planFingerprint: input.planFingerprint,
		targetId: input.targetId,
		profileId: input.profileId,
		captionDisposition: input.captionDisposition,
		requiredArtifactManifest: input.requiredArtifactManifest,
		requiredConformanceCheckIds: input.requiredConformanceCheckIds,
		plannedReport: input.plannedReport,
	});
	if (input.seedFingerprint !== derived.seedFingerprint
		|| fingerprintNativeMediaPlan(value).canonical
			!== fingerprintNativeMediaPlan(derived).canonical) {
		throw new Error('Native delivery report seed is not its exact derived value.');
	}
}

export function sealFramescaperNativeDeliveryReportV1(
	seedValue: unknown,
	resultValue: unknown,
): FramescaperNativeDeliveryReportV1 {
	assertFramescaperNativeDeliveryReportSeedV1(seedValue);
	const seed = seedValue;
	const result = exactRecord(resultValue, [
		'status', 'backendAttempts', 'conformance', 'artifacts', 'publication', 'finalReport',
	], 'native delivery report result');
	const status = member(result.status, ['succeeded', 'failed'] as const, 'native delivery status');
	const backendAttempts = attempts(result.backendAttempts, seed.hardwarePolicy);
	const conformance = conformanceRows(result.conformance);
	const artifacts = artifactRows(result.artifacts);
	const publication = member(
		result.publication, ['complete', 'not-published'] as const, 'native delivery publication',
	);
	const report = snapshotDeliveryReport(result.finalReport);
	assertPlannedReportPreserved(seed.plannedReport, report);
	const last = backendAttempts.at(-1)!;
	if (status === 'succeeded') {
		if (last.outcome !== 'succeeded' || publication !== 'complete' || artifacts.length === 0) {
			throw new Error('A succeeded native delivery requires verified artifacts and complete publication.');
		}
		if (conformance.length === 0 || conformance.some(({ passed }) => !passed)) {
			throw new Error('A succeeded native delivery requires passing conformance results.');
		}
		assertSuccessfulClosure(seed, artifacts, conformance);
	} else if (last.outcome === 'succeeded' || publication !== 'not-published' || artifacts.length !== 0) {
		throw new Error('A failed native delivery cannot carry publication or artifact receipts.');
	}
	return deepFreeze({
		schemaVersion: 1 as const,
		jobId: seed.jobId,
		seedFingerprint: seed.seedFingerprint,
		planFingerprint: seed.planFingerprint,
		targetId: seed.targetId,
		profileId: seed.profileId,
		hardwarePolicy: seed.hardwarePolicy,
		captionDisposition: seed.captionDisposition,
		status,
		backendAttempts,
		conformance,
		artifacts,
		publication,
		report,
	});
}

function nativeTargetExecution(
	targetId: string,
	profileId: NativeMediaV14EncodeProfileId,
): PlatformNativeMediaV15Execution {
	const preset = findPlatformDeliveryPreset(targetId);
	if (!preset) throw new RangeError(`Native delivery report target ${targetId} is not in the platform catalog.`);
	if (preset.execution.kind !== 'native-media-v15') {
		throw new RangeError(`Platform delivery target ${targetId} is not a native-media-v15 target.`);
	}
	if (preset.execution.profileId !== profileId) {
		throw new RangeError(
			`Platform delivery target ${targetId} does not select exact profile ${profileId}.`,
		);
	}
	return preset.execution;
}

function assertPlannedReportPreserved(planned: DeliveryReport, final: DeliveryReport): void {
	if (fingerprintNativeMediaPlan(planned.subject).canonical
		!== fingerprintNativeMediaPlan(final.subject).canonical) {
		throw new Error('The final native delivery report changed its planned subject.');
	}
	const remaining = new Map<string, number>();
	for (const item of final.items) {
		const canonical = fingerprintNativeMediaPlan(item).canonical;
		remaining.set(canonical, (remaining.get(canonical) ?? 0) + 1);
	}
	for (const item of planned.items) {
		const canonical = fingerprintNativeMediaPlan(item).canonical;
		const count = remaining.get(canonical) ?? 0;
		if (count === 0) {
			throw new Error('The final native delivery report dropped or changed a planned report item.');
		}
		remaining.set(canonical, count - 1);
	}
}

function attempts(
	value: unknown,
	hardwarePolicy: PlatformNativeMediaV15Execution['hardwarePolicy'],
): readonly FramescaperNativeDeliveryBackendAttemptV1[] {
	const rows = denseArray(value, 1, 2, 'native delivery backend attempts').map((entry, index) => {
		const row = exactRecord(entry, ['attempt', 'backend', 'outcome', 'failureCode'], 'native delivery backend attempt');
		const attempt = integer(row.attempt, 1, 2, 'native delivery attempt');
		if (attempt !== index + 1) throw new RangeError('Native delivery attempts must be dense from attempt one.');
		const outcome = member(
			row.outcome, ['succeeded', 'failed', 'web-core-required'] as const, 'native delivery attempt outcome',
		);
		const failureCode = row.failureCode === null
			? null : text(row.failureCode, FAILURE, 'native delivery failure code');
		if ((outcome === 'succeeded') !== (failureCode === null)) {
			throw new Error('Native delivery attempt outcome and failure code disagree.');
		}
		if (outcome === 'web-core-required' && failureCode !== 'web-core-required') {
			throw new Error('A web-core-required outcome must report that exact failure code.');
		}
		return Object.freeze({
			attempt, backend: text(row.backend, ID, 'native delivery backend'), outcome, failureCode,
		});
	});
	if (rows.length === 2 && (rows[0]!.outcome !== 'failed'
		|| rows[1]!.backend !== 'native-cpu')) {
		throw new Error('The only native delivery retry is one CPU attempt after hardware failure.');
	}
	if (hardwarePolicy === 'native-cpu') {
		if (rows.length !== 1 || rows[0]!.backend !== 'native-cpu') {
			throw new Error('The native delivery target hardware policy permits exactly one native-cpu attempt.');
		}
	} else if (rows[0]!.backend === 'native-cpu' || rows[0]!.backend === 'web-core') {
		throw new Error('The native delivery target hardware policy requires a hardware-first attempt.');
	}
	return Object.freeze(rows);
}

function artifactManifest(
	value: unknown,
): readonly FramescaperNativeDeliveryArtifactManifestEntryV1[] {
	const ids = new Set<string>();
	const paths = new Set<string>();
	const order = ['picture-master', 'picture-sequence', 'caption-sidecar', 'companion-audio'];
	const rows = denseArray(value, 1, 3, 'native delivery required artifact manifest').map((entry) => {
		const row = exactRecord(entry, [
			'artifactId', 'kind', 'relativePath', 'expectedByteLength', 'expectedSha256',
		], 'native delivery required artifact');
		const artifactId = member(row.artifactId, order, 'native delivery artifact manifest ID');
		const kind = member(row.kind, ['file', 'directory'] as const, 'native delivery artifact kind');
		assertNativeMediaRelativeDestination(row.relativePath);
		const relativePath = row.relativePath as string;
		if (ids.has(artifactId) || paths.has(relativePath)) {
			throw new RangeError('Native delivery required artifacts must have unique IDs and paths.');
		}
		ids.add(artifactId);
		paths.add(relativePath);
		const expectedByteLength = row.expectedByteLength === null ? null
			: integer(row.expectedByteLength, 1, Number.MAX_SAFE_INTEGER, 'expected artifact byte length');
		const expectedSha256 = row.expectedSha256 === null ? null
			: text(row.expectedSha256, SHA256, 'expected artifact SHA-256');
		if ((expectedByteLength === null) !== (expectedSha256 === null)) {
			throw new Error('A known required artifact must bind both byte length and SHA-256.');
		}
		return Object.freeze({
			artifactId, kind, relativePath, expectedByteLength, expectedSha256,
		});
	});
	if (!rows[0]?.artifactId.startsWith('picture-')
		|| rows.some((row, index) => index > 0
			&& order.indexOf(row.artifactId) <= order.indexOf(rows[index - 1]!.artifactId))) {
		throw new Error('Native delivery required artifacts are not in canonical manifest order.');
	}
	return Object.freeze(rows);
}

function conformanceCheckIds(value: unknown): readonly string[] {
	const ids = denseArray(value, 1, 64, 'native delivery required conformance checks')
		.map((entry) => text(entry, ID, 'native delivery required conformance check ID'));
	if (new Set(ids).size !== ids.length
		|| ids.some((id, index) => index > 0 && ids[index - 1]!.localeCompare(id) >= 0)) {
		throw new Error('Native delivery required conformance check IDs must be unique and sorted.');
	}
	return Object.freeze(ids);
}

function assertSuccessfulClosure(
	seed: FramescaperNativeDeliveryReportSeedV1,
	artifacts: readonly FramescaperNativeDeliveryArtifactV1[],
	conformance: readonly FramescaperNativeDeliveryConformanceV1[],
): void {
	if (artifacts.length !== seed.requiredArtifactManifest.length) {
		throw new Error('Native delivery artifacts do not exactly close the required manifest.');
	}
	for (const [index, requirement] of seed.requiredArtifactManifest.entries()) {
		const artifact = artifacts[index]!;
		if (artifact.artifactId !== requirement.artifactId
			|| artifact.kind !== requirement.kind
			|| artifact.relativePath !== requirement.relativePath
			|| (requirement.expectedByteLength !== null
				&& artifact.byteLength !== requirement.expectedByteLength)
			|| (requirement.expectedSha256 !== null
				&& artifact.sha256 !== requirement.expectedSha256)) {
			throw new Error(`Native delivery artifact ${requirement.artifactId} does not close its manifest entry.`);
		}
	}
	if (conformance.length !== seed.requiredConformanceCheckIds.length
		|| conformance.some(({ checkId }, index) => checkId !== seed.requiredConformanceCheckIds[index])) {
		throw new Error('Native delivery conformance does not exactly close the required check inventory.');
	}
}

function conformanceRows(value: unknown): readonly FramescaperNativeDeliveryConformanceV1[] {
	const seen = new Set<string>();
	return Object.freeze(denseArray(value, 0, 1_024, 'native delivery conformance').map((entry) => {
		const row = exactRecord(entry, ['checkId', 'passed', 'detail'], 'native delivery conformance row');
		const checkId = text(row.checkId, ID, 'native delivery conformance check ID');
		if (seen.has(checkId)) throw new RangeError('Native delivery conformance check IDs must be unique.');
		seen.add(checkId);
		if (typeof row.passed !== 'boolean') throw new TypeError('Native delivery conformance result must be boolean.');
		if (row.detail !== null && (typeof row.detail !== 'string' || row.detail.length > 4_096)) {
			throw new TypeError('Native delivery conformance detail is invalid.');
		}
		return Object.freeze({ checkId, passed: row.passed, detail: row.detail as string | null });
	}));
}

function artifactRows(value: unknown): readonly FramescaperNativeDeliveryArtifactV1[] {
	const ids = new Set<string>();
	const paths = new Set<string>();
	return Object.freeze(denseArray(value, 0, 100_000, 'native delivery artifacts').map((entry) => {
		const row = exactRecord(entry, [
			'artifactId', 'kind', 'relativePath', 'byteLength', 'sha256',
		], 'native delivery artifact');
		const artifactId = text(row.artifactId, ID, 'native delivery artifact ID');
		if (ids.has(artifactId)) throw new RangeError('Native delivery artifact IDs must be unique.');
		ids.add(artifactId);
		const kind = member(row.kind, ['file', 'directory'] as const, 'native delivery artifact kind');
		assertNativeMediaRelativeDestination(row.relativePath);
		const relativePath = row.relativePath as string;
		if (paths.has(relativePath)) throw new RangeError('Native delivery artifact paths must be unique.');
		paths.add(relativePath);
		return Object.freeze({
			artifactId,
			kind,
			relativePath,
			byteLength: integer(row.byteLength, 1, Number.MAX_SAFE_INTEGER, 'native delivery artifact byte length'),
			sha256: text(row.sha256, SHA256, 'native delivery artifact SHA-256'),
		});
	}));
}

function snapshotDeliveryReport(value: unknown): DeliveryReport {
	const row = exactRecord(value, [
		'schemaVersion', 'format', 'direction', 'subject', 'items', 'counts',
	], 'sealed delivery report');
	if (row.schemaVersion !== 1 || row.format !== 'delivery' || row.direction !== 'export') {
		throw new TypeError('A native delivery job requires a sealed delivery report.');
	}
	const subject = reportSubject(row.subject);
	const items = denseArray(row.items, 0, 100_000, 'delivery report items').map(reportItem);
	const counts = exactRecord(row.counts, DISPOSITIONS, 'delivery report counts');
	const normalizedCounts = Object.fromEntries(DISPOSITIONS.map((disposition) => {
		const count = integer(counts[disposition], 0, 100_000, `delivery report ${disposition} count`);
		if (count !== items.filter((item) => item.disposition === disposition).length) {
			throw new Error('Delivery report counts do not describe its items.');
		}
		return [disposition, count];
	})) as Record<DeliveryDisposition, number>;
	return deepFreeze({
		schemaVersion: 1 as const, format: 'delivery' as const, direction: 'export' as const,
		subject, items: Object.freeze(items), counts: Object.freeze(normalizedCounts),
	});
}

function reportSubject(value: unknown): DeliveryReportSubject {
	const row = exactRecord(value, [
		'format', 'container', 'codec', 'sampleRate', 'channelCount', 'lossless',
	], 'delivery report subject');
	return Object.freeze({
		format: boundedText(row.format, 1, 512, 'delivery report format'),
		container: nullableBoundedText(row.container, 'delivery report container'),
		codec: nullableBoundedText(row.codec, 'delivery report codec'),
		sampleRate: nullableNumber(row.sampleRate, 'delivery report sample rate'),
		channelCount: nullableNumber(row.channelCount, 'delivery report channel count'),
		lossless: row.lossless === null || typeof row.lossless === 'boolean'
			? row.lossless : invalid('Delivery report lossless flag is invalid.'),
	});
}

function reportItem(value: unknown): DeliveryReportItem {
	const row = exactRecord(value, [
		'code', 'severity', 'disposition', 'scope', 'data', 'message',
	], 'delivery report item', ['message']);
	const severity = member(row.severity, ['info', 'warning', 'error'] as const, 'delivery report severity');
	const disposition = member(row.disposition, DISPOSITIONS, 'delivery report disposition');
	return Object.freeze({
		code: boundedText(row.code, 1, 512, 'delivery report item code'), severity, disposition,
		scope: snapshotPlainRecord(row.scope, 'delivery report item scope'),
		data: snapshotPlainRecord(row.data, 'delivery report item data'),
		...(row.message === undefined ? {} : {
			message: boundedText(row.message, 1, 4_096, 'delivery report item message'),
		}),
	});
}

function snapshotPlainRecord(value: unknown, name: string): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`${name} must be a plain record.`);
	}
	const cloned = structuredClone(value) as Record<string, unknown>;
	fingerprintNativeMediaPlan(cloned);
	return deepFreeze(cloned);
}

function exactRecord(
	value: unknown,
	fields: readonly string[],
	name: string,
	optional: readonly string[] = [],
): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`${name} must be a closed plain record.`);
	}
	const keys = Reflect.ownKeys(value);
	if (keys.some((key) => typeof key !== 'string' || !fields.includes(key))
		|| fields.some((field) => !optional.includes(field) && !Object.hasOwn(value, field))) {
		throw new TypeError(`${name} has missing or unsupported fields.`);
	}
	return value as Record<string, unknown>;
}

function denseArray(value: unknown, minimum: number, maximum: number, name: string): unknown[] {
	if (!Array.isArray(value) || value.length < minimum || value.length > maximum
		|| Reflect.ownKeys(value).length !== value.length + 1) {
		throw new TypeError(`${name} must be a bounded dense array.`);
	}
	return [...value];
}

function member<const Value extends string>(value: unknown, values: readonly Value[], name: string): Value {
	if (typeof value !== 'string' || !(values as readonly string[]).includes(value)) {
		throw new RangeError(`${name} is unsupported.`);
	}
	return value as Value;
}

function text(value: unknown, pattern: RegExp, name: string): string {
	if (typeof value !== 'string' || !pattern.test(value)) throw new TypeError(`${name} is invalid.`);
	return value;
}

function boundedText(value: unknown, minimum: number, maximum: number, name: string): string {
	if (typeof value !== 'string' || value.length < minimum || value.length > maximum || value.includes('\0')) {
		throw new TypeError(`${name} is invalid.`);
	}
	return value;
}

function nullableBoundedText(value: unknown, name: string): string | null {
	return value === null ? null : boundedText(value, 1, 512, name);
}

function nullableNumber(value: unknown, name: string): number | null {
	if (value === null) return null;
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new TypeError(`${name} is invalid.`);
	return value;
}

function integer(value: unknown, minimum: number, maximum: number, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
		throw new RangeError(`${name} is invalid.`);
	}
	return Number(value);
}

function invalid(message: string): never { throw new TypeError(message); }

function deepFreeze<Value>(value: Value): Value {
	if (value && typeof value === 'object' && !Object.isFrozen(value)) {
		for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
		Object.freeze(value);
	}
	return value;
}
