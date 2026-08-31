/* SPDX-License-Identifier: AGPL-3.0-only */

/** Main-owned pathless admission for one baseline intermediate OpenFX frame. */

import {
	createNativeMediaPlanEnvelopeV2,
} from '../src/common/editor/native-media-plan-envelope-v2.ts';
import {
	canonicalizeNativeMediaPlan,
	fingerprintNativeMediaPlan,
} from '../src/common/editor/native-media-plan-canonical-form.ts';
import type { OfxRenderBackendV1 } from '../src/common/editor/native-ofx-host-contract.ts';
import type { FramescaperOpenFxPluginProjectionV1 } from '../src/common/editor/native-ofx-service-contract.ts';
import type {
	UnifiedExactRenderOpenFxNode,
	UnifiedExactRenderPlanV14,
} from '../src/common/editor/unified-exact-render-plan.ts';
import { framescaperOpenFxTransitionProgressNativeMedia } from '../src/framescaper/editor-openfx-frame-timing-native-media.ts';
import type { FramescaperOpenFxFrameExecutionResultNativeMedia } from '../src/framescaper/editor-openfx-frame-graph-native-media.ts';
import { deriveUnifiedExactOfxAbsentFreshnessV26 } from '../src/common/editor/native-ofx-freshness-authority.ts';
import { resolveOfxEffectStateV26 } from '../src/common/editor/native-ofx-state-v26.ts';
import type { NativePlanVideoTimingAssetBytes } from './native-services-video-timing-staging.ts';
import type { FramescaperOpenFxExecutionResultV1 } from './openfx-main-service.ts';
import type { FramescaperOpenFxExecutionRequestV1 } from './openfx-main-execution-request.ts';
import { createOpenFxMainRetimerSourceTimeV1 } from './openfx-main-retimer-source-time.ts';
import {
	FRAMESCAPER_PROJECT_SCHEMA_FAMILY,
	PROJECT_SCHEMA_VERSION,
	readProjectSchemaIdentity,
} from '../src/common/editor/project-schema-identity.ts';

const SHA256 = /^[a-f\d]{64}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9 ._:-]{0,127}$/u;
export const FRAMESCAPER_OPENFX_FRAME_MAXIMUM_PLAN_BYTES = 16 * 1024 * 1024;
const MAXIMUM_FRAME_SET_BYTES = 512 * 1024 * 1024;

export interface FramescaperOpenFxFrameControlV1 {
	readonly protocolVersion: 1;
	readonly schemaFamily: 'framescaper';
	readonly schemaVersion: 1;
	readonly planPayload: string;
	readonly planFingerprint: string;
	readonly instanceId: string;
	readonly outputOrdinal: number;
	readonly requestedBackend: OfxRenderBackendV1 | 'supported-preferred';
	readonly transitionProgress: number | null;
}

export interface FramescaperOpenFxFrameMainRequestV1 extends FramescaperOpenFxFrameControlV1 {
	readonly inputs: readonly Readonly<{
		readonly name: string;
		readonly sourceRef: string;
		readonly width: number;
		readonly height: number;
		readonly rgba: Uint8Array<ArrayBuffer>;
	}>[];
	readonly signal?: AbortSignal;
}

export interface AdmittedFramescaperOpenFxFrameControlV1 extends FramescaperOpenFxFrameControlV1 {
	readonly plan: UnifiedExactRenderPlanV14;
}

export interface FramescaperOpenFxFrameExecutionPorts {
	inventory(): readonly FramescaperOpenFxPluginProjectionV1[];
	execute(request: FramescaperOpenFxExecutionRequestV1): Promise<FramescaperOpenFxExecutionResultV1>;
	timingAssets(plan: UnifiedExactRenderPlanV14): Promise<readonly NativePlanVideoTimingAssetBytes[]>;
	currentProject(
		plan: UnifiedExactRenderPlanV14,
		effect: UnifiedExactRenderOpenFxNode['state'],
	): boolean | Promise<boolean>;
	supportedGpuBackends(): readonly Exclude<OfxRenderBackendV1, 'cpu'>[];
}

