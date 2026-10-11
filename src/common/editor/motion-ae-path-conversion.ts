/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MotionAeProperty, MotionAeShape } from './motion-ae-exchange-types.ts';
import { normalizeMotionAeProperties } from './motion-ae-property-custody.ts';
import { motionAeBoundedClock } from './motion-ae-property-conversion.ts';
import { motionPropertyOfKind, type MotionPath, type MotionPathProperty } from './motion-property.ts';
import { normalizeRational, type Rational } from './timeline-time.ts';

type Shape = Extract<MotionAeProperty, { kind: 'shape' }>;
interface PathConversion {
	readonly status: 'editable' | 'unsupported'; readonly property: MotionPathProperty | null;
	readonly message: string; readonly quantizedClock: boolean;
}
const number = (value: Rational) => value.num / value.den;
function fromAe(value: MotionAeShape): MotionPath {
	return { closed: value.closed, vertices: value.vertices.map((point, index) => ({ point, inTangent: value.inTangents[index]!, outTangent: value.outTangents[index]! })) };
}
function toAe(value: MotionPath): MotionAeShape {
	return { closed: value.closed, vertices: value.vertices.map(vertex => vertex.point), inTangents: value.vertices.map(vertex => vertex.inTangent), outTangents: value.vertices.map(vertex => vertex.outTangent) };
}
/** Both formats store tangent offsets relative to each vertex. AE keys are in composition seconds. */
export function convertMotionAePath(input: Shape, frameRate: Rational): PathConversion {
	const source = normalizeMotionAeProperties([input], { properties: 0, keys: 0 })[0]!;
	if (source.kind !== 'shape') throw new TypeError('AE path conversion requires a shape property.');
	const rate = number(normalizeRational(frameRate)); if (rate <= 0 || rate > 1000) throw new RangeError('AE path frame rate is outside its bound.');
	const unsupported = (message: string): PathConversion => ({ status: 'unsupported', property: null, message, quantizedClock: false });
	if (source.expression?.enabled) return unsupported('Path expressions remain inert. Bake an editable path explicitly in AE or render the composition.');
	let quantizedClock = false;
	for (let index = 0; index < source.keys.length; index++) {
		const key = source.keys[index]!, next = source.keys[index + 1];
		if (key.time < 0 || key.value.closed !== source.value.closed || key.value.vertices.length !== source.value.vertices.length) return unsupported('Negative key times or changing path topology require an explicit AE bake.');
		if (next && key.outInterpolation !== 'hold' && (key.outInterpolation !== 'linear' || next.inInterpolation !== 'linear')) return unsupported('Path temporal Bezier interpolation requires a qualified AE bake; its speed is not guessed.');
	}
	const keyframes = source.keys.map(key => {
		const clock = motionAeBoundedClock(key.time * rate); quantizedClock ||= clock.quantized;
		return { position: clock.value, value: fromAe(key.value) };
	});
	for (let index = 1; index < keyframes.length; index++) if (number(keyframes[index - 1]!.position) >= number(keyframes[index]!.position)) return unsupported('Path keys collide on the bounded Motion frame clock. Bake to distinct frame positions in AE.');
	try {
		const property = motionPropertyOfKind({ kind: 'path', value: fromAe(source.value), keyframes,
			segments: source.keys.slice(1).map((_, index) => source.keys[index]!.outInterpolation === 'hold' ? 'hold' : 'linear'), expression: null }, 'path');
		return { status: 'editable', property, quantizedClock, message: 'Vertex-relative Bézier handles and hold/linear path keys remain editable. Installed AE reference-frame qualification remains pending.' };
	} catch (error) { if (error instanceof RangeError) return unsupported(error.message); throw error; }
}
export function exportMotionAePath(input: MotionPathProperty, options: Readonly<{ matchName: string; name: string; rate: number; startFrame: Rational }>): Readonly<{ property: Shape; unsupported: string | null }> {
	const source = motionPropertyOfKind(input, 'path'), start = number(normalizeRational(options.startFrame));
	if (!Number.isFinite(options.rate) || options.rate <= 0 || options.rate > 1000) throw new RangeError('AE path frame rate is outside its bound.');
	const property: Shape = { kind: 'shape', matchName: options.matchName, name: options.name, value: toAe(source.value), keys: [],
		expression: source.expression ? { source: source.expression.source, enabled: source.expression.enabled, disposition: 'unsupported' } : null };
	if (source.expression?.enabled) return { property, unsupported: 'Path expressions remain inert; original intent stays in original.mscape.' };
	if (source.segments.some(segment => segment !== 'hold' && segment !== 'linear')) return { property, unsupported: 'Path temporal easing needs a qualified AE mapping or explicit bake. Only its base path is mapped; original keys remain in original.mscape.' };
	return { property: { ...property, keys: source.keyframes.map((key, index) => ({ time: (start + number(key.position)) / options.rate, value: toAe(key.value),
		inInterpolation: source.segments[index - 1] === 'hold' ? 'hold' : 'linear', outInterpolation: source.segments[index] === 'hold' ? 'hold' : 'linear',
		inEase: [{ speed: 0, influence: 100 / 3 }], outEase: [{ speed: 0, influence: 100 / 3 }], inSpatialTangent: null, outSpatialTangent: null, roving: false,
	})) }, unsupported: null };
}
