/* SPDX-License-Identifier: AGPL-3.0-only */

/** Strict renderer-side adapters for optional main-owned lifecycle ports. */

import {
	assertNativeMediaRelativeDestination,
} from '../native-media-atomic-publication.ts';
import {
	NATIVE_MEDIA_PLAN_CANONICAL_MAXIMUM_BYTES,
	createNativeMediaPlanEnvelopeV1,
} from '../native-media-plan-envelope.ts';
import {
	canonicalizeNativeMediaPlan,
	fingerprintNativeMediaPlan,
} from '../native-media-plan-canonical-form.ts';
import {
	NATIVE_QUEUE_RECOVERY_CLASSES,
	NATIVE_QUEUE_TASK_KINDS,
	type NativeQueueInputFingerprintV1,
	type NativeQueueRecoveryClass,
	type NativeQueueReservationsV1,
	type NativeQueueTaskKind,
} from '../native-queue-record.ts';

const OPAQUE_ID = /^[a-f0-9]{16,64}$/u;
const JOB_ID = /^[a-f0-9]{40}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const PROJECT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const EXTENSION = /^[a-z0-9][a-z0-9]{0,15}$/u;

export interface FramescaperNativeRootProjection {
	readonly grantId: string;
	readonly displayName: string;
	readonly revoked: boolean;
}

export interface FramescaperNativeWatchProjection {
	readonly ruleId: string;
	readonly grantId: string;
	readonly projectId: string;
	readonly extensions: readonly string[];
	readonly importMode: 'link' | 'copy';
	readonly generateProxies: boolean;
	readonly enabled: boolean;
}

export interface FramescaperNativeWatchCreateRendererRequest {
	readonly grantId: string;
	readonly projectId: string;
	readonly binId: string | null;
	readonly extensions: readonly string[];
	readonly importMode: 'link' | 'copy';
	readonly generateProxies: boolean;
}

export interface FramescaperNativeQueueEnqueueRendererRequest {
	readonly taskKind: NativeQueueTaskKind;
	readonly planVersion: 7 | 8 | 9 | 10 | 11 | 12;
	readonly derivedInputStageId: string | null;
	readonly planFingerprint: string;
	readonly planPayload: string;
	readonly projectId: string;
	readonly projectRevision: number;
	readonly inputFingerprints: readonly NativeQueueInputFingerprintV1[];
	readonly rootGrantId: string;
	readonly relativeDestination: string;
	readonly reservations: NativeQueueReservationsV1;
	readonly recoveryClass: NativeQueueRecoveryClass;
}

export interface FramescaperNativeRenderInputV1 {
	readonly role: 'evaluated-rgba-frame-pack' | 'staged-audio-mix';
	readonly byteLength: number;
	readonly sha256: string;
	readonly bytes: Blob;
}

export interface FramescaperNativeRenderInputStageRendererRequestV1 {
	readonly stageVersion: 1;
	readonly planVersion: 7;
	readonly planFingerprint: string;
	readonly planPayload: string;
	readonly projectId: string;
	readonly projectRevision: number;
	readonly inputFingerprints: readonly NativeQueueInputFingerprintV1[];
	readonly derivedInputs: readonly FramescaperNativeRenderInputV1[];
}

export interface FramescaperNativeServicesLifecycleBridge {
	enqueue?(request: FramescaperNativeQueueEnqueueRendererRequest): Promise<unknown>;
	stageRenderInputs?(request: FramescaperNativeRenderInputStageRendererRequestV1):
		Promise<Readonly<{ readonly stageId: string }>>;
	abandonRenderInputs?(request: Readonly<{ readonly stageId: string }>): Promise<boolean>;
	selectRoot?(): Promise<FramescaperNativeRootProjection | null>;
	revalidateRoot?(request: Readonly<{ readonly grantId: string }>): Promise<boolean>;
	revokeRoot?(request: Readonly<{ readonly grantId: string }>): Promise<boolean>;
	createWatch?(request: FramescaperNativeWatchCreateRendererRequest):
		Promise<FramescaperNativeWatchProjection>;
	setWatchEnabled?(request: Readonly<{ readonly ruleId: string; readonly enabled: boolean }>):
		Promise<FramescaperNativeWatchProjection>;
	removeWatch?(request: Readonly<{ readonly ruleId: string }>): Promise<boolean>;
	reconcileWatch?(): Promise<unknown>;
	cleanupScratch?(): Promise<readonly string[]>;
	settleScratch?(request: Readonly<{ readonly jobId: string }>):
		Promise<'released' | 'retained'>;
}