export interface FramescaperOpenFxFrameExecutionService {
	execute(request: FramescaperOpenFxFrameMainRequestV1): Promise<FramescaperOpenFxFrameExecutionResultNativeMedia>;
}

export function createFramescaperOpenFxFrameExecutionService(
	portsValue: FramescaperOpenFxFrameExecutionPorts,
): FramescaperOpenFxFrameExecutionService {
	const ports = exactPorts(portsValue);
	return Object.freeze({
		async execute(value: FramescaperOpenFxFrameMainRequestV1) {
			const request = admitRequest(value);
			const effect = effectNode(request.plan, request.instanceId);
			if (!await ports.currentProject(request.plan, effect.state)) {
				throw new Error('The pathless OpenFX frame plan is not the current baseline project revision.');
			}
			const resolvedPlugin = exactPlugin(ports.inventory(), effect);
			assertContextInputs(effect, request.inputs);
			if (resolvedPlugin.plugin === null) {
				return unavailableResult(request.plan, effect, resolvedPlugin.availability, resolvedPlugin.observed);
			}
			const plugin = resolvedPlugin.plugin;
			const transitionProgress = effect.state.context === 'transition'
				? framescaperOpenFxTransitionProgressNativeMedia(
					request.plan, effect.state.attachment.targetId, request.outputOrdinal,
				) : null;
			if (request.transitionProgress !== transitionProgress) {
				throw new Error('The renderer OpenFX Transition value is stale or forged.');
			}
			const timingAssets = effect.state.context === 'retimer'
				? await ports.timingAssets(request.plan) : Object.freeze([]);
			const retimerSourceTime = effect.state.context === 'retimer'
				? createOpenFxMainRetimerSourceTimeV1({
					plan: request.plan, instanceId: request.instanceId,
					outputOrdinal: request.outputOrdinal, timingAssets,
				}) : null;
			const backend = executionBackend(request.requestedBackend, ports.supportedGpuBackends());
			const result = await ports.execute(Object.freeze({
				pluginHandle: plugin.pluginHandle, plan: request.plan,
				instanceId: request.instanceId, requestedBackend: backend.backend,
				outputOrdinal: request.outputOrdinal,
				inputs: Object.freeze(request.inputs.map((input) => Object.freeze({
					name: input.name, sourceRef: input.sourceRef,
					width: input.width, height: input.height, rowBytes: input.width * 4,
					rgba: input.rgba,
				}))),
				retimerSourceTime,
				...(request.signal ? { signal: request.signal } : {}),
			}));
			return projectResult(result, request.plan, backend.reportsDegradation);
		},
	});
}

export function admitFramescaperOpenFxFrameControlV1(
	value: unknown,
): AdmittedFramescaperOpenFxFrameControlV1 {
	const identity = currentFramescaperIdentity(value, 'OpenFX frame control');
	const row = closed(value, [
		'protocolVersion', 'schemaFamily', 'schemaVersion', 'planPayload', 'planFingerprint', 'instanceId', 'outputOrdinal',
		'requestedBackend', 'transitionProgress',
	], [
		'protocolVersion', 'schemaFamily', 'schemaVersion', 'planPayload', 'planFingerprint', 'instanceId', 'outputOrdinal',
		'requestedBackend', 'transitionProgress',
	], 'OpenFX frame control');
	if (row.protocolVersion !== 1 || typeof row.planPayload !== 'string'
		|| new TextEncoder().encode(row.planPayload).byteLength > FRAMESCAPER_OPENFX_FRAME_MAXIMUM_PLAN_BYTES
		|| typeof row.planFingerprint !== 'string' || !SHA256.test(row.planFingerprint)
		|| typeof row.instanceId !== 'string' || !ID.test(row.instanceId)
		|| typeof row.outputOrdinal !== 'number' || !Number.isSafeInteger(row.outputOrdinal)
		|| row.outputOrdinal < 0 || typeof row.requestedBackend !== 'string'
		|| !['cpu', 'opengl', 'opencl', 'cuda', 'metal', 'supported-preferred']
			.includes(row.requestedBackend)
		|| (row.transitionProgress !== null && (typeof row.transitionProgress !== 'number'
			|| !Number.isFinite(row.transitionProgress) || row.transitionProgress < 0
			|| row.transitionProgress > 1))) {
		throw new TypeError('The pathless OpenFX frame control has invalid bounded authority.');
	}
	let parsed: unknown;
	try { parsed = JSON.parse(row.planPayload) as unknown; }
	catch { throw new TypeError('The pathless OpenFX frame plan is malformed JSON.'); }
	const envelope = createNativeMediaPlanEnvelopeV2(parsed);
	if (envelope.planVersion !== 14 || envelope.fingerprint !== row.planFingerprint
		|| canonicalizeNativeMediaPlan(envelope.plan) !== row.planPayload
		|| fingerprintNativeMediaPlan(envelope.plan).sha256 !== row.planFingerprint) {
		throw new Error('The pathless OpenFX frame plan is not exact canonical V14 authority.');
	}
	const plan = envelope.plan as UnifiedExactRenderPlanV14;
	if (row.outputOrdinal >= plan.output.frameCount) {
		throw new RangeError('The OpenFX frame control exceeds its V14 output domain.');
	}
	return Object.freeze({
		protocolVersion: 1 as const, ...identity, planPayload: row.planPayload,
		planFingerprint: row.planFingerprint, plan, instanceId: row.instanceId,
		outputOrdinal: row.outputOrdinal,
		requestedBackend: row.requestedBackend as OfxRenderBackendV1 | 'supported-preferred',
		transitionProgress: row.transitionProgress as number | null,
	});
}

