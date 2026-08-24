/* SPDX-License-Identifier: AGPL-3.0-only */

/** Pathless selected-V14 executor: OS hardware, native CPU, then Web Core. */

import { assertNativeMediaRelativeDestination } from '../src/common/editor/native-media-atomic-publication.ts';
import {
	NATIVE_MEDIA_CPU_BACKEND,
	NATIVE_MEDIA_WEB_BACKEND,
	type NativeMediaBackendPlanV1,
} from '../src/common/editor/native-media-backend-policy.ts';
import {
	assertNativeMediaPlanEnvelopeV2,
	type NativeMediaPlanEnvelopeV2,
} from '../src/common/editor/native-media-plan-envelope-v2.ts';
import {
	createNativeMediaV14SupportInventory,
} from '../src/common/editor/native-media-v14-support.ts';
import {
	nativeMediaV14EncodeDispatch,
	type NativeMediaV14EncodeProfileId,
} from '../src/common/editor/native-media-v14-native-dispatch.ts';
import {
	admitNativeMediaOutputTreeSummary,
	createNativeMediaOutputTreeIdentity,
	type NativeMediaOutputTreeSummaryV1,
} from './native-media-output-tree.ts';

export const NATIVE_MEDIA_V14_EXECUTION_STAGE_KINDS = Object.freeze([
	'decode-source', 'clip', 'transition', 'visual', 'professional-media',
	'openfx', 'finishing', 'audio-mix', 'encode', 'atomic-publication',
] as const);
export type NativeMediaV14ExecutionStageKind =
	(typeof NATIVE_MEDIA_V14_EXECUTION_STAGE_KINDS)[number];

export interface NativeMediaV14SourceGrant {
	readonly sourceId: string;
	readonly grantId: string;
	readonly contentSha256: string;
}

export interface NativeMediaV14ExecutionStage {
	readonly index: number;
	readonly kind: NativeMediaV14ExecutionStageKind;
	readonly authorityId: string;
}

export interface NativeMediaV14ExecutionAttempt {
	readonly jobId: string;
	readonly backend: string;
	readonly envelope: NativeMediaPlanEnvelopeV2;
	readonly sources: readonly NativeMediaV14SourceGrant[];
	readonly rootGrantId: string;
	readonly relativeDestination: string;
	readonly stages: readonly NativeMediaV14ExecutionStage[];
	readonly signal?: AbortSignal;
}

export interface NativeMediaV14FileExecutionReceipt {
	readonly planFingerprint: string;
	readonly byteLength: number;
	readonly sha256: string;
	/** The helper output is authenticated at the exact temporary sibling only. */
	readonly publication: 'verified-temporary';
}

export interface NativeMediaV14TreeExecutionReceipt extends NativeMediaV14FileExecutionReceipt {
	readonly tree: NativeMediaOutputTreeSummaryV1;
}

export type NativeMediaV14ExecutionReceipt =
	| NativeMediaV14FileExecutionReceipt | NativeMediaV14TreeExecutionReceipt;

export interface NativeMediaV14ExecutionPort {
	execute(attempt: NativeMediaV14ExecutionAttempt): Promise<unknown>;
}

export interface NativeMediaV14WebFallbackPort {
	execute(attempt: Omit<NativeMediaV14ExecutionAttempt, 'backend'> & Readonly<{
		readonly backend: typeof NATIVE_MEDIA_WEB_BACKEND;
	}>): Promise<unknown>;
}

export type NativeMediaV14ExecutionResult = Readonly<{
	readonly outcome: 'native' | 'web-core';
	readonly backend: string;
	readonly receipt: NativeMediaV14ExecutionReceipt;
	readonly failedBackends: readonly string[];
}>;

export const NATIVE_MEDIA_V14_RETRYABLE_HOST_ERROR_CODES = Object.freeze([
	'unsupported-render-subset', 'unsupported-audio-subset',
	'unsupported-geometry-subset', 'unsupported-rate-conversion',
	'unsupported-output-format', 'unsupported-codec-combination',
	'codec-policy-unavailable', 'video-stream-missing',
	'hardware-backend-unavailable', 'hardware-backend-failed',
	'hardware-encoder-unavailable', 'hardware-encoder-failed',
] as const);