export interface FramescaperNativeServicesLifecycleStore<Snapshot> {
	enqueue(request: FramescaperNativeQueueEnqueueRendererRequest): Promise<Snapshot>;
	selectRoot(): Promise<Snapshot>;
	revalidateRoot(request: Readonly<{ readonly grantId: string }>): Promise<Snapshot>;
	revokeRoot(request: Readonly<{ readonly grantId: string }>): Promise<Snapshot>;
	createWatch(request: FramescaperNativeWatchCreateRendererRequest): Promise<Snapshot>;
	setWatchEnabled(request: Readonly<{
		readonly ruleId: string; readonly enabled: boolean;
	}>): Promise<Snapshot>;
	removeWatch(request: Readonly<{ readonly ruleId: string }>): Promise<Snapshot>;
	reconcileWatch(): Promise<Snapshot>;
	cleanupScratch(): Promise<Snapshot>;
	settleScratch(request: Readonly<{ readonly jobId: string }>): Promise<Snapshot>;
}

export const FRAMESCAPER_NATIVE_SERVICES_LIFECYCLE_METHODS = Object.freeze([
	'enqueue', 'selectRoot', 'revalidateRoot', 'revokeRoot', 'createWatch',
	'setWatchEnabled', 'removeWatch', 'reconcileWatch', 'cleanupScratch', 'settleScratch',
] as const);

export type FramescaperNativeServicesLifecycleMethod =
	(typeof FRAMESCAPER_NATIVE_SERVICES_LIFECYCLE_METHODS)[number];

export function availableFramescaperNativeServicesLifecycleMethods(
	bridge: FramescaperNativeServicesLifecycleBridge,
): readonly FramescaperNativeServicesLifecycleMethod[] {
	return Object.freeze(FRAMESCAPER_NATIVE_SERVICES_LIFECYCLE_METHODS.filter(
		(method) => typeof bridge[method] === 'function',
	));
}

export function createFramescaperNativeServicesLifecycleStore<Snapshot>(
	bridge: FramescaperNativeServicesLifecycleBridge,
	refreshAfter: (operation: () => Promise<unknown>) => Promise<Snapshot>,
): FramescaperNativeServicesLifecycleStore<Snapshot> {
	const run = async <Result>(
		method: FramescaperNativeServicesLifecycleMethod,
		request: unknown,
		admit: (result: unknown) => Result,
	): Promise<Snapshot> => {
		const operation = bridge[method];
		if (typeof operation !== 'function') {
			throw new Error(`This desktop build cannot perform Framescaper ${method}.`);
		}
		return refreshAfter(async () => {
			const result = request === undefined
				? await (operation as () => Promise<unknown>).call(bridge)
				: await (operation as (value: unknown) => Promise<unknown>).call(bridge, request);
			admit(result);
		});
	};
	const operations: FramescaperNativeServicesLifecycleStore<Snapshot> = {
		enqueue: async (value: FramescaperNativeQueueEnqueueRendererRequest) => (
			run('enqueue', queueEnqueueRequest(value), recordResult)
		),
		selectRoot: async () => run('selectRoot', undefined, optionalRootResult),
		revalidateRoot: async (value: Readonly<{ grantId: string }>) => run(
			'revalidateRoot', idRequest(value, 'grantId', OPAQUE_ID), trueResult,
		),
		revokeRoot: async (value: Readonly<{ grantId: string }>) => run(
			'revokeRoot', idRequest(value, 'grantId', OPAQUE_ID), trueResult,
		),
		createWatch: async (value: FramescaperNativeWatchCreateRendererRequest) => (
			run('createWatch', watchCreateRequest(value), watchResult)
		),
		setWatchEnabled: async (value: Readonly<{ ruleId: string; enabled: boolean }>) => run(
			'setWatchEnabled', watchEnabledRequest(value), watchResult,
		),
		removeWatch: async (value: Readonly<{ ruleId: string }>) => run(
			'removeWatch', idRequest(value, 'ruleId', OPAQUE_ID), trueResult,
		),
		reconcileWatch: async () => run('reconcileWatch', undefined, recordResult),
		cleanupScratch: async () => run('cleanupScratch', undefined, jobIdsResult),
		settleScratch: async (value: Readonly<{ jobId: string }>) => run(
			'settleScratch', idRequest(value, 'jobId', JOB_ID), settlementResult,
		),
	};
	return Object.freeze(operations);
}

