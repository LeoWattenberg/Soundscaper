/* SPDX-License-Identifier: AGPL-3.0-only */
import type { CompiledInterpolationCurve, InterpolationShape } from './interpolation-curve.ts';
import type { MotionAeEase, MotionAeKey, MotionAeProperty } from './motion-ae-exchange-types.ts';
import type { MotionScalarProperty, MotionVector3Property } from './motion-property.ts';
import { compareRationals, type Rational } from './timeline-time.ts';
import { translateMotionAeScalarExpression, type MotionAeExpressionReview } from './motion-ae-expression-conversion.ts';

type Numeric = Extract<MotionAeProperty, { kind: 'numeric' }>;
export interface MotionAeExportNumeric {
	readonly property: Numeric; readonly unsupported: string | null;
	readonly expressionMessage?: string;
}
const valueOf = (value: Rational) => value.num / value.den;
const fallbackEase = (): MotionAeEase => ({ speed: 0, influence: 100 / 3 });
function interpolation(shape: InterpolationShape | undefined): 'hold' | 'linear' | 'bezier' {
	return !shape ? 'linear' : shape.kind === 'eased' || shape.kind === 'bezier' ? 'bezier' : shape.kind;
}
function ease(curve: CompiledInterpolationCurve | null, segment: number, incoming: boolean, factor: number, rate: number): MotionAeEase {
	const shape = curve?.segments[segment]; if (!curve || !shape || shape.kind !== 'bezier') return fallbackEase();
	const start = curve.anchors[segment]!, end = curve.anchors[segment + 1]!, control = incoming ? shape.control2 : shape.control1;
	const span = valueOf(end.position) - valueOf(start.position);
	const delta = incoming ? valueOf(end.position) - valueOf(control.position) : valueOf(control.position) - valueOf(start.position);
	const influence = delta / span * 100;
	const speed = (incoming ? end.value - control.value : control.value - start.value) * factor * rate / delta;
	if (!Number.isFinite(speed) || Math.abs(speed) > 1e12 || influence < 0.1 || influence > 100) throw new RangeError('This Bezier handle cannot be represented by AE temporal ease without changing its curve.');
	return { speed, influence };
}
/** Strict structural mapping only; installed AE interpolation/reference qualification is separate. */
export function exportMotionAeNumeric(source: MotionScalarProperty | MotionVector3Property, options: Readonly<{
	matchName: string; name: string; axes: readonly number[]; scale: number; spatial: boolean; rate: number; startFrame: Rational;
} & MotionAeExpressionReview>): MotionAeExportNumeric {
	const values = source.kind === 'scalar' ? [source.value] : source.value, sourceCurves = source.kind === 'scalar' ? [source.curve] : source.curves;
	const curves = options.axes.map(axis => sourceCurves[axis]!), base = options.axes.map(axis => values[axis]! * options.scale);
	const property: Numeric = { kind: 'numeric', matchName: options.matchName, name: options.name, value: base, spatial: options.spatial, keys: [],
		expression: source.expression ? { source: source.expression.source, enabled: source.expression.enabled, disposition: 'unsupported' } : null };
	const active = curves.filter((curve): curve is CompiledInterpolationCurve => curve !== null), first = active[0];
	const finish = (property: Numeric, unsupported: string | null): MotionAeExportNumeric => {
		if (options.translateScalarExpressions !== true || !source.expression?.enabled) return { property, unsupported };
		if (unsupported || source.kind !== 'scalar' || options.axes.length !== 1 || options.axes[0] !== 0) return { property, unsupported, expressionMessage: 'This expression requires unchanged scalar keys and dimensions. Sample the property or render the complete composition; original source remains in original.mscape.' };
		const converted = translateMotionAeScalarExpression(source.expression.source, { direction: 'to-after-effects', scale: options.scale });
		return { property: converted.source ? { ...property, expression: { source: converted.source, enabled: true, disposition: 'translated' } } : property, unsupported, expressionMessage: converted.message };
	};
	if (!first) return finish(property, null);
	const unsupported = (message: string): MotionAeExportNumeric => finish(property, message);
	if (active.some(curve => curve.anchors.length !== first.anchors.length || curve.anchors.some((anchor, index) => compareRationals(anchor.position, first.anchors[index]!.position) !== 0))) {
		return unsupported('Independent axis key times require separated AE dimensions or explicit sampling. Only the base value is mapped; original curves remain in original.mscape.');
	}
	if (active.some(curve => curve.segments.some((shape, index) => interpolation(shape) !== interpolation(first.segments[index])))) {
		return unsupported('Mixed axis interpolation cannot share an AE vector key. Original curves remain in original.mscape.');
	}
	if (options.spatial && active.some(curve => curve.segments.some(shape => shape.kind !== 'linear' && shape.kind !== 'hold'))) {
		return unsupported('Motion per-axis spatial Bezier curves need an explicit AE spatial mapping. Only the base value is mapped; original curves remain in original.mscape.');
	}
	try {
		const keys: MotionAeKey<readonly number[]>[] = first.anchors.map((anchor, index) => ({
			time: (valueOf(options.startFrame) + valueOf(anchor.position)) / options.rate,
			value: curves.map((curve, axis) => curve ? curve.anchors[index]!.value * options.scale : base[axis]!),
			inInterpolation: interpolation(first.segments[index - 1]), outInterpolation: interpolation(first.segments[index]),
			inEase: options.spatial ? [fallbackEase()] : curves.map(curve => ease(curve, index - 1, true, options.scale, options.rate)),
			outEase: options.spatial ? [fallbackEase()] : curves.map(curve => ease(curve, index, false, options.scale, options.rate)),
			inSpatialTangent: options.spatial ? base.map(() => 0) : null, outSpatialTangent: options.spatial ? base.map(() => 0) : null, roving: false,
		}));
		return finish({ ...property, keys }, null);
	} catch (error) { if (error instanceof RangeError) return unsupported(error.message + ' Original curves remain in original.mscape.'); throw error; }
}