function admitRequest(value: unknown): FramescaperOpenFxFrameMainRequestV1 & Readonly<{
	readonly plan: UnifiedExactRenderPlanV14;
}> {
	const row = closed(value, [
		'protocolVersion', 'schemaFamily', 'schemaVersion', 'planPayload', 'planFingerprint', 'instanceId', 'outputOrdinal',
		'requestedBackend', 'transitionProgress', 'inputs', 'signal',
	], [
		'protocolVersion', 'schemaFamily', 'schemaVersion', 'planPayload', 'planFingerprint', 'instanceId', 'outputOrdinal',
		'requestedBackend', 'transitionProgress', 'inputs',
	], 'OpenFX frame execution request');
	const control = admitFramescaperOpenFxFrameControlV1({
		protocolVersion: row.protocolVersion, schemaFamily: row.schemaFamily,
		schemaVersion: row.schemaVersion, planPayload: row.planPayload,
		planFingerprint: row.planFingerprint, instanceId: row.instanceId,
		outputOrdinal: row.outputOrdinal, requestedBackend: row.requestedBackend,
		transitionProgress: row.transitionProgress,
	});
	if (row.signal !== undefined && !(row.signal instanceof AbortSignal)) {
		throw new TypeError('The pathless OpenFX frame request has invalid bounded authority.');
	}
	if (!Array.isArray(row.inputs) || row.inputs.length > 16) {
		throw new RangeError('The OpenFX frame request exceeds its V14 domain.');
	}
	let residentBytes = 0;
	const inputs = row.inputs.map((value_, index) => {
		const input = closed(value_, ['name', 'sourceRef', 'width', 'height', 'rgba'],
			['name', 'sourceRef', 'width', 'height', 'rgba'], `OpenFX input ${String(index)}`);
		if (!ID.test(String(input.name)) || !ID.test(String(input.sourceRef))
			|| input.width !== control.plan.output.canvas.width
			|| input.height !== control.plan.output.canvas.height
			|| !(input.rgba instanceof Uint8Array)
			|| Object.getPrototypeOf(input.rgba) !== Uint8Array.prototype
			|| !(input.rgba.buffer instanceof ArrayBuffer)
			|| input.rgba.byteLength !== Number(input.width) * Number(input.height) * 4) {
			throw new TypeError('A pathless OpenFX input is not exact V14 RGBA8.');
		}
		residentBytes += input.rgba.byteLength;
		if (residentBytes > MAXIMUM_FRAME_SET_BYTES) throw new RangeError('The OpenFX named input set exceeds its byte ceiling.');
		return Object.freeze({
			name: String(input.name), sourceRef: String(input.sourceRef),
			width: Number(input.width), height: Number(input.height),
			rgba: new Uint8Array(input.rgba) as Uint8Array<ArrayBuffer>,
		});
	});
	return Object.freeze({
		...control,
		inputs: Object.freeze(inputs),
		...(row.signal ? { signal: row.signal as AbortSignal } : {}),
	});
}