function queueEnqueueRequest(value: unknown): FramescaperNativeQueueEnqueueRendererRequest {
	const row = closedRecord(value, [
		'taskKind', 'planVersion', 'derivedInputStageId', 'planFingerprint', 'planPayload', 'projectId',
		'projectRevision', 'inputFingerprints', 'rootGrantId', 'relativeDestination',
		'recoveryClass', 'reservations',
	], 'queue enqueue request');
	const planPayload = text(row.planPayload, 'plan payload', NATIVE_MEDIA_PLAN_CANONICAL_MAXIMUM_BYTES);
	let plan: unknown;
	try { plan = JSON.parse(planPayload) as unknown; } catch {
		throw new TypeError('A Framescaper queue plan payload must be canonical JSON.');
	}
	const envelope = createNativeMediaPlanEnvelopeV1(plan);
	const fingerprint = fingerprintNativeMediaPlan(plan);
	if (canonicalizeNativeMediaPlan(plan) !== planPayload
		|| fingerprint.sha256 !== row.planFingerprint
		|| envelope.planVersion !== row.planVersion) {
		throw new TypeError('A Framescaper queue request must preserve its exact plan identity.');
	}
	const taskKind = member(row.taskKind, NATIVE_QUEUE_TASK_KINDS, 'task kind');
	const derivedInputStageId = row.derivedInputStageId === null
		? null : pattern(row.derivedInputStageId, JOB_ID, 'derived input stage id');
	if ((envelope.planVersion === 7) !== (derivedInputStageId !== null)) {
		throw new TypeError('Only V7 queue requests require one durable derived-input stage.');
	}
	const recoveryClass = member(row.recoveryClass, NATIVE_QUEUE_RECOVERY_CLASSES, 'recovery class');
	if (recoveryClass === 'verified-frame-checkpoint' && taskKind !== 'image-sequence-export') {
		throw new TypeError('Only image-sequence exports may use verified frame checkpoints.');
	}
	assertNativeMediaRelativeDestination(row.relativeDestination);
	return Object.freeze({
		taskKind,
		planVersion: envelope.planVersion,
		derivedInputStageId,
		planFingerprint: digest(row.planFingerprint, 'plan fingerprint'),
		planPayload,
		projectId: identifier(row.projectId, 'project id'),
		projectRevision: nonNegative(row.projectRevision, 'project revision'),
		inputFingerprints: inputFingerprints(row.inputFingerprints),
		rootGrantId: pattern(row.rootGrantId, OPAQUE_ID, 'root grant id'),
		relativeDestination: row.relativeDestination as string,
		reservations: reservations(row.reservations),
		recoveryClass,
	});
}

