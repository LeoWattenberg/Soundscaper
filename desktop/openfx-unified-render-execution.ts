/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Main-owned V12-to-OpenFX execution seam.
 *
 * The selected product cannot enter this seam: production third-party loading
 * remains blocked until an independently reviewed OS isolation attestation is
 * implemented. The owned conformance fixture can exercise the exact candidate
 * contract without weakening that production gate.
 */

import {
	type HelperDataPlaneBinding,
	type HelperDataPlaneOutputReservation,
	type HelperExecutableGrant,
	type HelperOfxHostJobGrant,
	type HelperOfxInputFrameGrant,
	type HelperScratchGrant,
	validateHelperJobGrant,
} from './helper-contract.ts';
import {
	admitHelperDataPlaneTransfers,
	type HelperDataPlaneTransfer,
} from './helper-data-plane-transfer.ts';
import type { HelperJobRequest } from './helper-supervisor.ts';
import {
	type OfxCpuAttempt,
	type OfxIsolatedHostManager,
} from './openfx-isolated-host-manager.ts';
import {
	canonicalizeNativeMediaSummaryValue,
	fingerprintNativeMediaPlan,
} from '../src/common/editor/native-media-plan-canonical-form.ts';
import { createNativeMediaPlanEnvelopeV1 } from '../src/common/editor/native-media-plan-envelope.ts';
import {
	createOfxHostInvocationV1,
	type OfxRenderBackendV1,
} from '../src/common/editor/native-ofx-host-contract.ts';
import type { OfxRetimerSourceTimeV1 } from '../src/common/editor/native-ofx-retimer-source-time.ts';
import {
	resolveOfxEffectStateV26,
	type OfxEffectFreshnessV26,
	type OfxEffectRuntimeV26,
	type OfxEffectStateV26,
	type OfxFrozenFallbackV26,
} from '../src/common/editor/native-ofx-state-v26.ts';
import {
	assertUnifiedExactRenderPlanV12,
	type UnifiedExactRenderOpenFxNode,
	type UnifiedExactRenderPlanV12,
} from '../src/common/editor/unified-exact-render-plan.ts';

export const OFX_CANDIDATE_EXECUTION_POLICIES = Object.freeze([
	'production-unattested',
	'framescaper-conformance-fixture',
] as const);
export type OfxCandidateExecutionPolicy = (typeof OFX_CANDIDATE_EXECUTION_POLICIES)[number];

export interface OfxBoundDataPlaneV1 {
	readonly binding: HelperDataPlaneBinding;
	readonly transfer: HelperDataPlaneTransfer;
}

export interface OfxBoundInputFrameV1 extends OfxBoundDataPlaneV1 {
	readonly name: string;
	readonly sourceRef: string;
	readonly pixelFormat: 'rgba8';
	readonly width: number;
	readonly height: number;
	readonly rowBytes: number;
}

export interface OfxBoundOutputFrameV1 {
	readonly binding: HelperDataPlaneOutputReservation;
	readonly transfer: HelperDataPlaneTransfer;
	readonly pixelFormat: 'rgba8';
	readonly width: number;
	readonly height: number;
	readonly rowBytes: number;
}

export interface OfxUnifiedHostAttemptResourcesV1 {
	readonly invocationId: string;
	readonly abortSignalId: string;
	readonly executable: HelperExecutableGrant;
	readonly pluginBinary: HelperExecutableGrant;
	readonly plan: OfxBoundDataPlaneV1;
	readonly inputs: readonly OfxBoundInputFrameV1[];
	readonly output: OfxBoundOutputFrameV1;
	readonly scratch: HelperScratchGrant;
	readonly retimerSourceTime?: OfxRetimerSourceTimeV1 | null;
}

export interface OfxUnifiedNodeExecutionRequestV1 {
	readonly plan: UnifiedExactRenderPlanV12;
	readonly instanceId: string;
	readonly runtime: OfxEffectRuntimeV26;
	readonly requestedBackend: OfxRenderBackendV1;
	readonly executionPolicy: OfxCandidateExecutionPolicy;
	readonly signal?: AbortSignal;
	readonly createAttemptResources: (
		backend: OfxRenderBackendV1,
	) => OfxUnifiedHostAttemptResourcesV1;
}

export type OfxUnifiedNodeExecutionReasonV1 =
	| OfxEffectRuntimeV26['availability']
	| 'isolation-unavailable';

export type OfxUnifiedNodeExecutionResultV1 = Readonly<
	| {
		readonly mode: 'render';
		readonly availability: 'available';
		readonly authoredStatePreserved: true;
		readonly reportsDegradation: boolean;
		readonly backend: OfxRenderBackendV1;
		readonly retriedOnCpu: boolean;
		readonly output: Readonly<{ readonly streamId: string; readonly byteLength: number; readonly sha256: string }>;
	}
	| {
		readonly mode: 'frozen' | 'bypass';
		readonly availability: OfxEffectRuntimeV26['availability'];
		readonly reason: OfxUnifiedNodeExecutionReasonV1;
		readonly authoredStatePreserved: true;
		readonly reportsDegradation: boolean;
		readonly frozenFallback: OfxFrozenFallbackV26 | null;
	}
