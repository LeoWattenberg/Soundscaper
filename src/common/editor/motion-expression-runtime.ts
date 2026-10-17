/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MotionAsset } from './motion-asset.ts';
import { readPreparedMotionExpressionAudio, type MotionPreparedExpressionAudio } from './motion-expression-audio-capability.ts';
import type { MotionComposition } from './motion-composition.ts';
import { motionLayerProperties, type MotionPropertyAddress } from './motion-project-graph.ts';
import { compileMotionProperty, type MotionPropertyValue, type MotionStatePropertyResolver } from './motion-property-evaluation.ts';
import { normalizeMotionPath, type MotionProperty } from './motion-property.ts';
import { addRationals, divideRationals, multiplyRationals, subtractRationals, type Rational } from './timeline-time.ts';
import { approximateBoundedFraction, publicFraction } from './interpolation-curve-math.ts';
import { MotionExpressionError, type MotionExpressionProgram, type MotionExpressionSpan } from './motion-expression-ast.ts';
import { parseMotionExpression } from './motion-expression-parser.ts';
import { createMotionExpressionBudget, evaluateMotionExpression, type MotionExpressionBudget, type MotionExpressionValue } from './motion-expression-evaluator.ts';
import { evaluateMotionExpressionLoop } from './motion-expression-loop.ts';
import { expressionNumber, expressionVector } from './motion-expression-values.ts';

export interface MotionExpressionQueryOptions { readonly expressionBudget?: MotionExpressionBudget; readonly signal?: AbortSignal; readonly preparedAudio?: MotionPreparedExpressionAudio }
export interface MotionExpressionSession {
	resolver(compositionId: string, layerId: string, aliases?: Readonly<Record<string, string>>): MotionStatePropertyResolver;
	sample(request: Readonly<{ compositionId: string; layerId: string; propertyPath: string; frame: Rational }>): MotionPropertyValue;
}
interface Binding extends MotionPropertyAddress { readonly composition: MotionComposition; readonly layerId: string; readonly startFrame: Rational; readonly index: number }
interface CompiledProgram { readonly program: MotionExpressionProgram | null; readonly error: MotionExpressionError | null }
export class MotionExpressionPropertyError extends MotionExpressionError {
	readonly compositionId: string; readonly layerId: string; readonly propertyPath: string;
	constructor(error: MotionExpressionError, binding: Binding) {
		super(error.diagnostic.code, error.message, error.diagnostic); this.name = 'MotionExpressionPropertyError';
		this.compositionId = binding.composition.id; this.layerId = binding.layerId; this.propertyPath = binding.stablePath;
	}
}