function watchCreateRequest(value: unknown): FramescaperNativeWatchCreateRendererRequest {
	const row = closedRecord(value, [
		'grantId', 'projectId', 'binId', 'extensions', 'importMode', 'generateProxies',
	], 'watch create request');
	const extensions = denseArray(row.extensions, 32, 'watch extensions').map((entry) => {
		const normalized = typeof entry === 'string' ? entry.replace(/^\./u, '').toLowerCase() : '';
		return pattern(normalized, EXTENSION, 'watch extension');
	});
	if (extensions.length === 0) throw new TypeError('A Framescaper watch rule requires extensions.');
	if (new Set(extensions).size !== extensions.length) {
		throw new TypeError('A Framescaper watch rule has a duplicate extension.');
	}
	if (typeof row.generateProxies !== 'boolean') {
		throw new TypeError('A Framescaper watch rule must state proxy generation.');
	}
	return Object.freeze({
		grantId: pattern(row.grantId, OPAQUE_ID, 'watch grant id'),
		projectId: identifier(row.projectId, 'watch project id'),
		binId: row.binId === null ? null : identifier(row.binId, 'watch bin id'),
		extensions: Object.freeze(extensions),
		importMode: member(row.importMode, ['link', 'copy'] as const, 'watch import mode'),
		generateProxies: row.generateProxies,
	});
}

function watchEnabledRequest(value: unknown): Readonly<{ ruleId: string; enabled: boolean }> {
	const row = closedRecord(value, ['ruleId', 'enabled'], 'watch enabled request');
	if (typeof row.enabled !== 'boolean') throw new TypeError('A watch enabled request must be boolean.');
	return Object.freeze({ ruleId: pattern(row.ruleId, OPAQUE_ID, 'watch rule id'), enabled: row.enabled });
}

function idRequest<Field extends 'grantId' | 'ruleId' | 'jobId'>(
	value: unknown,
	field: Field,
	matcher: RegExp,
): Readonly<Record<Field, string>> {
	const row = closedRecord(value, [field], `${field} request`);
	const label = field === 'grantId' ? 'grant id' : field === 'ruleId' ? 'rule id' : 'job id';
	return Object.freeze({ [field]: pattern(row[field], matcher, label) }) as Readonly<Record<Field, string>>;
}

export function framescaperNativeRenderInputAbandonRequest(
	value: unknown,
): Readonly<{ readonly stageId: string }> {
	const row = closedRecord(value, ['stageId'], 'render-input abandonment request');
	return Object.freeze({ stageId: pattern(row.stageId, JOB_ID, 'render-input stage id') });
}

function optionalRootResult(value: unknown): FramescaperNativeRootProjection | null {
	if (value === null) return null;
	const row = closedRecord(value, ['grantId', 'displayName', 'revoked'], 'root result');
	if (typeof row.revoked !== 'boolean') throw new TypeError('A Framescaper root result is invalid.');
	return Object.freeze({
		grantId: pattern(row.grantId, OPAQUE_ID, 'root grant id'),
		displayName: text(row.displayName, 'root display name', 4_096),
		revoked: row.revoked,
	});
}

function watchResult(value: unknown): FramescaperNativeWatchProjection {
	const row = closedRecord(value, [
		'ruleId', 'grantId', 'projectId', 'extensions', 'importMode', 'generateProxies', 'enabled',
	], 'watch result');
	if (typeof row.generateProxies !== 'boolean' || typeof row.enabled !== 'boolean') {
		throw new TypeError('A Framescaper watch result has invalid state.');
	}
	return Object.freeze({
		ruleId: pattern(row.ruleId, OPAQUE_ID, 'watch rule id'),
		grantId: pattern(row.grantId, OPAQUE_ID, 'watch grant id'),
		projectId: identifier(row.projectId, 'watch project id'),
		extensions: Object.freeze(denseArray(row.extensions, 32, 'watch extensions')
			.map((entry) => pattern(entry, EXTENSION, 'watch extension'))),
		importMode: member(row.importMode, ['link', 'copy'] as const, 'watch import mode'),
		generateProxies: row.generateProxies,
		enabled: row.enabled,
	});
}

