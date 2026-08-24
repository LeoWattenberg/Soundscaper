/* SPDX-License-Identifier: AGPL-3.0-only */

/** Context-aware selected-V28 OpenFX execution over explicit intermediate RGBA planes. */

import type { OfxInputBindingV1, OfxPluginAvailability } from '../common/editor/native-ofx-binding.ts';
import type { OfxContext } from '../common/editor/native-ofx-descriptor.ts';
import type { OfxRenderBackendV1 } from '../common/editor/native-ofx-host-contract.ts';
import {
	assertOfxEffectStateV26,
	type OfxEffectStateV26,
	type OfxFrozenFallbackV26,
} from '../common/editor/native-ofx-state-v26.ts';
import type { UnifiedExactRenderOpenFxNode, UnifiedExactRenderPlanV14 } from '../common/editor/unified-exact-render-plan.ts';

const ID = /^[A-Za-z0-9][A-Za-z0-9 ._:-]{0,127}$/u;
const MAXIMUM_FRAME_BYTES = 256 * 1024 * 1024;

export interface FramescaperOpenFxFrameV28 {
	readonly width: number;
	readonly height: number;
	readonly pixels: Uint8Array<ArrayBuffer>;
}

export interface FramescaperOpenFxNamedPlaneV28 {
	readonly identity: string;
	readonly rgba: FramescaperOpenFxFrameV28;
}

export type FramescaperOpenFxStandardParametersV28 = Readonly<{
	readonly Transition?: number;
	readonly SourceTime?: Readonly<{ readonly num: number; readonly den: number }>;
}>;

export interface FramescaperOpenFxFrameExecutionRequestV28 {
	readonly plan: UnifiedExactRenderPlanV14;
	readonly instanceId: string;
	readonly context: OfxContext;
	readonly outputOrdinal: number;
	readonly requestedBackend: OfxRenderBackendV1 | 'qualified-preferred';
	readonly inputs: readonly Readonly<{
		readonly name: string;
		readonly sourceRef: string;
		readonly rgba: FramescaperOpenFxFrameV28;
	}>[];
	readonly standardParameters: FramescaperOpenFxStandardParametersV28;
	readonly signal: AbortSignal;
}

export type FramescaperOpenFxFrameExecutionResultV28 = Readonly<
	| {
		readonly mode: 'render';
		readonly rgba: FramescaperOpenFxFrameV28;
		readonly backend: OfxRenderBackendV1;
		readonly retriedOnCpu: boolean;
		readonly reportsDegradation: boolean;
	}
	| {
		readonly mode: 'frozen';
		readonly availability: OfxPluginAvailability;
		readonly reportsDegradation: true;
		readonly frozenFallback: OfxFrozenFallbackV26 | null;
	}
	| {
		readonly mode: 'bypass';
		readonly availability: OfxPluginAvailability;
		readonly reportsDegradation: boolean;
	}
>;

export interface FramescaperOpenFxFrameDispositionV28 {
	readonly instanceId: string;
	readonly context: OfxContext;
	readonly outputOrdinal: number;
	readonly mode: FramescaperOpenFxFrameExecutionResultV28['mode'];
	readonly reportsDegradation: boolean;
	readonly backend: OfxRenderBackendV1 | null;
	readonly retriedOnCpu: boolean;
}

export interface FramescaperOpenFxFrameGraphV28 {
	apply(request: Readonly<{
		readonly context: OfxContext;
		readonly targetId: string;
		readonly outputOrdinal: number;
		readonly primary: FramescaperOpenFxNamedPlaneV28 | null;
		readonly namedPlanes: readonly FramescaperOpenFxNamedPlaneV28[];
		readonly transitionProgress?: number;
		readonly retimerSourceTime?: Readonly<{ readonly num: number; readonly den: number }>;
		readonly requestedBackend?: OfxRenderBackendV1 | 'qualified-preferred';
		readonly signal: AbortSignal;
	}>): Promise<Readonly<{
		readonly frame: FramescaperOpenFxFrameV28;
		readonly dispositions: readonly FramescaperOpenFxFrameDispositionV28[];
		readonly reportsDegradation: boolean;
	}>>;
}

