/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MotionAeShape } from './motion-ae-exchange-types.ts';
import type { MotionAeImportShapeGroup } from './motion-ae-host-import-shape.ts';
import type { MotionAeImportNumeric } from './motion-ae-host-import-plan.ts';
import type { MotionAeShapeProfile } from './motion-ae-host-shape-profile.ts';
export interface MotionAeShapeTarget {
	name: string; readonly numProperties: number; readonly propertyIndex: number; readonly numKeys: number; readonly value: unknown; readonly canSetEnabled: boolean; enabled: boolean;
	property(name: string | number): MotionAeShapeTarget | null; addProperty(name: string): MotionAeShapeTarget;
	setValue(value: unknown): void; setValueAtTime(time: number, value: unknown): void; setInterpolationTypeAtKey(index: number, incoming: unknown, outgoing: unknown): void;
}
interface Host {
	shape(value: MotionAeShape): unknown;
	readonly hold: unknown; readonly linear: unknown;
}
function property(parent: MotionAeShapeTarget, name: string | number): MotionAeShapeTarget { const value = parent.property(name); if (!value) throw new Error('AE shape target control is unavailable: ' + String(name)); return value; }
function enable(target: MotionAeShapeTarget): void { if (!target.canSetEnabled) throw new Error('AE shape target enable switch is unavailable.'); target.enabled = true; }
function popup(parent: MotionAeShapeTarget, name: string, value: number): void {
	const target = property(parent, name); if (target.numKeys !== 0) throw new Error('New AE shape popup unexpectedly has keys.'); target.setValue(value);
	if (target.value !== value) throw new Error('AE rejected a reviewed shape-style popup value. Recalibrate this exact host or use rendered fallback.');
}
function numeric(target: MotionAeShapeTarget, value: MotionAeImportNumeric, host: Host): void {
	if (target.numKeys !== 0) throw new Error('New AE shape control unexpectedly has keys.');
	const hostValue = (input: readonly number[]) => input.length === 1 ? input[0]! : input;
	if (!value.keys.length) target.setValue(hostValue(value.value));
	for (let index = 0; index < value.keys.length; index++) target.setValueAtTime(value.keys[index]!.time, hostValue(value.keys[index]!.value));
	for (let index = 0; index < value.keys.length; index++) { const key = value.keys[index]!; target.setInterpolationTypeAtKey(index + 1, key.inInterpolation === 'hold' ? host.hold : host.linear, key.outInterpolation === 'hold' ? host.hold : host.linear); }
}
/** Caller owns the fresh shape layer in its rollback transaction. Never accepts an existing nonempty shape root. */
export function applyMotionAeHostShapes(root: MotionAeShapeTarget, groups: readonly MotionAeImportShapeGroup[], profile: MotionAeShapeProfile, host: Host): void {
	if (root.numProperties !== 0 || !groups.length || groups.length > 1024) throw new Error('AE shape application requires a fresh owned root and bounded groups.'); const m = profile.mapping;
	for (let index = 0; index < groups.length; index++) {
		const source = groups[index]!, created = root.addProperty('ADBE Vector Group'); if (created.propertyIndex !== index + 1) throw new Error('AE shape insertion order differs from the admitted profile.');
		const group = property(root, index + 1); group.name = source.name; enable(group); popup(group, 'ADBE Vector Blend Mode', m.groupNormal);
		const transform = property(group, 'ADBE Vector Transform Group'); for (let t = 0; t < source.transform.length; t++) numeric(property(transform, source.transform[t]!.matchName), source.transform[t]!, host);
		const contents = property(group, 'ADBE Vectors Group'); if (contents.numProperties !== 0) throw new Error('New AE vector group unexpectedly contains content.');
		contents.addProperty('ADBE Vector Shape - Group'); const pathGroup = property(contents, 1); enable(pathGroup); popup(pathGroup, 'ADBE Vector Shape Direction', m.pathForward);
		const path = property(pathGroup, 'ADBE Vector Shape'); if (path.numKeys !== 0) throw new Error('New AE shape path unexpectedly has keys.');
		if (!source.path.keys.length) path.setValue(host.shape(source.path.value));
		for (let key = 0; key < source.path.keys.length; key++) { const value = source.path.keys[key]!; path.setValueAtTime(value.time, host.shape(value.value)); }
		for (let key = 0; key < source.path.keys.length; key++) { const value = source.path.keys[key]!; path.setInterpolationTypeAtKey(key + 1, value.inInterpolation === 'hold' ? host.hold : host.linear, value.outInterpolation === 'hold' ? host.hold : host.linear); }
		const stroke = source.paint.kind === 'stroke', label = stroke ? 'Stroke' : 'Fill';
		contents.addProperty('ADBE Vector Graphic - ' + label); const paint = property(contents, 2); enable(paint); popup(paint, 'ADBE Vector Blend Mode', stroke ? m.strokeNormal : m.fillNormal);
		property(paint, 'ADBE Vector ' + label + ' Color').setValue([source.paint.color[0], source.paint.color[1], source.paint.color[2], 1]);
		numeric(property(paint, 'ADBE Vector ' + label + ' Opacity'), source.paint.opacity, host);
		if (stroke) {
			popup(paint, 'ADBE Vector Stroke Line Cap', source.paint.lineCap === 'butt' ? m.capButt : source.paint.lineCap === 'round' ? m.capRound : m.capSquare);
			popup(paint, 'ADBE Vector Stroke Line Join', source.paint.lineJoin === 'miter' ? m.joinMiter : source.paint.lineJoin === 'round' ? m.joinRound : m.joinBevel);
			property(paint, 'ADBE Vector Stroke Miter Limit').setValue(4); numeric(property(paint, 'ADBE Vector Stroke Width'), source.paint.width!, host);
			const dashes = paint.property('ADBE Vector Stroke Dashes'); if (dashes && dashes.numProperties !== 0) throw new Error('New AE stroke unexpectedly contains dashes.');
			const taper = paint.property('ADBE Vector Stroke Taper'); if (taper) { property(taper, 'ADBE Vector Taper Start Length').setValue(0); property(taper, 'ADBE Vector Taper End Length').setValue(0); }
			const wave = paint.property('ADBE Vector Stroke Wave'); if (wave) property(wave, 'ADBE Vector Taper Wave Amount').setValue(0);
		} else popup(paint, 'ADBE Vector Fill Rule', m.fillNonzero);
	}
}
