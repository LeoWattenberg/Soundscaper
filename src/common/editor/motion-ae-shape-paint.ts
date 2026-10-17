/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MotionShape } from './motion-composition.ts';
import type { MotionAeProperty } from './motion-ae-exchange-types.ts';
import { convertMotionAeNumericProperty } from './motion-ae-property-conversion.ts';
import { exportMotionAeNumeric } from './motion-ae-export-property.ts';
import { motionPropertyOfKind, type MotionColorProperty, type MotionScalarProperty } from './motion-property.ts';
import { shapeFields, shapeGroup, shapeGroupRecord, shapeNumber, shapeNumeric, shapeStatic, UnsupportedAeShape, type ShapeGroup } from './motion-ae-shape-transform.ts';
import type { Rational } from './timeline-time.ts';
const styleFields = ['ADBE Vector Blend Mode', 'ADBE Vector Composite Order'];
export function assertNormalAeVector(group: ShapeGroup): void {
	if (group.vectorStyle?.blendMode !== 'normal') throw new UnsupportedAeShape('Explicit captured normal vector blending is required; numeric AE blend enums are not guessed.');
	const fields = new Map(group.children.map(value => [value.matchName, value]));
	for (const name of styleFields) if (fields.has(name)) shapeStatic(fields, name);
}
function scalar(group: ShapeGroup, name: string, rate: Rational, scale: number, min: number, max: number): Readonly<{ property: MotionScalarProperty; quantizedClock: boolean }> {
	const input = shapeNumber(new Map(group.children.map(value => [value.matchName, value])), name);
	if ([input.value, ...input.keys.map(key => key.value)].some(value => value[0]! < min || value[0]! > max)) throw new UnsupportedAeShape(`${name} exceeds its supported range.`);
	const converted = convertMotionAeNumericProperty(input, { frameRate: rate, axes: [0], defaults: [0], scale });
	if (converted.property?.kind !== 'scalar') throw new UnsupportedAeShape(converted.message); return { property: converted.property, quantizedClock: converted.quantizedClock };
}
export function convertAeShapePaint(group: ShapeGroup, rate: Rational, scale: number): Readonly<{ fill: MotionShape['fill']; stroke: MotionShape['stroke']; quantizedClock: boolean }> {
	assertNormalAeVector(group); const stroke = group.matchName === 'ADBE Vector Graphic - Stroke', label = stroke ? 'Stroke' : 'Fill';
	const fields = shapeFields(group, [...styleFields, `ADBE Vector ${label} Color`, `ADBE Vector ${label} Opacity`, ...(stroke ? ['ADBE Vector Stroke Width', 'ADBE Vector Stroke Line Cap', 'ADBE Vector Stroke Line Join', 'ADBE Vector Stroke Miter Limit', 'ADBE Vector Stroke Dashes', 'ADBE Vector Stroke Taper', 'ADBE Vector Stroke Wave'] : ['ADBE Vector Fill Rule'])]);
	const raw = fields.get(`ADBE Vector ${label} Color`);
	if (raw?.kind !== 'numeric' || (raw.value.length !== 3 && raw.value.length !== 4)) throw new UnsupportedAeShape('Captured solid RGB/RGBA color is required.');
	const rgb = shapeStatic(fields, raw.matchName, raw.value.length);
	if (rgb.some(value => value < 0 || value > 1) || (rgb.length === 4 && rgb[3] !== 1)) throw new UnsupportedAeShape('Only SDR solid RGB color with separate paint opacity is editable.');
	const alpha = scalar(group, `ADBE Vector ${label} Opacity`, rate, 0.01, 0, 100);
	const color = motionPropertyOfKind({ kind: 'color', value: [rgb[0], rgb[1], rgb[2], alpha.property.value], curves: [null, null, null, alpha.property.curve], expression: null }, 'color');
	if (!stroke) {
		if (group.vectorStyle?.fillRule !== 'nonzero') throw new UnsupportedAeShape('Explicit nonzero fill winding is required.');
		if (fields.has('ADBE Vector Fill Rule')) shapeStatic(fields, 'ADBE Vector Fill Rule');
		return { fill: color, stroke: null, quantizedClock: alpha.quantizedClock };
	}
	const cap = group.vectorStyle?.lineCap, join = group.vectorStyle?.lineJoin;
	if (!cap || cap === 'unavailable' || !join || join === 'unavailable') throw new UnsupportedAeShape('Explicit stroke cap/join semantics are required.');
	for (const name of ['ADBE Vector Stroke Line Cap', 'ADBE Vector Stroke Line Join']) if (fields.has(name)) shapeStatic(fields, name);
	if (shapeStatic(fields, 'ADBE Vector Stroke Miter Limit')[0] !== 4) throw new UnsupportedAeShape('Only the Motion miter limit of four is editable.');
	const dashes = fields.get('ADBE Vector Stroke Dashes');
	if (dashes && (dashes.kind !== 'group' || dashes.children.length)) throw new UnsupportedAeShape('Dashed, tapered or waved strokes require an explicit mapping.');
	for (const [name, neutral, allowed] of [
		['ADBE Vector Stroke Taper', ['ADBE Vector Taper Start Length', 'ADBE Vector Taper End Length'], ['ADBE Vector Taper Start Width', 'ADBE Vector Taper Length Units', 'ADBE Vector Taper End Width', 'ADBE Vector Taper End Ease', 'ADBE Vector Taper End Length', 'ADBE Vector Taper Start Length', 'ADBE Vector Taper Start Ease']],
		['ADBE Vector Stroke Wave', ['ADBE Vector Taper Wave Amount'], ['ADBE Vector Taper Wave Amount', 'ADBE Vector Taper Wave Units', 'ADBE Vector Taper Wave Phase', 'ADBE Vector Taper Wavelength']],
	] as const) {
		const raw = fields.get(name); if (!raw) continue;
		const controls = shapeFields(shapeGroup(raw, name), allowed);
		for (const key of controls.keys()) shapeStatic(controls, key);
		for (const key of neutral) if (shapeStatic(controls, key)[0] !== 0) throw new UnsupportedAeShape('Nonzero stroke taper lengths or wave amount require a separate mapping.');
	}
	const width = scalar(group, 'ADBE Vector Stroke Width', rate, scale, 0, 32768 / scale);
	return { fill: null, stroke: { color, width: width.property, lineCap: cap, lineJoin: join }, quantizedClock: alpha.quantizedClock || width.quantizedClock };
}
function exportScalar(property: MotionScalarProperty, name: string, rate: number, startFrame: Rational, scale = 1): MotionAeProperty {
	const limit = name.endsWith('Opacity') ? 1 : 32768;
	if ([property.value, ...(property.curve?.anchors.map(anchor => anchor.value) ?? [])].some(value => value < 0 || value > limit)) throw new UnsupportedAeShape('Shape opacity/width exceeds the bounded editable range.');
	if (property.expression?.enabled || property.curve?.segments.some(segment => segment.kind !== 'hold' && segment.kind !== 'linear')) throw new UnsupportedAeShape('Shape paint curves require authored hold/linear keys; other easing/expressions remain in original.mscape.');
	const output = exportMotionAeNumeric(property, { matchName: name, name, rate, startFrame, scale, axes: [0], spatial: false });
	if (output.unsupported) throw new UnsupportedAeShape(output.unsupported); return output.property;
}
export function exportAeShapePaint(color: MotionColorProperty, stroke: MotionShape['stroke'], rate: number, startFrame: Rational): ShapeGroup {
	if (color.expression?.enabled || color.curves.slice(0, 3).some(Boolean)) throw new UnsupportedAeShape('Animated RGB or color expressions require a separate AE mapping.');
	const label = stroke ? 'Stroke' : 'Fill';
	const opacity: MotionScalarProperty = { kind: 'scalar', value: color.value[3], curve: color.curves[3], expression: null };
	const children: MotionAeProperty[] = [shapeNumeric(`ADBE Vector ${label} Color`, [...color.value.slice(0, 3), 1]), exportScalar(opacity, `ADBE Vector ${label} Opacity`, rate, startFrame, 100)];
	if (stroke) children.push(exportScalar(stroke.width, 'ADBE Vector Stroke Width', rate, startFrame), shapeNumeric('ADBE Vector Stroke Miter Limit', [4]));
	return { ...shapeGroupRecord(`ADBE Vector Graphic - ${label}`, children, true), vectorStyle: { blendMode: 'normal', ...(stroke ? { lineCap: stroke.lineCap, lineJoin: stroke.lineJoin } : { fillRule: 'nonzero' }) } };
}