export function createFramescaperOpenFxFrameGraphV28(options: Readonly<{
	readonly plan: UnifiedExactRenderPlanV14;
	readonly assertCurrent: () => void;
	readonly execute: (
		request: FramescaperOpenFxFrameExecutionRequestV28,
	) => PromiseLike<FramescaperOpenFxFrameExecutionResultV28>;
	readonly resolveFrozenFrame?: (
		fallback: OfxFrozenFallbackV26,
		effect: OfxEffectStateV26,
		outputOrdinal: number,
		signal: AbortSignal,
	) => PromiseLike<FramescaperOpenFxFrameV28 | null>;
	readonly allowRepeatedFrames?: boolean;
}>): FramescaperOpenFxFrameGraphV28 {
	const plan = admittedPlan(options.plan);
	if (typeof options.assertCurrent !== 'function' || typeof options.execute !== 'function') {
		throw new TypeError('Selected V28 OpenFX frame execution requires exact authority ports.');
	}
	if (options.resolveFrozenFrame !== undefined && typeof options.resolveFrozenFrame !== 'function') {
		throw new TypeError('Selected V28 OpenFX frozen recovery must be a function.');
	}
	const nodes = plan.nodes.filter((node): node is UnifiedExactRenderOpenFxNode => node.kind === 'openfx');
	const consumed = new Set<string>();
	let active = false;

	async function apply(
		requestValue: Parameters<FramescaperOpenFxFrameGraphV28['apply']>[0],
	) {
		if (active) throw new Error('Selected V28 OpenFX frame execution cannot overlap.');
		active = true;
		try {
			options.assertCurrent();
			const request = checkpoint(requestValue, plan);
			const replayKey = `${request.context}\0${request.targetId}\0${String(request.outputOrdinal)}`;
			if (options.allowRepeatedFrames !== true && consumed.has(replayKey)) {
				throw new Error('Selected V28 OpenFX frame ordinal replay is forbidden.');
			}
			const effects = nodes.filter(({ state }) => state.context === request.context
				&& state.attachment.targetId === request.targetId);
			let output = request.primary?.rgba ?? transparent(plan);
			const dispositions: FramescaperOpenFxFrameDispositionV28[] = [];
			for (const { state } of effects) {
				request.signal.throwIfAborted();
				options.assertCurrent();
				if (!state.enabled) {
					dispositions.push(disposition(
						state, request.outputOrdinal, 'bypass', false, null, false,
					));
					continue;
				}
				const inputs = bindInputs(state, request.namedPlanes, request.primary, output, plan);
				const result = await options.execute(Object.freeze({
					plan, instanceId: state.instanceId, context: state.context,
					outputOrdinal: request.outputOrdinal,
					requestedBackend: request.requestedBackend,
					inputs, standardParameters: standardParameters(state, request),
					signal: request.signal,
				}));
				request.signal.throwIfAborted();
				options.assertCurrent();
				if (result.mode === 'render') {
					output = frame(result.rgba, plan, 'OpenFX rendered frame');
					dispositions.push(disposition(
						state, request.outputOrdinal, result.mode, result.reportsDegradation,
						result.backend, result.retriedOnCpu,
					));
					continue;
				}
				if (result.mode === 'frozen') {
					const fallback = exactFallback(state, result.frozenFallback);
					const recovered = fallback === null ? null : await options.resolveFrozenFrame?.(
						fallback, state, request.outputOrdinal, request.signal,
					);
					if (recovered === null || recovered === undefined) {
						dispositions.push(disposition(
							state, request.outputOrdinal, 'bypass', true, null, false,
						));
						continue;
					}
					output = frame(recovered, plan, 'OpenFX frozen recovery frame');
				}
				dispositions.push(disposition(
					state, request.outputOrdinal, result.mode, result.reportsDegradation, null, false,
				));
			}
			consumed.add(replayKey);
			return Object.freeze({
				frame: cloneFrame(output),
				dispositions: Object.freeze(dispositions),
				reportsDegradation: dispositions.some(({ reportsDegradation }) => reportsDegradation),
			});
		} finally { active = false; }
	}
	return Object.freeze({ apply });
}

function admittedPlan(value: unknown): UnifiedExactRenderPlanV14 {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Selected V28 OpenFX frame execution requires a V14 plan.');
	}
	const plan = value as Partial<UnifiedExactRenderPlanV14>;
	if (plan.version !== 14 || !Array.isArray(plan.nodes)
		|| !plan.output || typeof plan.output !== 'object') {
		throw new TypeError('Selected V28 OpenFX frame execution requires a V14 plan.');
	}
	for (const node of plan.nodes) if (node.kind === 'openfx') {
		assertOfxEffectStateV26(node.state);
	}
	const output = plan.output as UnifiedExactRenderPlanV14['output'];
	positive(output.frameCount, 'OpenFX output frame count');
	positive(output.canvas.width, 'OpenFX canvas width');
	positive(output.canvas.height, 'OpenFX canvas height');
	return value as UnifiedExactRenderPlanV14;
}

