/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MotionAeProperty } from './motion-ae-exchange-types.ts';
import { normalizeMotionAeProperties } from './motion-ae-property-custody.ts';
import { normalizeMotionProperty, type MotionScalarProperty, type MotionVector3Property } from './motion-property.ts';
import { normalizeRational, type Rational } from './timeline-time.ts';
import type { CompiledInterpolationCurve } from './interpolation-curve.ts';
import { translateMotionAeScalarExpression, type MotionAeExpressionReview } from './motion-ae-expression-conversion.ts';

export interface MotionAeNumericConversionOptions extends MotionAeExpressionReview {
	readonly frameRate: Rational; readonly axes: readonly (number | null)[]; readonly defaults: readonly number[]; readonly scale: number;
}
export interface MotionAeNumericConversion {
	readonly status: 'editable' | 'sampled' | 'unsupported'; readonly property: MotionScalarProperty | MotionVector3Property | null;
	readonly message: string; readonly quantizedClock: boolean;
}
/** Explicit six-decimal frame/second boundary for AE floating clocks; callers must report quantization. */
export function motionAeBoundedClock(value: number): Readonly<{ value: Rational; quantized: boolean }> {
	const numerator = Math.round(value * 1_000_000);
	if (!Number.isSafeInteger(numerator)) throw new RangeError('AE clock exceeds the bounded conversion range.');
	const rational = normalizeRational({ num: numerator, den: 1_000_000 });
	return { value: rational, quantized: rational.num / rational.den !== value };
}

/** Maps numeric units only. Unknown expression languages and AE spatial/temporal speed are never guessed. */
export function convertMotionAeNumericProperty(input: Extract<MotionAeProperty, { kind: 'numeric' }>, options: MotionAeNumericConversionOptions): MotionAeNumericConversion {
	const source = normalizeMotionAeProperties([input], { properties: 0, keys: 0 })[0]!;
	if (source.kind !== 'numeric') throw new TypeError('AE numeric conversion requires numeric custody.');
	const rate = normalizeRational(options.frameRate), frequency = rate.num / rate.den;
	if (frequency <= 0 || frequency > 1000 || !Number.isFinite(options.scale) || (options.axes.length !== 1 && options.axes.length !== 3)
		|| options.defaults.length !== options.axes.length || options.defaults.some((value) => !Number.isFinite(value))) throw new TypeError('AE numeric mapping is invalid.');
	const unsupported = (message: string): MotionAeNumericConversion => ({ status: 'unsupported', property: null, message, quantizedClock: false });
	if (options.axes.some((axis) => axis !== null && (!Number.isInteger(axis) || axis < 0 || axis >= source.value.length))) return unsupported('The AE property dimensions require a different mapping.');
	let expression: Readonly<{ source: string; enabled: true; references: readonly never[] }> | null = null;
	let expressionMessage = '';
	if (source.expression?.enabled && !source.samples) {
		if (options.translateScalarExpressions !== true || source.value.length !== 1 || options.axes.length !== 1 || options.axes[0] !== 0) return unsupported('Opt in to supported scalar expression translation, explicitly sample this expression in AE or render the complete composition. Original expression text remains in custody.');
		const converted = translateMotionAeScalarExpression(source.expression.source, { direction: 'from-after-effects', scale: options.scale });
		if (!converted.source) return unsupported(converted.message);
		expression = { source: converted.source, enabled: true, references: [] }; expressionMessage = ` ${converted.message}`;
	}
	if (!source.samples) for (let index = 0; index < source.keys.length; index++) {
		const key = source.keys[index]!;
		if (key.time < 0 || key.roving) return unsupported('Negative-time or roving keys require explicit AE frame sampling.');
		const next = source.keys[index + 1]; if (!next || key.outInterpolation === 'hold') continue;
		if (key.outInterpolation !== 'linear' || next.inInterpolation !== 'linear') return unsupported('AE temporal Bezier speed requires explicit frame sampling before Motion conversion.');
		if (source.spatial && ([...(key.outSpatialTangent ?? []), ...(next.inSpatialTangent ?? [])].some((value) => value !== 0))) return unsupported('AE spatial tangents require explicit frame sampling before Motion conversion.');
	}
	let quantizedClock = false;
	const samples = source.samples;
	const keys = samples ? samples.values.map((value, index) => ({ value, frame: (samples.firstFrame + index) * frequency / samples.frameRate }))
		: source.keys.map((key) => ({ value: key.value, frame: key.time * frequency }));
	const positions = keys.map((key) => {
		const clock = motionAeBoundedClock(key.frame); quantizedClock ||= clock.quantized; return clock.value;
	});
	for (let index = 1; index < positions.length; index++) {
		const before = positions[index - 1]!, after = positions[index]!;
		if (before.num / before.den >= after.num / after.den) return unsupported('AE keys collide on the bounded Motion clock. Sample or render this property in AE.');
	}
	const value = options.axes.map((axis, index) => axis === null ? options.defaults[index]! : (samples?.values[0] ?? source.value)[axis]! * options.scale);
	const curves = options.axes.map((axis): CompiledInterpolationCurve | null => axis === null || keys.length === 0 ? null : {
		anchors: keys.map((key, index) => ({ position: positions[index]!, value: key.value[axis]! * options.scale })),
		segments: keys.slice(1).map((_, index) => ({ kind: samples ? 'linear' : source.keys[index]!.outInterpolation === 'hold' ? 'hold' : 'linear' })),
	});
	const property = normalizeMotionProperty(options.axes.length === 1
		? { kind: 'scalar', value: value[0], curve: curves[0], expression }
		: { kind: 'vector3', value, curves, expression: null });
	if (property.kind !== 'scalar' && property.kind !== 'vector3') throw new TypeError('Unexpected numeric destination.');
	return { status: samples ? 'sampled' : 'editable', property, quantizedClock,
		message: samples ? 'AE frame values became linear Motion keys; authored source data is retained separately. Subframe motion and motion blur require rendered fallback.'
			: 'Numeric values and hold/linear keys remain editable; AE percentage units are converted explicitly where required.' + expressionMessage };
}