>;

/** Build one helper attempt from a canonical V12 node and exact MessagePorts. */
export function createUnifiedExactOfxHostAttemptV1(
	plan: UnifiedExactRenderPlanV12,
	instanceId: string,
	requestedBackend: OfxRenderBackendV1,
	resources: OfxUnifiedHostAttemptResourcesV1,
	signal?: AbortSignal,
): OfxCpuAttempt {
	assertUnifiedExactRenderPlanV12(plan);
	const effect = effectNode(plan, instanceId);
	if (!effect.state.enabled) throw new Error('A bypassed OpenFX V12 node cannot create a host attempt.');
	const envelope = createNativeMediaPlanEnvelopeV1(plan);
	if (resources.plan.binding.byteLength !== envelope.canonicalByteLength
		|| resources.plan.binding.sha256 !== envelope.fingerprint) {
		throw new Error('The OpenFX plan stream does not authenticate the exact canonical V12 plan.');
	}
	if (resources.pluginBinary.sha256 !== effect.state.binarySha256) {
		throw new Error('The OpenFX plug-in authority does not match the V12 node binary fingerprint.');
	}
	const inputs = bindInputs(effect.state, resources.inputs);
	const invocation = createOfxHostInvocationV1({
		invocationId: resources.invocationId,
		unifiedPlanVersion: 12,
		unifiedPlanSha256: envelope.fingerprint,
		nodeId: effect.nodeId,
		instanceId: effect.state.instanceId,
		pluginId: effect.state.pluginId,
		pluginBinarySha256: effect.state.binarySha256,
		context: effect.state.context,
		action: 'render',
		stateSha256: fingerprintNativeMediaPlan(effect.state).sha256,
		inputFrameStreamIds: inputs.map(({ frame }) => frame.streamId),
		outputFrameStreamId: resources.output.binding.streamId,
		requestedBackend,
		abortSignalId: resources.abortSignalId,
		retimerSourceTime: resources.retimerSourceTime,
	});
	const grant = validateHelperJobGrant('ofx-host', {
		executable: resources.executable,
		pluginBinary: resources.pluginBinary,
		invocation,
		plan: resources.plan.binding,
		inputs,
		output: {
			pixelFormat: resources.output.pixelFormat,
			width: resources.output.width,
			height: resources.output.height,
			rowBytes: resources.output.rowBytes,
			frame: resources.output.binding,
		},
		scratch: resources.scratch,
	}) as HelperOfxHostJobGrant;
	const transfers = Object.freeze([
		transfer(resources.plan),
		...resources.inputs.map(transfer),
		transfer(resources.output),
	]);
	admitHelperDataPlaneTransfers('ofx-host', grant, transfers);
	const request: HelperJobRequest<'ofx-host'> = Object.freeze({
		kind: 'ofx-host' as const,
		grant,
		dataPlaneTransfers: transfers,
		...(signal ? { signal } : {}),
	});
	return Object.freeze({ invocation, request });
}

/** Execute, or resolve without execution to exact fresh frozen/bypass recovery. */
export async function executeUnifiedExactOfxNodeV1(
	manager: OfxIsolatedHostManager,
	request: OfxUnifiedNodeExecutionRequestV1,
): Promise<OfxUnifiedNodeExecutionResultV1> {
	assertUnifiedExactRenderPlanV12(request.plan);
	const effect = effectNode(request.plan, request.instanceId);
	const initial = resolveOfxEffectStateV26(effect.state, request.runtime);
	if (initial.mode !== 'render') {
		return recovery(effect.state, request.runtime.availability, request.runtime.freshness);
	}
	if (!(OFX_CANDIDATE_EXECUTION_POLICIES as readonly unknown[])
		.includes(request.executionPolicy)) {
		throw new RangeError('The OpenFX candidate execution policy is unsupported.');
	}
	if (request.executionPolicy === 'production-unattested'
		|| effect.state.pluginId !== 'org.framescaper.conformance') {
		return recovery(effect.state, 'revoked', request.runtime.freshness, 'isolation-unavailable');
	}
	request.signal?.throwIfAborted();
	const primary = createUnifiedExactOfxHostAttemptV1(
		request.plan,
		request.instanceId,
		request.requestedBackend,
		request.createAttemptResources(request.requestedBackend),
		request.signal,
	);
	const cpu = request.requestedBackend === 'cpu' ? null : createUnifiedExactOfxHostAttemptV1(
		request.plan,
		request.instanceId,
		'cpu',
		request.createAttemptResources('cpu'),
		request.signal,
	);
	if (cpu !== null) assertSameRenderAuthority(primary, cpu);
	try {
		const rendered = await manager.renderWithCpuFallback({
			...primary,
			createCpuAttempt: () => {
				if (cpu === null) throw new Error('A CPU OpenFX request cannot retry itself.');
				return cpu;
			},
		});
		return Object.freeze({
			mode: 'render' as const,
			availability: 'available' as const,
			authoredStatePreserved: true as const,
			reportsDegradation: rendered.reportsDegradation,
			backend: rendered.backend,
			retriedOnCpu: rendered.retriedOnCpu,
			output: rendered.result.output,
		});
	} catch (error) {
		if (isCancellation(error, request.signal)) throw error;
		const fingerprint = primary.invocation.pluginFingerprint;
		const quarantined = manager.snapshot().runtimes
			.some((runtime) => runtime.pluginFingerprint === fingerprint && runtime.quarantined);
		return recovery(
			effect.state,
			quarantined ? 'quarantined' : 'crashed',
			request.runtime.freshness,
		);
	}
}