function trueResult(value: unknown): true {
	if (value !== true) throw new Error('The Framescaper native lifecycle mutation was not acknowledged.');
	return true;
}

function settlementResult(value: unknown): 'released' | 'retained' {
	return member(value, ['released', 'retained'] as const, 'scratch settlement');
}

function jobIdsResult(value: unknown): readonly string[] {
	return Object.freeze(denseArray(value, 100_000, 'scratch cleanup jobs')
		.map((entry) => pattern(entry, JOB_ID, 'scratch job id')));
}

function recordResult(value: unknown): Readonly<Record<string, unknown>> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('A Framescaper native lifecycle result must be a record.');
	}
	return value as Readonly<Record<string, unknown>>;
}

function inputFingerprints(value: unknown): readonly NativeQueueInputFingerprintV1[] {
	return Object.freeze(denseArray(value, 4_096, 'input fingerprints').map((entry) => {
		const row = closedRecord(entry, ['sourceId', 'sha256'], 'input fingerprint');
		return Object.freeze({
			sourceId: identifier(row.sourceId, 'source id'),
			sha256: digest(row.sha256, 'input fingerprint'),
		});
	}));
}

function reservations(value: unknown): NativeQueueReservationsV1 {
	const row = closedRecord(value, [
		'cpuCores', 'processTreeRssBytes', 'scratchBytes', 'minimumFreeBytes', 'hardwareBackend',
	], 'queue reservations');
	return Object.freeze({
		cpuCores: nonNegative(row.cpuCores, 'CPU cores'),
		processTreeRssBytes: nonNegative(row.processTreeRssBytes, 'RSS bytes'),
		scratchBytes: nonNegative(row.scratchBytes, 'scratch bytes'),
		minimumFreeBytes: nonNegative(row.minimumFreeBytes, 'minimum free bytes'),
		hardwareBackend: row.hardwareBackend === null
			? null : identifier(row.hardwareBackend, 'hardware backend'),
	});
}

function closedRecord<const Field extends string>(
	value: unknown,
	fields: readonly Field[],
	label: string,
): Readonly<Record<Field, unknown>> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`A Framescaper ${label} must be a plain record.`);
	}
	const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.length
		|| keys.some((key) => typeof key !== 'string' || !fields.includes(key as Field))) {
		throw new TypeError(`A Framescaper ${label} has missing or unsupported fields.`);
	}
	return value as Readonly<Record<Field, unknown>>;
}

function denseArray(value: unknown, maximum: number, label: string): readonly unknown[] {
	if (!Array.isArray(value) || value.length > maximum
		|| Reflect.ownKeys(value).length !== value.length + 1) {
		throw new TypeError(`A Framescaper ${label} must be a bounded dense array.`);
	}
	return value;
}

function member<const Value extends string>(
	value: unknown,
	values: readonly Value[],
	label: string,
): Value {
	if (typeof value !== 'string' || !(values as readonly string[]).includes(value)) {
		throw new TypeError(`A Framescaper ${label} is invalid.`);
	}
	return value as Value;
}

function pattern(value: unknown, matcher: RegExp, label: string): string {
	if (typeof value !== 'string' || !matcher.test(value)) {
		throw new TypeError(`A Framescaper ${label} is invalid.`);
	}
	return value;
}

function digest(value: unknown, label: string): string {
	return pattern(value, SHA256, label);
}

function identifier(value: unknown, label: string): string {
	return pattern(value, PROJECT_ID, label);
}

function text(value: unknown, label: string, maximum: number): string {
	if (typeof value !== 'string' || value.length === 0
		|| new TextEncoder().encode(value).byteLength > maximum || value.includes('\0')) {
		throw new TypeError(`A Framescaper ${label} is invalid.`);
	}
	return value;
}

function nonNegative(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || (value as number) < 0) {
		throw new RangeError(`A Framescaper ${label} must be a non-negative safe integer.`);
	}
	return value as number;
}
