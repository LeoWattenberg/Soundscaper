/* SPDX-License-Identifier: AGPL-3.0-only */

import { approximateBoundedFraction, publicFraction } from './interpolation-curve-math.ts';
import { addRationals, compareRationals, divideRationals, multiplyRationals, normalizeRational, subtractRationals, type Rational, type RationalInput } from './timeline-time.ts';
import type { MotionAsset } from './motion-asset.ts';
import type { MotionAudioPlacement, MotionComposition, MotionLayer } from './motion-composition.ts';
import { compileMotionState, type EvaluatedMotionState, type MotionStatePropertyResolver } from './motion-property-evaluation.ts';
import { motionTransformMatrix, multiplyMotionMatrices, type MotionMatrix4 } from './motion-transform.ts';
import { createMotionExpressionRuntime, type MotionExpressionQueryOptions, type MotionExpressionSession } from './motion-expression-runtime.ts';
import { createMotionSceneWorkBudget, type MotionSceneWorkBudget } from './motion-scene-work-budget.ts';
import { freezeMotionValue } from './motion-values.ts';

export type MotionOperationKind = 'background' | 'source' | 'shape-operator' | 'text-animator' | 'mask' | 'effect' | 'transform' | 'matte' | 'opacity' | 'composite' | 'precomposition' | 'camera' | 'light';
export interface MotionFrameOperation { readonly id: string; readonly kind: MotionOperationKind; readonly sourceId: string }
export interface MotionEvaluatedLayer {
	readonly occurrenceId: string; readonly state: EvaluatedMotionState<MotionLayer>; readonly localFrame: Rational;
	readonly sourceTime: Rational; readonly sourceAvailable: boolean; readonly worldMatrix: MotionMatrix4;
	readonly precomposition: MotionCompositionFrame | null; readonly operations: readonly MotionFrameOperation[];
}
export interface MotionEvaluatedAudio {
	readonly occurrenceId: string; readonly assetId: string; readonly sourceTime: Rational;
	readonly gain: number; readonly playbackRate: Rational | null;
}
export interface MotionCompositionFrame {
	readonly compositionId: string; readonly time: Rational; readonly frame: Rational; readonly samplePosition: Rational;
	readonly width: number; readonly height: number; readonly background: MotionComposition['background']; readonly color: MotionComposition['color'];
	readonly layers: readonly MotionEvaluatedLayer[]; readonly audio: readonly MotionEvaluatedAudio[];
	readonly requiredOperationIds: readonly string[]; readonly depthOfFieldSamples?: number;
}
export interface MotionFrameRequest { readonly compositionId: string; readonly time: RationalInput }
export interface MotionSceneQueryOptions extends MotionExpressionQueryOptions { readonly sceneWork?: MotionSceneWorkBudget }
export interface MotionSceneEvaluator { evaluate(request: MotionFrameRequest, options?: MotionSceneQueryOptions): MotionCompositionFrame; evaluateAudio(request: MotionFrameRequest, maximumOccurrences?: number, options?: MotionSceneQueryOptions): readonly MotionEvaluatedAudio[] }
interface AudioTiming { readonly sourceStart: Rational; readonly timeScale: Rational; readonly timeRemap: number | null; readonly gain: number | null }
interface PreparedComposition {
	readonly composition: MotionComposition;
	readonly layers: ReadonlyMap<string, { readonly layer: MotionLayer; readonly evaluate: (position: Rational, resolver?: MotionStatePropertyResolver) => EvaluatedMotionState<MotionLayer> }>;
	readonly audioLayers: readonly { readonly layer: Extract<MotionLayer, { kind: 'precomp' | 'footage' }>; readonly evaluate: (position: Rational, resolver?: MotionStatePropertyResolver) => AudioTiming }[];
	readonly audio: readonly { readonly placement: MotionAudioPlacement; readonly evaluate: (position: Rational, resolver?: MotionStatePropertyResolver) => EvaluatedMotionState<MotionAudioPlacement> }[];
}