function currentFramescaperIdentity(
	value: unknown,
	label: string,
): Readonly<{ schemaFamily: 'framescaper'; schemaVersion: 1 }> {
	const identity = readProjectSchemaIdentity(value);
	if (identity.schemaFamily !== FRAMESCAPER_PROJECT_SCHEMA_FAMILY
		|| identity.schemaVersion !== PROJECT_SCHEMA_VERSION) {
		throw new RangeError(`${label} requires the current Framescaper project schema.`);
	}
	return Object.freeze({ schemaFamily: FRAMESCAPER_PROJECT_SCHEMA_FAMILY,
		schemaVersion: PROJECT_SCHEMA_VERSION });
}

function exactPorts(value: unknown): FramescaperOpenFxFrameExecutionPorts {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('OpenFX frame ports are invalid.');
	const ports = value as Partial<FramescaperOpenFxFrameExecutionPorts>;
	if (typeof ports.inventory !== 'function' || typeof ports.execute !== 'function'
		|| typeof ports.timingAssets !== 'function' || typeof ports.currentProject !== 'function'
		|| typeof ports.supportedGpuBackends !== 'function') {
		throw new TypeError('OpenFX frame ports are incomplete.');
	}
	return ports as FramescaperOpenFxFrameExecutionPorts;
}

function effectNode(plan: UnifiedExactRenderPlanV14, instanceId: string): UnifiedExactRenderOpenFxNode {
	const matches = plan.nodes.filter((node): node is UnifiedExactRenderOpenFxNode => (
		node.kind === 'openfx' && node.state.instanceId === instanceId
	));
	if (matches.length !== 1) throw new ReferenceError('The exact V14 OpenFX frame node is unavailable.');
	return matches[0]!;
}

function exactPlugin(
	value: readonly FramescaperOpenFxPluginProjectionV1[],
	effect: UnifiedExactRenderOpenFxNode,
): Readonly<{
	readonly plugin: FramescaperOpenFxPluginProjectionV1 | null;
	readonly availability: 'missing' | 'fingerprint-changed';
	readonly observed: FramescaperOpenFxPluginProjectionV1 | null;
}> {
	const matches = value.filter((plugin) => plugin.pluginId === effect.state.pluginId
		&& plugin.binarySha256 === effect.state.binarySha256);
	if (matches.length > 1) throw new Error('The exact OpenFX plug-in fingerprint is ambiguous.');
	if (matches.length === 1) return Object.freeze({
		plugin: matches[0]!, availability: 'missing', observed: matches[0]!,
	});
	const sameId = value.filter(({ pluginId }) => pluginId === effect.state.pluginId);
	if (sameId.length > 1) throw new Error('The changed OpenFX plug-in fingerprint is ambiguous.');
	return Object.freeze({
		plugin: null, availability: sameId.length === 1 ? 'fingerprint-changed' : 'missing',
		observed: sameId[0] ?? null,
	});
}

function unavailableResult(
	plan: UnifiedExactRenderPlanV14,
	effect: UnifiedExactRenderOpenFxNode,
	availability: 'missing' | 'fingerprint-changed',
	observed: FramescaperOpenFxPluginProjectionV1 | null,
): FramescaperOpenFxFrameExecutionResultNativeMedia {
	// The freshness must be derived from current render authority, never fed
	// back from the authored state — that made the frozen gate a tautology and
	// served stale frozen frames after any timeline edit.
	const resolved = resolveOfxEffectStateV26(effect.state, {
		availability, pluginId: observed?.pluginId ?? null,
		binarySha256: observed?.binarySha256 ?? null,
		freshness: deriveUnifiedExactOfxAbsentFreshnessV26(plan, effect.state.instanceId),
	});
	return resolved.mode === 'frozen' ? Object.freeze({
		mode: 'frozen' as const, availability, reportsDegradation: true as const,
		frozenFallback: effect.state.frozenFallback,
	}) : Object.freeze({
		mode: 'bypass' as const, availability,
		reportsDegradation: resolved.reportsDegradation,
	});
}

