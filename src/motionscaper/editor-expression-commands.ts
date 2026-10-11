/* SPDX-License-Identifier: AGPL-3.0-only */
import { motionLayerProperties } from '../common/editor/motion-project-graph.ts';
import { motionExpressionReference } from '../common/editor/motion-expression-links.ts';
import { createMotionExpressionRuntime } from '../common/editor/motion-expression-runtime.ts';
import { createMotionExpressionBudget } from '../common/editor/motion-expression-evaluator.ts';
import { replaceMotionLayerProperty } from '../common/editor/motion-layer-links.ts';
import { normalizeMotionProperty, motionPropertyOfKind, type MotionExpression, type MotionProperty } from '../common/editor/motion-property.ts';
import type { MotionPropertyValue } from '../common/editor/motion-property-evaluation.ts';
import { addRationals, compareRationals, divideRationals, multiplyRationals, subtractRationals, type Rational } from '../common/editor/timeline-time.ts';
import { freezeMotionValue, motionId, motionRational } from '../common/editor/motion-values.ts';
import { normalizeMotionscaperProject } from '../common/editor/motion-project-validation.ts';
import { createMotionscaperRevision } from '../common/editor/motion-project-revision.ts';
import { applyMotionscaperCommands, type MotionscaperProjectCommand } from './editor-project-commands.ts';

interface Address { readonly project: unknown; readonly compositionId: string; readonly layerId: string; readonly propertyPath: string }
function resolve(options: Address) {
	const project = normalizeMotionscaperProject(options.project); const composition = project.compositions.find(({ id }) => id === motionId(options.compositionId));
	if (!composition) throw new ReferenceError('The expression composition is missing.');
	const owner = [...composition.layers, ...composition.audio].find(({ id }) => id === motionId(options.layerId)); if (!owner) throw new ReferenceError('The expression layer or audio placement is missing.');
	const entry = motionLayerProperties(owner).find(({ path, stablePath }) => path === options.propertyPath || stablePath === options.propertyPath); if (!entry) throw new ReferenceError('The expression property is missing.');
	return { project, composition, owner, entry };
}
function commandsFor(target: ReturnType<typeof resolve>, property: MotionProperty): readonly MotionscaperProjectCommand[] {
	const { project, composition, owner, entry } = target;
	const commands: readonly MotionscaperProjectCommand[] = 'kind' in owner
		? [{ type: 'layer/replace', compositionId: composition.id, layer: replaceMotionLayerProperty(owner, entry.path, property) }]
		: [{ type: 'composition/replace', composition: { ...composition, audio: composition.audio.map((placement) => placement.id === owner.id ? { ...placement, gain: motionPropertyOfKind(property, 'scalar') } : placement) } }];
	applyMotionscaperCommands(project, commands); return freezeMotionValue(commands);
}

/** Syntax is intentionally not a custody gate. Stable reference binding and typed property intent are. */
export function createMotionscaperExpressionCommands(options: Address & Readonly<{ expression: MotionExpression | null }>): readonly MotionscaperProjectCommand[] {
	const target = resolve(options); const property = normalizeMotionProperty({ ...target.entry.property, expression: options.expression });
	const expression = property.expression; if (!expression) return commandsFor(target, property);
	const references = expression.references.map((reference) => {
		const owner = [...target.composition.layers, ...target.composition.audio].find(({ id }) => id === reference.layerId);
		if (!owner) throw new ReferenceError(`Expression reference ${reference.id} has a missing layer.`);
		return motionExpressionReference(owner, reference.id, reference.propertyPath);
	});
	return commandsFor(target, { ...property, expression: { ...expression, references } });
}

export interface MotionscaperExpressionBake {
	readonly commands: readonly MotionscaperProjectCommand[]; readonly sourceRevisionDigest: string; readonly sampleCount: number;
	readonly startFrame: Rational; readonly endFrame: Rational; readonly stepFrames: Rational;
}
/** Samples [startFrame,endFrame) in containing-composition frames, replacing curve authority with linear samples. */
export function bakeMotionscaperExpression(options: Address & Readonly<{ startFrame: Rational; endFrame: Rational; stepFrames: Rational; signal?: AbortSignal }>): MotionscaperExpressionBake {
	options.signal?.throwIfAborted(); const target = resolve(options); const { property } = target.entry;
	if (!property.expression?.enabled) throw new RangeError('Enable the motion expression before baking it.');
	const start = motionRational(options.startFrame, 'bake start frame'), end = motionRational(options.endFrame, 'bake end frame'), step = motionRational(options.stepFrames, 'bake frame step', true);
	if (start.num < 0 || compareRationals(start, end) >= 0 || compareRationals(end, target.composition.durationFrames) > 0) throw new RangeError('Expression bake range must be inside its composition.');
	if (compareRationals(start, target.owner.startFrame) < 0) throw new RangeError('Start baking at or after the layer start so local keys remain non-negative.');
	const ratio = divideRationals(subtractRationals(end, start), step); const countBig = (BigInt(ratio.num) + BigInt(ratio.den) - 1n) / BigInt(ratio.den);
	if (countBig > 4096n) throw new RangeError('Expression bake exceeds its 4096-key budget.'); const sampleCount = Number(countBig);
	const revision = createMotionscaperRevision(target.project); const runtime = createMotionExpressionRuntime(target.project.compositions);
	const expressionBudget = createMotionExpressionBudget({ maximumOperations: 1_000_000, ...(options.signal ? { signal: options.signal } : {}) });
	const sampleBytes = 128 + (property.kind === 'path' ? property.value.vertices.length * 96 : property.kind === 'scalar' ? 8 : property.value.length * 8);
	if (sampleBytes * sampleCount > 16 * 1024 * 1024) throw new RangeError('Expression bake exceeds its retained sample memory budget.');
	const samples: { position: Rational; value: MotionPropertyValue }[] = [];
	for (let index = 0; index < sampleCount; index++) {
		options.signal?.throwIfAborted(); const frame = addRationals(start, multiplyRationals(step, index));
		const value = runtime.createSession({ expressionBudget, ...(options.signal ? { signal: options.signal } : {}) }).sample({ compositionId: target.composition.id, layerId: target.owner.id, propertyPath: target.entry.stablePath, frame });
		samples.push({ position: subtractRationals(frame, target.owner.startFrame), value });
	}
	const disabled = { ...property.expression, enabled: false }; const segments = samples.slice(1).map(() => ({ kind: 'linear' as const }));
	const curve = (channel: number) => ({ anchors: samples.map(({ position, value }) => ({ position, value: typeof value === 'number' ? value : (value as readonly number[])[channel]! })), segments });
	const baked = normalizeMotionProperty(property.kind === 'path' ? { ...property, keyframes: samples, segments: segments.map(({ kind }) => kind), expression: disabled }
		: property.kind === 'scalar' ? { ...property, curve: curve(0), expression: disabled } : { ...property, curves: property.value.map((_, channel) => curve(channel)), expression: disabled });
	return freezeMotionValue({ commands: commandsFor(target, baked), sourceRevisionDigest: revision.digest, sampleCount, startFrame: start, endFrame: end, stepFrames: step });
}