export async function executeNativeMediaPlanV14(input: Readonly<{
	readonly envelope: NativeMediaPlanEnvelopeV2;
	readonly jobId: string;
	readonly backendPlan: NativeMediaBackendPlanV1;
	readonly sources: readonly NativeMediaV14SourceGrant[];
	readonly rootGrantId: string;
	readonly relativeDestination: string;
	readonly native: NativeMediaV14ExecutionPort;
	readonly web: NativeMediaV14WebFallbackPort;
	readonly signal?: AbortSignal;
	readonly onBackendFailure?: (backend: string, error: Error) => void;
}>): Promise<NativeMediaV14ExecutionResult> {
	assertNativeMediaPlanEnvelopeV2(input.envelope);
	if (input.envelope.planVersion !== 14) throw new RangeError('Selected native execution requires exact plan V14.');
	assertSelectedBackendPlan(input.backendPlan);
	const sources = snapshotSources(input.envelope, input.sources);
	const jobId = fixedJobId(input.jobId);
	const rootGrantId = opaqueId(input.rootGrantId, 'root grant');
	assertNativeMediaRelativeDestination(input.relativeDestination);
	const stages = createNativeMediaV14ExecutionStages(input.envelope);
	const common = {
		jobId, envelope: input.envelope, sources, rootGrantId,
		relativeDestination: input.relativeDestination, stages,
		...(input.signal ? { signal: input.signal } : {}),
	};
	const failedBackends: string[] = [];
	for (const backend of input.backendPlan.attempts) {
		throwIfAborted(input.signal);
		try {
			const receipt = receiptValue(await input.native.execute({ ...common, backend }), common);
			return Object.freeze({
				outcome: 'native', backend, receipt,
				failedBackends: Object.freeze([...failedBackends]),
			});
		} catch (error) {
			throwIfAborted(input.signal);
			const admitted = error instanceof Error ? error : new Error(String(error));
			if (!retryableBackendFailure(admitted)) throw admitted;
			failedBackends.push(backend);
			input.onBackendFailure?.(backend, admitted);
		}
	}
	throwIfAborted(input.signal);
	const receipt = receiptValue(await input.web.execute({
		...common, backend: NATIVE_MEDIA_WEB_BACKEND,
	}), common);
	return Object.freeze({
		outcome: 'web-core', backend: NATIVE_MEDIA_WEB_BACKEND, receipt,
		failedBackends: Object.freeze(failedBackends),
	});
}

function retryableBackendFailure(error: Error): boolean {
	const code = (error as Error & Readonly<{ readonly code?: unknown }>).code;
	return typeof code === 'string'
		&& (NATIVE_MEDIA_V14_RETRYABLE_HOST_ERROR_CODES as readonly string[]).includes(code);
}

export function createNativeMediaV14ExecutionStages(
	envelope: NativeMediaPlanEnvelopeV2,
): readonly NativeMediaV14ExecutionStage[] {
	assertNativeMediaPlanEnvelopeV2(envelope);
	if (envelope.planVersion !== 14) throw new RangeError('Execution stages require exact plan V14.');
	assertEncoderSupported(envelope);
	const stages: Array<Readonly<{ kind: NativeMediaV14ExecutionStageKind; authorityId: string }>> = [];
	for (const source of envelope.plan.sources) stages.push({ kind: 'decode-source', authorityId: source.sourceId });
	for (const node of envelope.plan.nodes) stages.push({ kind: node.kind, authorityId: node.nodeId });
	if (envelope.plan.output.includeAudio) stages.push({ kind: 'audio-mix', authorityId: envelope.plan.project.id });
	stages.push({ kind: 'encode', authorityId: envelope.fingerprint });
	stages.push({ kind: 'atomic-publication', authorityId: envelope.plan.project.id });
	return Object.freeze(stages.map((stage, index) => Object.freeze({ index, ...stage })));
}

function assertEncoderSupported(envelope: NativeMediaPlanEnvelopeV2): void {
	const inventory = createNativeMediaV14SupportInventory();
	const profileId = envelope.plan.deliveryProfile as NativeMediaV14EncodeProfileId;
	const profile = inventory.videoEncode.find(({ id }) => id === profileId);
	if (!profile) throw new RangeError('Selected V14 output is absent from the authenticated format inventory.');
	const dispatch = nativeMediaV14EncodeDispatch(profileId);
	if (dispatch.encoder !== envelope.plan.codecs.videoEncoder
		|| dispatch.muxer !== envelope.plan.format.container
		|| dispatch.pixelFormat !== envelope.plan.codecs.pixelFormat
		|| dispatch.imageSequence !== profile.imageSequence
		|| (envelope.plan.output.includeAudio
			? dispatch.audioEncoder !== envelope.plan.codecs.audioEncoder
			: envelope.plan.codecs.audio !== null || envelope.plan.codecs.audioEncoder !== null)) {
		throw new RangeError('Selected V14 output differs from its closed native dispatch tuple.');
	}
	if (envelope.plan.output.includeAudio) {
		const audio = envelope.plan.codecs.audioEncoder;
		if (!inventory.audioEncode.some((profile) => (
			profile.codec === audio
				&& (profile.containers as readonly string[]).includes(envelope.plan.format.container)
		))) throw new RangeError('Selected V14 audio output is absent from the authenticated format inventory.');
	}
}

function assertSelectedBackendPlan(plan: NativeMediaBackendPlanV1): void {
	if (plan.fallback !== NATIVE_MEDIA_WEB_BACKEND || !Array.isArray(plan.attempts)
		|| plan.attempts.length > 2 || (plan.attempts.length > 0
			&& plan.attempts.at(-1) !== NATIVE_MEDIA_CPU_BACKEND)) {
		throw new TypeError('Selected V14 fallback must be one hardware attempt, native CPU, then Web Core.');
	}
	const baseline = createNativeMediaV14SupportInventory().acceleration[plan.platform][plan.operation];
	if (plan.attempts.length === 2 && plan.attempts[0] !== baseline) {
		throw new TypeError('Selected V14 execution refuses a vendor-specific implicit hardware backend.');
	}
}