/** Compile already-validated immutable intent supplied by a product's project boundary. */
export function createMotionSceneEvaluator(input: Readonly<{ compositions: readonly MotionComposition[]; assets: readonly MotionAsset[]; sampleRate: number }>, options: Readonly<{ revisionDigest?: string }> = {}): MotionSceneEvaluator {
	const compositions = new Map<string, PreparedComposition>(input.compositions.map((composition) => [composition.id, {
		composition, layers: new Map(composition.layers.map((layer) => [layer.id, { layer, evaluate: compileMotionState(layer) }])),
		audioLayers: composition.layers.flatMap((layer) => layer.kind === 'precomp' || layer.kind === 'footage'
			? [{ layer, evaluate: compileMotionState({ sourceStart: layer.sourceStart, timeScale: layer.timeScale, timeRemap: layer.timeRemap, gain: layer.kind === 'footage' ? layer.audioGain : null }) }] : []),
		audio: composition.audio.map((placement) => ({ placement, evaluate: compileMotionState(placement) })),
	}]));
	const assets = new Map(input.assets.map((asset) => [asset.id, asset]));
	const sampleRate = input.sampleRate; const expressions = createMotionExpressionRuntime(input.compositions, { ...options, assets: input.assets });
	return Object.freeze({ evaluate(request: MotionFrameRequest, options?: MotionSceneQueryOptions): MotionCompositionFrame {
		options?.signal?.throwIfAborted();
		const time = normalizeRational(request.time, { maximumDenominator: Number.MAX_SAFE_INTEGER });
		return evaluateComposition(request.compositionId, time, request.compositionId, { remaining: 16384, work: options?.sceneWork ?? createMotionSceneWorkBudget(65_536, options?.signal) }, 0, expressions.createSession(options));
	}, evaluateAudio(request: MotionFrameRequest, maximumOccurrences = 16384, options?: MotionSceneQueryOptions): readonly MotionEvaluatedAudio[] {
		if (!Number.isSafeInteger(maximumOccurrences) || maximumOccurrences < 1 || maximumOccurrences > 16384) throw new RangeError('Motion audio occurrence budget is invalid.');
		const time = normalizeRational(request.time, { maximumDenominator: Number.MAX_SAFE_INTEGER });
		options?.signal?.throwIfAborted(); const output: MotionEvaluatedAudio[] = [];
		evaluateAudioComposition(request.compositionId, time, request.compositionId, { remaining: maximumOccurrences, work: options?.sceneWork ?? createMotionSceneWorkBudget(65_536, options?.signal) }, 0, { num: 1, den: 1 }, output, expressions.createSession(options));
		return Object.freeze(output);
	} });

	function evaluateAudioComposition(id: string, time: Rational, path: string, budget: { remaining: number; work: MotionSceneWorkBudget }, depth: number, rate: Rational | null, output: MotionEvaluatedAudio[], session: MotionExpressionSession): void {
		budget.work.consume();
		if (depth > 32 || --budget.remaining < 0) throw new RangeError('Motion audio evaluation exceeds its occurrence/depth budget.');
		const prepared = compositions.get(id); if (!prepared) throw new ReferenceError(`Motion composition ${id} is missing.`);
		const composition = prepared.composition; const frame = multiplyRationals(time, composition.frameRate);
		if (frame.num < 0 || compareRationals(frame, composition.durationFrames) >= 0) return;
		for (const { layer, evaluate } of prepared.audioLayers) {
			budget.work.consume();
			if (--budget.remaining < 0) throw new RangeError('Motion audio evaluation exceeds its occurrence budget.');
			if (!active(layer, frame)) continue;
			const localFrame = subtractRationals(frame, layer.startFrame); const state = evaluate(localFrame, session.resolver(id, layer.id, { gain: 'audioGain' }));
			const sourceTime = mapSourceTime(state, localFrame, composition.frameRate); const occurrenceId = `${path}/${layer.id}`;
			const playbackRate = rate !== null && state.timeRemap === null ? multiplyRationals(rate, state.timeScale) : null;
			if (layer.kind === 'precomp') evaluateAudioComposition(layer.compositionId, sourceTime, occurrenceId, budget, depth + 1, playbackRate, output, session);
			else {
				const asset = assets.get(layer.assetId);
				if (layer.audioEnabled && asset?.kind === 'footage' && asset.hasAudio && mediaTimeActive(asset, sourceTime)) output.push({ occurrenceId, assetId: layer.assetId, sourceTime, gain: state.gain!, playbackRate });
			}
		}
		for (const { placement, evaluate } of prepared.audio) {
			budget.work.consume();
			if (--budget.remaining < 0) throw new RangeError('Motion audio evaluation exceeds its occurrence budget.');
			if (!active(placement, frame)) continue;
			const localFrame = subtractRationals(frame, placement.startFrame); const state = evaluate(localFrame, session.resolver(id, placement.id));
			const sourceTime = mapSourceTime({ ...state, timeRemap: null }, localFrame, composition.frameRate);
			if (mediaTimeActive(assets.get(placement.assetId), sourceTime)) output.push({ occurrenceId: `${path}/${placement.id}`, assetId: placement.assetId, sourceTime, gain: state.gain,
				playbackRate: rate === null ? null : multiplyRationals(rate, state.timeScale) });
		}
	}

	function evaluateComposition(id: string, time: Rational, path: string, budget: { remaining: number; work: MotionSceneWorkBudget }, depth: number, session: MotionExpressionSession): MotionCompositionFrame {
		budget.work.consume();
		if (depth > 32 || --budget.remaining < 0) throw new RangeError('Motion scene evaluation exceeds its occurrence/depth budget.');
		const prepared = compositions.get(id);
		if (!prepared) throw new ReferenceError(`Motion composition ${id} is missing.`);
		const composition = prepared.composition;
		const frame = multiplyRationals(time, composition.frameRate);
		const layers: MotionEvaluatedLayer[] = [];
		const audio: MotionEvaluatedAudio[] = [];
		const requiredOperationIds = [`${path}/background`];
		const states = new Map<string, EvaluatedMotionState<MotionLayer>>();
		const matrices = new Map<string, MotionMatrix4>();
		const stateFor = (layerId: string): EvaluatedMotionState<MotionLayer> => {
			const cached = states.get(layerId);
			if (cached) return cached;
			budget.work.consume();
			const item = prepared.layers.get(layerId);
			if (!item) throw new ReferenceError(`Missing motion parent ${layerId}.`);
			const state = item.evaluate(subtractRationals(frame, item.layer.startFrame), session.resolver(id, item.layer.id));
			states.set(layerId, state);
			return state;
		};
		const matrixFor = (layerId: string, parentDepth = 0): MotionMatrix4 => {
			if (parentDepth > 128) throw new RangeError('Motion parent evaluation exceeds its depth budget.');
			const cached = matrices.get(layerId);
			if (cached) return cached;
			budget.work.consume();
			const state = stateFor(layerId);
			const local = motionTransformMatrix(state.transform);
			const matrix = state.parentId === null ? local : multiplyMotionMatrices(matrixFor(state.parentId, parentDepth + 1), local);
			matrices.set(layerId, matrix);
			return matrix;
		};
		const inRange = frame.num >= 0 && compareRationals(frame, composition.durationFrames) < 0;
		if (inRange) {
			for (const { layer } of prepared.layers.values()) {
				budget.work.consume();
				if (!active(layer, frame)) continue;
				if (--budget.remaining < 0) throw new RangeError('Motion scene evaluation exceeds its occurrence budget.');
				const state = stateFor(layer.id);
				const localFrame = subtractRationals(frame, layer.startFrame);
				const sourceTime = mapSourceTime(state, localFrame, composition.frameRate);
				const occurrenceId = `${path}/${layer.id}`;
				const precomposition = state.kind === 'precomp' ? evaluateComposition(state.compositionId, sourceTime, occurrenceId, budget, depth + 1, session) : null;
				const operations = layerOperations(state, occurrenceId);
				const sourceAvailable = state.kind === 'footage' ? mediaTimeActive(assets.get(state.assetId), sourceTime)
					: precomposition === null || (precomposition.frame.num >= 0 && compareRationals(precomposition.frame, compositions.get(precomposition.compositionId)!.composition.durationFrames) < 0);
				layers.push({ occurrenceId, state, localFrame, sourceTime, sourceAvailable, worldMatrix: matrixFor(layer.id), precomposition, operations });
				requiredOperationIds.push(...operations.map((operation) => operation.id), ...(precomposition?.requiredOperationIds ?? []));
				const asset = state.kind === 'footage' ? assets.get(state.assetId) : null;
				if (state.kind === 'footage' && state.audioEnabled && sourceAvailable && asset?.kind === 'footage' && asset.hasAudio) {
					audio.push({ occurrenceId, assetId: state.assetId, sourceTime, gain: state.audioGain, playbackRate: state.timeRemap === null ? state.timeScale : null });
				}
			}
			for (const { placement, evaluate } of prepared.audio) {
				budget.work.consume();
				if (!active(placement, frame)) continue;
				const localFrame = subtractRationals(frame, placement.startFrame);
				const state = evaluate(localFrame, session.resolver(id, placement.id));
				const sourceTime = mapSourceTime({ ...state, timeRemap: null }, localFrame, composition.frameRate);
				if (mediaTimeActive(assets.get(placement.assetId), sourceTime)) audio.push({ occurrenceId: `${path}/${placement.id}`,
					assetId: placement.assetId, sourceTime, gain: state.gain, playbackRate: state.timeScale });
			}
		}
		return freezeMotionValue({ compositionId: id, time, frame, samplePosition: multiplyRationals(time, sampleRate), width: composition.width, height: composition.height,
			background: inRange ? composition.background : [0, 0, 0, 0] as const, color: composition.color, layers, audio, requiredOperationIds, ...(composition.depthOfFieldSamples === undefined ? {} : { depthOfFieldSamples: composition.depthOfFieldSamples }) });
	}
}