function checkpoint(
	value: Parameters<FramescaperOpenFxFrameGraphV28['apply']>[0],
	plan: UnifiedExactRenderPlanV14,
) {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| !['generator', 'filter', 'transition', 'paint', 'retimer', 'general'].includes(value.context)
		|| !ID.test(value.targetId)
		|| !Number.isSafeInteger(value.outputOrdinal) || value.outputOrdinal < 0
		|| value.outputOrdinal >= plan.output.frameCount
		|| !(value.signal instanceof AbortSignal)
		|| (value.requestedBackend !== undefined
			&& !['cpu', 'opengl', 'opencl', 'cuda', 'metal', 'qualified-preferred']
				.includes(value.requestedBackend))) {
		throw new TypeError('Selected V28 OpenFX frame checkpoint is invalid.');
	}
	value.signal.throwIfAborted();
	const primary = value.primary === null ? null : namedPlane(value.primary, plan, 'primary plane');
	if (!Array.isArray(value.namedPlanes) || value.namedPlanes.length > 16) {
		throw new RangeError('Selected V28 OpenFX named input planes are invalid.');
	}
	const namedPlanes = Object.freeze(value.namedPlanes.map((plane, index) => (
		namedPlane(plane, plan, `named plane ${String(index)}`)
	)));
	if (new Set(namedPlanes.map(({ identity }) => identity)).size !== namedPlanes.length) {
		throw new Error('Selected V28 OpenFX named plane identities must be unique.');
	}
	if (value.context === 'transition' && unit(value.transitionProgress, 'Transition') === null) {
		throw new Error('Selected V28 OpenFX Transition requires its exact standard parameter.');
	}
	if (value.context === 'retimer') rational(value.retimerSourceTime, 'SourceTime');
	return Object.freeze({
		context: value.context, targetId: value.targetId, outputOrdinal: value.outputOrdinal,
		primary, namedPlanes, transitionProgress: value.transitionProgress,
		retimerSourceTime: value.retimerSourceTime,
		requestedBackend: value.requestedBackend ?? 'qualified-preferred', signal: value.signal,
	});
}