/**
 * The plan sources the native path materializes as original bodies. A source
 * whose professional authority is a carrier-owned image sequence has no
 * original video body by design — its pixels arrive through the evaluated
 * carrier — so demanding a grant for it refused every sequence-bearing plan
 * at execution while enqueue-time admission had already accepted the job.
 */
function materializedPlanSources(envelope: NativeMediaPlanEnvelopeV2) {
	const sequenceSourceNodeIds = new Set(envelope.plan.nodes.flatMap((node) => (
		node.kind === 'professional-media' && node.imageSequence !== null ? [node.sourceNodeId] : []
	)));
	return envelope.plan.sources.filter((source) => !sequenceSourceNodeIds.has(source.nodeId));
}

function snapshotSources(
	envelope: NativeMediaPlanEnvelopeV2,
	value: readonly NativeMediaV14SourceGrant[],
): readonly NativeMediaV14SourceGrant[] {
	const materialized = materializedPlanSources(envelope);
	if (!Array.isArray(value) || value.length !== materialized.length) {
		throw new RangeError('Selected V14 execution requires one pathless grant per materialized plan source.');
	}
	const grants = new Map(value.map((grant) => [grant.sourceId, grant]));
	if (grants.size !== value.length) throw new RangeError('Selected V14 source grants must be unique.');
	return Object.freeze(materialized.map((source) => {
		const grant = grants.get(source.sourceId);
		if (!grant || grant.contentSha256 !== source.contentSha256) {
			throw new Error(`Selected V14 source grant ${source.sourceId} disagrees with its plan.`);
		}
		return Object.freeze({
			sourceId: stableId(grant.sourceId),
			grantId: opaqueId(grant.grantId, 'source grant'),
			contentSha256: digest(grant.contentSha256),
		});
	}));
}

function receiptValue(
	value: unknown,
	expected: Readonly<{
		readonly jobId: string; readonly envelope: NativeMediaPlanEnvelopeV2;
		readonly sources: readonly NativeMediaV14SourceGrant[]; readonly rootGrantId: string;
		readonly relativeDestination: string;
	}>,
): NativeMediaV14ExecutionReceipt {
	const row = record(value, 'V14 execution receipt');
	const hasTree = Object.hasOwn(row, 'tree');
	if (Reflect.ownKeys(row).sort().join(',') !== (hasTree
		? 'byteLength,planFingerprint,publication,sha256,tree'
		: 'byteLength,planFingerprint,publication,sha256')) {
		throw new TypeError('V14 execution receipt has missing or unsupported fields.');
	}
	if (row.planFingerprint !== expected.envelope.fingerprint || row.publication !== 'verified-temporary') {
		throw new Error('V14 execution receipt does not verify its exact temporary output.');
	}
	if (!Number.isSafeInteger(row.byteLength) || Number(row.byteLength) < 1) {
		throw new RangeError('V14 execution receipt byteLength must be positive.');
	}
	const base = {
		planFingerprint: expected.envelope.fingerprint,
		byteLength: Number(row.byteLength), sha256: digest(row.sha256), publication: 'verified-temporary' as const,
	};
	if (!hasTree) return Object.freeze(base);
	const profileId = expected.envelope.plan.deliveryProfile;
	if (profileId === undefined) throw new Error('A V14 output tree requires one exact delivery profile.');
	const identity = createNativeMediaOutputTreeIdentity({
		jobId: expected.jobId, planFingerprint: expected.envelope.fingerprint,
		rootGrantId: expected.rootGrantId, relativeDestination: expected.relativeDestination,
		sources: expected.sources, profileId, frameCount: expected.envelope.summary.outputFrameCount,
	});
	const tree = admitNativeMediaOutputTreeSummary(row.tree, identity);
	if (base.sha256 !== tree.manifestSha256) {
		throw new Error('V14 execution receipt disagrees with its output-tree manifest digest.');
	}
	return Object.freeze({ ...base, tree });
}

function opaqueId(value: unknown, label: string): string {
	if (typeof value !== 'string' || !/^[a-f0-9]{16,64}$/u.test(value)) throw new TypeError(`V14 ${label} is invalid.`);
	return value;
}
function fixedJobId(value: unknown): string {
	if (typeof value !== 'string' || !/^[a-f0-9]{40}$/u.test(value)) throw new TypeError('V14 job id is invalid.');
	return value;
}
function stableId(value: unknown): string {
	if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)) throw new TypeError('V14 source id is invalid.');
	return value;
}
function digest(value: unknown): string {
	if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) throw new TypeError('V14 digest is invalid.');
	return value;
}
function record(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object.`);
	return value as Record<string, unknown>;
}
function throwIfAborted(signal: AbortSignal | undefined): void {
	if (signal?.aborted) throw signal.reason ?? new DOMException('The V14 execution was aborted.', 'AbortError');
}