function active(value: Readonly<{ enabled: boolean; inFrame: Rational; outFrame: Rational }>, frame: Rational): boolean {
	return value.enabled && compareRationals(frame, value.inFrame) >= 0 && compareRationals(frame, value.outFrame) < 0;
}
function mapSourceTime(state: Readonly<{ sourceStart: Rational; timeScale: Rational; timeRemap: number | null }>, localFrame: Rational, rate: Rational): Rational {
	if (state.timeRemap === null) return addRationals(state.sourceStart, multiplyRationals(divideRationals(localFrame, rate), state.timeScale));
	// Nonlinear scalar solvers yield numbers: use the shared nearest bounded-rational policy at this boundary only.
	const magnitude = approximateBoundedFraction(Math.abs(state.timeRemap));
	if (magnitude === null) throw new RangeError('Motion time remapping exceeds the exact coordinate domain.');
	const rational = publicFraction(magnitude);
	return state.timeRemap < 0 ? { num: -rational.num, den: rational.den } : rational;
}
function mediaTimeActive(asset: MotionAsset | undefined, time: Rational): boolean {
	return Boolean(asset && (asset.kind === 'audio' || asset.kind === 'footage') && time.num >= 0 && compareRationals(time, asset.duration) < 0);
}

/** Source -> masks -> effects -> transform -> matte -> opacity -> composition. */
function layerOperations(state: EvaluatedMotionState<MotionLayer>, path: string): readonly MotionFrameOperation[] {
	const operations: MotionFrameOperation[] = [];
	const add = (kind: MotionOperationKind, sourceId = state.id): void => { operations.push({ id: `${path}/${kind}/${sourceId}`, kind, sourceId }); };
	if (state.kind === 'null') { add('transform'); return operations; }
	if (state.kind === 'camera' || state.kind === 'light') { add('transform'); add(state.kind); return operations; }
	add(state.kind === 'precomp' ? 'precomposition' : 'source');
	if (state.kind === 'shapes') for (const operator of state.operators ?? []) if (operator.enabled) add('shape-operator', operator.id);
	if (state.kind === 'text') for (const animator of state.document.animators ?? []) if (animator.enabled) add('text-animator', animator.id);
	for (const mask of state.masks) add('mask', mask.id);
	for (const effect of state.effects) if (effect.enabled) add('effect', effect.id);
	add('transform');
	if (state.matte !== null) add('matte', state.matte.layerId);
	add('opacity'); add('composite');
	return operations;
}

/** Consumers must demonstrate complete consumption; duplicate or invented operations also fail. */
export function assertMotionFrameConsumed(frame: MotionCompositionFrame, consumedIds: readonly string[]): void {
	const required = new Set(frame.requiredOperationIds);
	const consumed = new Set(consumedIds);
	if (consumed.size !== consumedIds.length) throw new RangeError('Motion render contains duplicate consumed operations.');
	for (const id of consumed) if (!required.has(id)) throw new RangeError(`Motion renderer consumed unrequested operation ${id}.`);
	const omitted = [...required].filter((id) => !consumed.has(id));
	if (omitted.length > 0) throw new Error(`Motion renderer omitted operations: ${omitted.join(', ')}.`);
}