function assertContextInputs(
	effect: UnifiedExactRenderOpenFxNode,
	inputs: FramescaperOpenFxFrameMainRequestV1['inputs'],
): void {
	if (inputs.length !== effect.state.inputs.length || inputs.some((input, index) => (
		input.name !== effect.state.inputs[index]!.name
		|| input.sourceRef !== effect.state.inputs[index]!.sourceRef
	))) throw new Error('The OpenFX named planes do not match exact V14 node order and identity.');
	const names = inputs.map(({ name }) => name);
	if (effect.state.context === 'transition'
		&& (names[0] !== 'SourceFrom' || names[1] !== 'SourceTo'
			|| inputs[0]!.sourceRef === inputs[1]!.sourceRef)) {
		throw new Error('OpenFX Transition requires distinct SourceFrom and SourceTo planes.');
	}
	if (effect.state.context === 'paint'
		&& (names[0] !== 'Source' || names[1] !== 'Mask')) {
		throw new Error('OpenFX Paint requires explicit Source and Mask planes.');
	}
}

function projectResult(
	result: FramescaperOpenFxExecutionResultV1,
	plan: UnifiedExactRenderPlanV14,
	forcedDegradation: boolean,
): FramescaperOpenFxFrameExecutionResultNativeMedia {
	if (result.mode !== 'render') return result.mode === 'frozen'
		? Object.freeze({ mode: result.mode, availability: result.availability,
			reportsDegradation: true as const, frozenFallback: result.frozenFallback })
		: Object.freeze({ mode: result.mode, availability: result.availability,
			reportsDegradation: result.reportsDegradation });
	const expected = plan.output.canvas.width * plan.output.canvas.height * 4;
	if (!(result.rgba instanceof Uint8Array) || result.rgba.byteLength !== expected) {
		throw new Error('The main-owned OpenFX output does not match its exact V14 canvas.');
	}
	return Object.freeze({
		mode: 'render' as const,
		rgba: Object.freeze({ width: plan.output.canvas.width, height: plan.output.canvas.height,
			pixels: result.rgba.slice() as Uint8Array<ArrayBuffer> }),
		backend: result.backend, retriedOnCpu: result.retriedOnCpu || forcedDegradation,
		reportsDegradation: result.reportsDegradation || forcedDegradation,
	});
}

function executionBackend(
	requested: FramescaperOpenFxFrameMainRequestV1['requestedBackend'],
	supportedValue: readonly Exclude<OfxRenderBackendV1, 'cpu'>[],
): Readonly<{ backend: OfxRenderBackendV1; reportsDegradation: boolean }> {
	if (!Array.isArray(supportedValue) || supportedValue.some((backend) => (
		!['opengl', 'opencl', 'cuda', 'metal'].includes(backend)
	))) throw new TypeError('Verified OpenFX GPU support is invalid.');
	const supported = Object.freeze([...new Set(supportedValue)]);
	if (requested === 'supported-preferred') {
		return Object.freeze({ backend: supported[0] ?? 'cpu', reportsDegradation: false });
	}
	if (requested === 'cpu' || supported.includes(requested)) {
		return Object.freeze({ backend: requested, reportsDegradation: false });
	}
	return Object.freeze({ backend: 'cpu', reportsDegradation: true });
}

function closed(
	value: unknown,
	allowed: readonly string[],
	required: readonly string[],
	name: string,
): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`${name} must be a closed plain record.`);
	}
	const row = value as Record<string, unknown>;
	const keys = Reflect.ownKeys(row);
	if (keys.some((key) => typeof key !== 'string' || !allowed.includes(key))
		|| required.some((key) => !Object.hasOwn(row, key))) throw new TypeError(`${name} has unsupported fields.`);
	for (const key of keys) {
		const descriptor = Object.getOwnPropertyDescriptor(row, key);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name}.${String(key)} must be an own data field.`);
		}
	}
	return row;
}