function namedPlane(value: unknown, plan: UnifiedExactRenderPlanV14, name: string) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} is invalid.`);
	const candidate = value as Partial<FramescaperOpenFxNamedPlaneV28>;
	if (typeof candidate.identity !== 'string' || !ID.test(candidate.identity)) {
		throw new TypeError(`${name} identity is not pathless.`);
	}
	return Object.freeze({ identity: candidate.identity, rgba: frame(candidate.rgba, plan, name) });
}

function bindInputs(
	state: OfxEffectStateV26,
	planes: readonly FramescaperOpenFxNamedPlaneV28[],
	primary: FramescaperOpenFxNamedPlaneV28 | null,
	current: FramescaperOpenFxFrameV28,
	plan: UnifiedExactRenderPlanV14,
) {
	assertContextInputs(state);
	const byIdentity = new Map(planes.map((plane) => [plane.identity, plane.rgba]));
	return Object.freeze(state.inputs.map((input: OfxInputBindingV1) => {
		const value = primary?.identity === input.sourceRef ? current : byIdentity.get(input.sourceRef);
		if (!value) throw new ReferenceError(`OpenFX named input ${input.name} (${input.sourceRef}) has no exact intermediate plane.`);
		return Object.freeze({ name: input.name, sourceRef: input.sourceRef, rgba: frame(value, plan, `OpenFX ${input.name}`) });
	}));
}

function assertContextInputs(state: OfxEffectStateV26): void {
	const names = new Set(state.inputs.map(({ name }) => name));
	const exact = (...expected: string[]) => names.size === expected.length && expected.every((name) => names.has(name));
	if (state.parameters.some(({ name }) => name === 'Transition' || name === 'SourceTime')) {
		throw new Error('OpenFX host-owned standard parameters cannot be persisted.');
	}
	if (state.context === 'filter' && !names.has('Source')) throw new Error('OpenFX Filter requires Source.');
	if (state.context === 'transition' && (!exact('SourceFrom', 'SourceTo')
		|| state.inputs[0]?.sourceRef === state.inputs[1]?.sourceRef)) {
		throw new Error('OpenFX Transition requires distinct SourceFrom and SourceTo inputs.');
	}
	if (state.context === 'paint' && !exact('Source', 'Mask')) {
		throw new Error('OpenFX Paint requires exact Source and Mask inputs.');
	}
	if (state.context === 'retimer' && !exact('Source')) throw new Error('OpenFX Retimer requires Source.');
	if (state.context === 'general' && state.inputs.length < 1) {
		throw new Error('OpenFX General requires explicit named inputs.');
	}
}

function standardParameters(
	state: OfxEffectStateV26,
	request: ReturnType<typeof checkpoint>,
): FramescaperOpenFxStandardParametersV28 {
	if (state.context === 'transition') return Object.freeze({ Transition: unit(request.transitionProgress, 'Transition')! });
	if (state.context === 'retimer') return Object.freeze({ SourceTime: rational(request.retimerSourceTime, 'SourceTime') });
	return Object.freeze({});
}

function exactFallback(
	state: OfxEffectStateV26,
	value: OfxFrozenFallbackV26 | null,
): OfxFrozenFallbackV26 | null {
	if (value === null || state.frozenFallback === null) return null;
	if (JSON.stringify(value) !== JSON.stringify(state.frozenFallback)) {
		throw new Error('OpenFX frozen recovery does not match exact authored fallback authority.');
	}
	return state.frozenFallback;
}

function disposition(
	state: OfxEffectStateV26,
	outputOrdinal: number,
	mode: FramescaperOpenFxFrameExecutionResultV28['mode'],
	reportsDegradation: boolean,
	backend: OfxRenderBackendV1 | null,
	retriedOnCpu: boolean,
): FramescaperOpenFxFrameDispositionV28 {
	return Object.freeze({
		instanceId: state.instanceId, context: state.context, outputOrdinal, mode,
		reportsDegradation, backend, retriedOnCpu,
	});
}

function frame(value: unknown, plan: UnifiedExactRenderPlanV14, name: string): FramescaperOpenFxFrameV28 {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be RGBA.`);
	const candidate = value as Partial<FramescaperOpenFxFrameV28>;
	const width = positive(candidate.width, `${name} width`);
	const height = positive(candidate.height, `${name} height`);
	if (width !== plan.output.canvas.width || height !== plan.output.canvas.height
		|| !(candidate.pixels instanceof Uint8Array)
		|| Object.getPrototypeOf(candidate.pixels) !== Uint8Array.prototype
		|| !(candidate.pixels.buffer instanceof ArrayBuffer)
		|| candidate.pixels.byteLength !== width * height * 4
		|| candidate.pixels.byteLength > MAXIMUM_FRAME_BYTES) {
		throw new RangeError(`${name} geometry is not the exact bounded V14 RGBA canvas.`);
	}
	return cloneFrame(candidate as FramescaperOpenFxFrameV28);
}

function cloneFrame(value: FramescaperOpenFxFrameV28): FramescaperOpenFxFrameV28 {
	return Object.freeze({ width: value.width, height: value.height, pixels: value.pixels.slice() as Uint8Array<ArrayBuffer> });
}

function transparent(plan: UnifiedExactRenderPlanV14): FramescaperOpenFxFrameV28 {
	return Object.freeze({
		width: plan.output.canvas.width,
		height: plan.output.canvas.height,
		pixels: new Uint8Array(plan.output.canvas.width * plan.output.canvas.height * 4),
	});
}

function positive(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > 65_536) {
		throw new RangeError(`${name} must be a bounded positive integer.`);
	}
	return Number(value);
}

function unit(value: unknown, name: string): number | null {
	if (value === undefined) return null;
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
		throw new RangeError(`${name} must be between zero and one.`);
	}
	return value;
}

function rational(value: unknown, name: string): Readonly<{ readonly num: number; readonly den: number }> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} is missing.`);
	const candidate = value as Readonly<{ readonly num?: unknown; readonly den?: unknown }>;
	if (!Number.isSafeInteger(candidate.num) || !Number.isSafeInteger(candidate.den)
		|| Number(candidate.den) < 1) throw new RangeError(`${name} is not an exact rational.`);
	return Object.freeze({ num: Number(candidate.num), den: Number(candidate.den) });
}
