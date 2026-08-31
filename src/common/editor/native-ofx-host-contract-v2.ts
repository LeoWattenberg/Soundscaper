/* SPDX-License-Identifier: AGPL-3.0-only */

import { OFX_CONTEXTS, OFX_HOST_SUITES, OFX_PARAMETER_TYPES, OFX_THREADING_DECLARATIONS, type OfxContext } from './native-ofx-descriptor.ts';
import {
	OFX_HOST_ACTIONS_V1,
	snapshotOfxRetimerSourceTimeWireV1,
	type OfxHostActionV1,
	type OfxRetimerSourceTimeWireV1,
	type OfxRenderBackendV1,
} from './native-ofx-host-contract.ts';
import { assertAuthenticatedOfxRetimerSourceTimeV1 } from './native-ofx-retimer-source-time.ts';
import { createNativeValidators } from './native-validation.ts';

export const OFX_HOST_EXECUTION_CONTRACT_V2 = Object.freeze({
	openfxVersion: '1.5.1' as const,
	contexts: OFX_CONTEXTS,
	suites: OFX_HOST_SUITES,
	parameterTypes: OFX_PARAMETER_TYPES,
	threadingDeclarations: OFX_THREADING_DECLARATIONS,
	actions: OFX_HOST_ACTIONS_V1,
	interactSuite: 'interact-suite-v1' as const,
	overlayProperty: 'kOfxImageEffectPluginPropOverlayInteractV2' as const,
	customParameterInteract: true as const,
	drawSuite: 'draw-suite-v1' as const,
	cpuRenderingRequired: true as const,
	supportedGpuBackends: Object.freeze(['opengl', 'opencl', 'cuda', 'metal'] as const),
	gatedBackends: Object.freeze([] as const),
	abortPollingRequired: true as const,
	offscreenUiOnly: true as const,
	deniedAuthorities: Object.freeze(['network', 'arbitrary-filesystem', 'vendor-top-level-window'] as const),
});

export interface OfxHostInvocationV2 {
	readonly schemaVersion: 2;
	readonly invocationId: string;
	readonly unifiedPlanVersion: 14;
	readonly unifiedPlanSha256: string;
	readonly nodeId: string;
	readonly instanceId: string;
	readonly pluginId: string;
	readonly pluginBinarySha256: string;
	readonly pluginFingerprint: string;
	readonly context: OfxContext;
	readonly action: OfxHostActionV1;
	readonly stateSha256: string;
	readonly inputFrameStreamIds: readonly string[];
	readonly outputFrameStreamId: string | null;
	readonly outputOrdinal: number;
	readonly requestedBackend: OfxRenderBackendV1;
	readonly abortSignalId: string;
	readonly retimerSourceTime: OfxRetimerSourceTimeWireV1 | null;
}

const FIELDS = Object.freeze([
	'schemaVersion', 'invocationId', 'unifiedPlanVersion', 'unifiedPlanSha256', 'nodeId',
	'instanceId', 'pluginId', 'pluginBinarySha256', 'pluginFingerprint', 'context', 'action',
	'stateSha256', 'inputFrameStreamIds', 'outputFrameStreamId', 'outputOrdinal',
	'requestedBackend', 'abortSignalId', 'retimerSourceTime',
]);
const ID = /^[A-Za-z0-9][A-Za-z0-9 ._:-]{0,127}$/u;
const GRAPH_ID = /^[A-Za-z0-9][A-Za-z0-9 ._:/-]{0,4095}$/u;
const { digest, exactKeys, nonNegativeInteger, pattern, plainRecord } = createNativeValidators({
	subject: 'An OFX V14 host invocation', article: 'An', requirePlainPrototype: true,
	raise: (message: string): never => { throw new TypeError(message); },
});