/** A revision owns bounded compiled bindings; every scene query owns an independent bounded value cache. */
export function createMotionExpressionRuntime(compositions: readonly MotionComposition[], identity: Readonly<{ revisionDigest?: string; assets?: readonly MotionAsset[] }> = {}): Readonly<{ createSession(options?: MotionExpressionQueryOptions): MotionExpressionSession }> {
	const assets = new Map((identity.assets ?? []).map((asset) => [asset.id, asset]));
	const compositionMap = new Map(compositions.map((composition) => [composition.id, composition]));
	const registries = new Map<string, ReadonlyMap<string, Binding>>();
	const bases = new WeakMap<MotionProperty, (position: Rational) => MotionPropertyValue>();
	const programs = new WeakMap<MotionProperty, CompiledProgram>();
	let registryBytes = 0, registryEntries = 0, sourceBytes = 0, programNodes = 0, programCount = 0;
	function registry(id: string): ReadonlyMap<string, Binding> {
		const existing = registries.get(id); if (existing) return existing;
		const composition = compositionMap.get(id); if (!composition) throw new ReferenceError(`Expression composition ${id} is missing.`);
		const entries = new Map<string, Binding>(); let bytes = 0, count = 0;
		for (const [index, owner] of [...composition.layers, ...composition.audio].entries()) {
			const properties = 'kind' in owner ? motionLayerProperties(owner) : [{ path: 'gain', stablePath: 'gain', property: owner.gain }];
			for (const property of properties) {
				bytes += 256 + 4 * (owner.id.length + property.path.length + property.stablePath.length); count++;
				if (registryBytes + bytes > 32 * 1024 * 1024 || registryEntries + count > 131072) throw new MotionExpressionError('budget', 'Expression property binding budget exceeded.', { start: 0, end: 0 });
				const binding: Binding = { ...property, composition, layerId: owner.id, startFrame: owner.startFrame, index: index + 1 };
				entries.set(`${owner.id}/${property.path}`, binding); entries.set(`${owner.id}/${property.stablePath}`, binding);
			}
		}
		registryBytes += bytes; registryEntries += count; registries.set(id, entries); return entries;
	}
	function programFor(binding: Binding): MotionExpressionProgram {
		const property = binding.property; let compiled = programs.get(property);
		if (!compiled) {
			const source = property.expression!.source;
			if (sourceBytes + source.length * 2 > 1024 * 1024 || programCount >= 4096) throw new MotionExpressionError('budget', 'Expression compiled source budget exceeded.', { start: 0, end: source.length });
			try {
				const program = parseMotionExpression(source);
				if (programNodes + program.nodeCount > 65536) throw new MotionExpressionError('budget', 'Expression compiled AST budget exceeded.', program.ast);
				programNodes += program.nodeCount; compiled = { program, error: null };
			} catch (error) { if (!(error instanceof MotionExpressionError)) throw error; compiled = { program: null, error }; }
			sourceBytes += source.length * 2; programCount++; programs.set(property, compiled);
		}
		if (compiled.error) throw compiled.error; return compiled.program!;
	}
	function baseFor(property: MotionProperty): (position: Rational) => MotionPropertyValue {
		let base = bases.get(property); if (!base) { base = compileMotionProperty({ ...property, expression: null }); bases.set(property, base); } return base;
	}
	return Object.freeze({ createSession(options: MotionExpressionQueryOptions = {}): MotionExpressionSession {
		const budget = options.expressionBudget ?? createMotionExpressionBudget({ maximumOperations: 65536, ...(options.signal ? { signal: options.signal } : {}) });
		const cache = new Map<string, { readonly value: MotionPropertyValue; readonly bytes: number }>(); let cacheBytes = 0;
		const active = new Set<string>();
		const check = (operations: number, span: MotionExpressionSpan): void => { options.signal?.throwIfAborted(); budget.consume(operations, span); };
		function sampleBase(binding: Binding, position: Rational, span: MotionExpressionSpan): MotionPropertyValue {
			const property = binding.property;
			const work = property.kind === 'path' ? property.keyframes.length + property.value.vertices.length * 6 : property.kind === 'scalar' ? property.curve?.anchors.length ?? 1 : property.curves.reduce((sum, curve) => sum + (curve?.anchors.length ?? 1), 0);
			check(work, span); return baseFor(property)(position);
		}
		function evaluate(binding: Binding, globalFrame: Rational): MotionPropertyValue {
			const expression = binding.property.expression; const span = { start: 0, end: expression?.source.length ?? 0 };
			try {
				check(1, span); const key = `${binding.composition.id}/${binding.layerId}/${binding.stablePath}/${globalFrame.num}:${globalFrame.den}`;
				const cached = cache.get(key); if (cached) return cached.value;
				if (active.size >= 64 || active.has(key)) throw new MotionExpressionError('budget', 'Expression dependency cycle or depth budget exceeded.', span);
				active.add(key);
				try {
					const position = subtractRationals(globalFrame, binding.startFrame); const base = (at: Rational) => sampleBase(binding, at, span); const value = base(position);
					const program = expression?.enabled ? programFor(binding) : null;
					const seconds = (frame: Rational) => numeric(divideRationals(frame, binding.composition.frameRate));
					const frameAt = (time: number) => multiplyRationals(expressionTime(time, span), binding.composition.frameRate);
					const result = program ? outputValue(evaluateMotionExpression(program, {
						time: seconds(globalFrame), localTime: seconds(position), frame: numeric(position), frameRate: numeric(binding.composition.frameRate), value, index: binding.index,
						seed: `${binding.composition.id}/${binding.layerId}/${binding.stablePath}`,
						valueAtTime: (time) => base(subtractRationals(frameAt(time), binding.startFrame)),
						reference(id, time) {
							check(1, program.ast); const reference = expression!.references.find((item) => item.id === id);
							const target = reference && registry(binding.composition.id).get(`${reference.layerId}/${reference.propertyPath}`);
							if (!target) throw new MotionExpressionError('reference', `Expression reference ${id} has no bound property.`, program.ast);
							return evaluate(target, time === undefined ? globalFrame : frameAt(time));
						},
						audioAmplitude(request) {
							if (!options.preparedAudio) throw new MotionExpressionError('unavailable', 'Prepared native PCM amplitude is unavailable for this query.', program.ast);
							const asset = assets.get(request.assetId);
							if (!asset || (asset.kind !== 'audio' && !(asset.kind === 'footage' && asset.hasAudio))) throw new MotionExpressionError('reference', 'Audio amplitude source is outside this scene asset closure.', program.ast);
							return readPreparedMotionExpressionAudio(options.preparedAudio, identity.revisionDigest, asset, request);
						},
						loop: (direction, mode, count) => evaluateMotionExpressionLoop(binding.property, base, position, direction, mode, count, budget, program.ast),
					}, budget), binding.property, program.ast) : value;
					check(0, span); const bytes = 128 + key.length * 2 + (typeof result === 'number' ? 8 : Array.isArray(result) ? result.length * 8 : (result as { vertices: readonly unknown[] }).vertices.length * 96);
					if (bytes <= 1024 * 1024) {
						while (cacheBytes + bytes > 1024 * 1024 || cache.size >= 4096) { const oldest = cache.keys().next().value!; cacheBytes -= cache.get(oldest)!.bytes; cache.delete(oldest); }
						cache.set(key, { value: result, bytes }); cacheBytes += bytes;
					}
					return result;
				} finally { active.delete(key); }
			} catch (error) { if (error instanceof MotionExpressionError && !(error instanceof MotionExpressionPropertyError)) throw new MotionExpressionPropertyError(error, binding); throw error; }
		}
		return Object.freeze({ sample(request: Readonly<{ compositionId: string; layerId: string; propertyPath: string; frame: Rational }>): MotionPropertyValue {
			const binding = registry(request.compositionId).get(`${request.layerId}/${request.propertyPath}`);
			if (!binding) throw new ReferenceError('The sampled expression property is missing.');
			return evaluate(binding, request.frame);
		}, resolver(compositionId: string, layerId: string, aliases: Readonly<Record<string, string>> = {}): MotionStatePropertyResolver {
			return (_property, path, position) => {
				const binding = registry(compositionId).get(`${layerId}/${aliases[path] ?? path}`);
				if (!binding) throw new ReferenceError(`Expression property ${compositionId}/${layerId}/${path} is missing.`);
				return evaluate(binding, addRationals(position, binding.startFrame));
			};
		} });
	} });
}
function numeric(value: Rational): number { return value.num / value.den; }
function expressionTime(value: number, span: MotionExpressionSpan): Rational {
	const magnitude = approximateBoundedFraction(Math.abs(expressionNumber(value, span)));
	if (!magnitude) throw new MotionExpressionError('type', 'Expression sample time exceeds its exact coordinate domain.', span);
	const rational = publicFraction(magnitude); return value < 0 ? { num: -rational.num, den: rational.den } : rational;
}
function outputValue(value: MotionExpressionValue, property: MotionProperty, span: MotionExpressionSpan): MotionPropertyValue {
	if (property.kind === 'scalar') return expressionNumber(value, span);
	if (property.kind === 'path') {
		if (!value || typeof value !== 'object' || Array.isArray(value)) throw new MotionExpressionError('type', 'Expression path output requires an authored path.', span);
		const path = normalizeMotionPath(value);
		if (path.closed !== property.value.closed || path.vertices.length !== property.value.vertices.length) throw new MotionExpressionError('type', 'Expression path output must retain the property topology.', span); return path;
	}
	const vector = expressionVector(value, span); if (vector.length !== property.value.length) throw new MotionExpressionError('type', 'Expression output must match the property vector dimensions.', span);
	return Object.freeze(vector.map((channel) => property.kind === 'color' ? Math.max(0, Math.min(1, channel)) : channel)) as MotionPropertyValue;
}