function effectNode(
	plan: UnifiedExactRenderPlanV12,
	instanceId: string,
): UnifiedExactRenderOpenFxNode {
	const node = plan.nodes.find((candidate): candidate is UnifiedExactRenderOpenFxNode => (
		candidate.kind === 'openfx' && candidate.state.instanceId === instanceId
	));
	if (!node) throw new ReferenceError('The exact V12 OpenFX instance is unavailable.');
	return node;
}

function bindInputs(
	state: OfxEffectStateV26,
	resources: readonly OfxBoundInputFrameV1[],
): readonly HelperOfxInputFrameGrant[] {
	if (resources.length !== state.inputs.length) {
		throw new Error('The OpenFX helper input count does not match the exact V12 node.');
	}
	return Object.freeze(resources.map((resource, index) => {
		const expected = state.inputs[index]!;
		if (resource.name !== expected.name || resource.sourceRef !== expected.sourceRef) {
			throw new Error('The OpenFX helper input name or source identity does not match V12.');
		}
		return Object.freeze({
			name: expected.name,
			sourceRef: expected.sourceRef,
			pixelFormat: resource.pixelFormat,
			width: resource.width,
			height: resource.height,
			rowBytes: resource.rowBytes,
			frame: resource.binding,
		});
	}));
}

function transfer(value: Readonly<{ transfer: HelperDataPlaneTransfer }>): HelperDataPlaneTransfer {
	return Object.freeze({ streamId: value.transfer.streamId, port: value.transfer.port });
}

function assertSameRenderAuthority(primary: OfxCpuAttempt, cpu: OfxCpuAttempt): void {
	const semantics = (attempt: OfxCpuAttempt) => {
		const grant = attempt.request.grant;
		return canonicalizeNativeMediaSummaryValue({
			plan: [grant.plan.byteLength, grant.plan.sha256],
			executable: grant.executable,
			pluginBinary: grant.pluginBinary,
			node: [grant.invocation.nodeId, grant.invocation.instanceId],
			plugin: [grant.invocation.pluginId, grant.invocation.pluginBinarySha256],
			context: grant.invocation.context,
			stateSha256: grant.invocation.stateSha256,
			retimerSourceTime: grant.invocation.retimerSourceTime,
			inputs: grant.inputs.map(({ name, sourceRef, pixelFormat, width, height, rowBytes, frame }) => (
				[name, sourceRef, pixelFormat, width, height, rowBytes, frame.byteLength, frame.sha256]
			)),
			output: [
				grant.output.pixelFormat, grant.output.width, grant.output.height,
				grant.output.rowBytes,
				grant.output.frame.exactByteLength, grant.output.frame.maximumByteLength,
			],
		});
	};
	if (semantics(primary) !== semantics(cpu)) {
		throw new Error('An OpenFX CPU retry must preserve exact plan, plug-in, input, and output authority.');
	}
}

function recovery(
	state: OfxEffectStateV26,
	availability: OfxEffectRuntimeV26['availability'],
	freshness: OfxEffectFreshnessV26,
	reason: OfxUnifiedNodeExecutionReasonV1 = availability,
): OfxUnifiedNodeExecutionResultV1 {
	const resolved = resolveOfxEffectStateV26(state, {
		availability,
		pluginId: null,
		binarySha256: null,
		freshness,
	});
	return Object.freeze({
		mode: resolved.mode as 'frozen' | 'bypass',
		availability,
		reason,
		authoredStatePreserved: true as const,
		reportsDegradation: resolved.reportsDegradation,
		frozenFallback: resolved.mode === 'frozen' ? state.frozenFallback : null,
	});
}

function isCancellation(error: unknown, signal: AbortSignal | undefined): boolean {
	if (signal?.aborted) return true;
	if (error instanceof DOMException && error.name === 'AbortError') return true;
	return Boolean(error && typeof error === 'object'
		&& (error as { readonly cause_?: unknown }).cause_ === 'cancelled');
}