export function createOfxHostInvocationV2(value: Readonly<Record<string, unknown>>): OfxHostInvocationV2 {
	const pluginId = pattern(value.pluginId, ID, 'pluginId');
	const pluginBinarySha256 = digest(value.pluginBinarySha256, 'pluginBinarySha256');
	// The oracle's authentication is identity-based, so it must run on the
	// caller's own value before any snapshot: a clone can never re-enter the
	// WeakSet, and asserting it afterwards refused every genuine Retimer frame.
	if (value.context === 'retimer') assertAuthenticatedOfxRetimerSourceTimeV1(value.retimerSourceTime);
	const invocation = {
		schemaVersion: 2 as const,
		invocationId: pattern(value.invocationId, ID, 'invocationId'),
		unifiedPlanVersion: 14 as const,
		unifiedPlanSha256: digest(value.unifiedPlanSha256, 'unifiedPlanSha256'),
		nodeId: pattern(value.nodeId, GRAPH_ID, 'nodeId'),
		instanceId: pattern(value.instanceId, ID, 'instanceId'),
		pluginId, pluginBinarySha256, pluginFingerprint: `${pluginId}@${pluginBinarySha256}`,
		context: value.context as OfxContext, action: value.action as OfxHostActionV1,
		stateSha256: digest(value.stateSha256, 'stateSha256'),
		inputFrameStreamIds: ids(value.inputFrameStreamIds),
		outputFrameStreamId: value.outputFrameStreamId === null ? null : pattern(value.outputFrameStreamId, ID, 'outputFrameStreamId'),
		outputOrdinal: nonNegativeInteger(value.outputOrdinal, 'outputOrdinal'),
		requestedBackend: value.requestedBackend as OfxHostInvocationV2['requestedBackend'],
		abortSignalId: pattern(value.abortSignalId, ID, 'abortSignalId'),
		retimerSourceTime: value.retimerSourceTime === undefined
			? null : snapshotOfxRetimerSourceTimeWireV1(value.retimerSourceTime),
	};
	assertOfxHostInvocationV2(invocation);
	return deepFreeze(invocation);
}

export function assertOfxHostInvocationV2(value: unknown): asserts value is OfxHostInvocationV2 {
	const invocation = plainRecord(value, 'OFX V14 host invocation');
	exactKeys(invocation, FIELDS, 'OFX V14 host invocation');
	if (invocation.schemaVersion !== 2 || invocation.unifiedPlanVersion !== 14) {
		throw new RangeError('An OFX invocation V2 requires unified exact plan V14.');
	}
	pattern(invocation.invocationId, ID, 'invocationId'); digest(invocation.unifiedPlanSha256, 'unifiedPlanSha256');
	pattern(invocation.nodeId, GRAPH_ID, 'nodeId'); pattern(invocation.instanceId, ID, 'instanceId');
	const pluginId = pattern(invocation.pluginId, ID, 'pluginId');
	const binary = digest(invocation.pluginBinarySha256, 'pluginBinarySha256');
	if (invocation.pluginFingerprint !== `${pluginId}@${binary}`) throw new Error('OFX V2 plug-in fingerprint changed.');
	if (!(OFX_CONTEXTS as readonly unknown[]).includes(invocation.context)
		|| !(OFX_HOST_ACTIONS_V1 as readonly unknown[]).includes(invocation.action)) throw new RangeError('OFX V2 context or action is unsupported.');
	digest(invocation.stateSha256, 'stateSha256'); ids(invocation.inputFrameStreamIds);
	if (invocation.outputFrameStreamId !== null) pattern(invocation.outputFrameStreamId, ID, 'outputFrameStreamId');
	nonNegativeInteger(invocation.outputOrdinal, 'outputOrdinal');
	if (!['cpu', 'opengl', 'opencl', 'cuda', 'metal'].includes(String(invocation.requestedBackend))) {
		throw new RangeError('OFX V2 backend is unsupported.');
	}
	pattern(invocation.abortSignalId, ID, 'abortSignalId');
	if (invocation.context === 'retimer') {
		if (invocation.retimerSourceTime === null) throw new Error('An OFX Retimer invocation requires SourceTime.');
		// Structural admission only: this assertion also runs on grants after the
		// main-to-helper boundary, where the oracle identity cannot survive. The
		// identity authentication belongs to construction, on the original value.
		snapshotOfxRetimerSourceTimeWireV1(invocation.retimerSourceTime);
	} else if (invocation.retimerSourceTime !== null) throw new Error('Only OFX Retimer may carry SourceTime.');
}

function ids(value: unknown): readonly string[] {
	if (!Array.isArray(value) || value.length > 16) throw new RangeError('OFX V2 input streams are invalid.');
	const result = value.map((id) => pattern(id, ID, 'inputFrameStreamId'));
	if (new Set(result).size !== result.length) throw new RangeError('OFX V2 input streams must be unique.');
	return Object.freeze(result);
}
function deepFreeze<Value>(value: Value): Value {
	if (value && typeof value === 'object' && !Object.isFrozen(value)) {
		for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
		Object.freeze(value);
	}
	return value;
}
