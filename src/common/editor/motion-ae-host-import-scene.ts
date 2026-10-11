/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MotionAeImportNumeric } from './motion-ae-host-import-plan.ts';
export interface MotionAeImportScene { readonly kind: 'camera' | 'ambient'; readonly properties: readonly MotionAeImportNumeric[] }
function object(value: unknown): Record<string, unknown> {
	if (value === null || typeof value !== 'object' || Object.prototype.toString.call(value) === '[object Array]') throw new Error('AE scene metadata requires an object.'); return value as Record<string, unknown>;
}
function array(value: unknown): readonly unknown[] {
	if (Object.prototype.toString.call(value) !== '[object Array]' || (value as unknown[]).length > 65_536) throw new Error('AE scene property budget exceeded.'); return value as unknown[];
}
function lookup(properties: readonly MotionAeImportNumeric[], name: string): MotionAeImportNumeric {
	for (let index = 0; index < properties.length; index++) if (properties[index]!.matchName === name) return properties[index]!;
	throw new Error('AE scene requires captured ' + name);
}
function fixed(property: MotionAeImportNumeric, values: readonly number[]): void {
	if (property.keys.length || property.expression !== null || property.value.length !== values.length) throw new Error('AE scene requires static neutral geometry.');
	for (let axis = 0; axis < values.length; axis++) if (property.value[axis] !== values[axis]) throw new Error('AE scene requires static neutral geometry.');
}
function bounded(property: MotionAeImportNumeric, dimensions: number, minimum: number, maximum: number): void {
	if (property.value.length !== dimensions || property.expression !== null) throw new Error('AE scene dimensions or expression intent is unsupported.');
	const check = (value: readonly number[]) => { for (let axis = 0; axis < value.length; axis++) if (value[axis]! < minimum || value[axis]! > maximum) throw new Error('AE scene numeric value exceeds the admitted range.'); };
	check(property.value);
	for (let index = 0; index < property.keys.length; index++) {
		const key = property.keys[index]!; check(key.value);
		if (key.roving || key.inInterpolation === 'bezier' || key.outInterpolation === 'bezier') throw new Error('AE scene keys require nonroving hold/linear interpolation.');
		const tangents = (key.inSpatialTangent || []).concat(key.outSpatialTangent || []);
		for (let axis = 0; axis < tangents.length; axis++) if (tangents[axis] !== 0) throw new Error('AE scene spatial tangents require explicit mapping.');
	}
}
/** Independent ES3 host admission. Never trusts the browser converter or producer label. */
export function readMotionAeImportScene(layer: Record<string, unknown>, transform: readonly MotionAeImportNumeric[], warnings: string[], budget: { properties: number; keys: number },
	readNumeric: (property: Record<string, unknown>, warnings: string[], budget: { properties: number; keys: number }) => MotionAeImportNumeric): MotionAeImportScene | undefined {
	if (layer.kind !== 'camera' && layer.kind !== 'light') { if (layer.scene !== undefined) throw new Error('AE scene metadata has no camera/light owner.'); return undefined; }
	const scene = object(layer.scene), camera = layer.kind === 'camera';
	for (const name in scene) if (Object.prototype.hasOwnProperty.call(scene, name) && name !== 'autoOrient' && (camera || name !== 'lightType')) throw new Error('AE scene metadata has an unsupported field.');
	if (scene.autoOrient !== 'none' || (!camera && scene.lightType !== 'ambient') || layer.parentId !== null || layer.matte !== null || layer.sourceId !== null || layer.adjustment !== false || layer.blendMode !== 'normal' || layer.threeD !== true) throw new Error('AE camera/ambient scene requires no automatic orientation, parent, source, matte, adjustment or blend override.');
	const roots = array(layer.properties), groupName = camera ? 'ADBE Camera Options Group' : 'ADBE Light Options Group';
	let found = false, foundTransform = false; const properties: MotionAeImportNumeric[] = [], names: Record<string, boolean> = {};
	for (let index = 0; index < roots.length; index++) {
		const root = object(roots[index]);
		if (root.matchName === 'ADBE Transform Group') {
			if (foundTransform || root.kind !== 'group') throw new Error('AE scene transform group is duplicated or invalid.'); foundTransform = true; const children = array(root.children);
			if (children.length !== transform.length) throw new Error('AE scene transform contains omitted controls.');
			for (let child = 0; child < children.length; child++) { const raw = object(children[child]); if (raw.samples !== undefined || raw.kind !== 'numeric' || (raw.expression !== null && object(raw.expression).enabled === true)) throw new Error('AE scene transform expressions or samples require separate mapping.'); }
			continue;
		}
		if (root.kind !== 'group' || root.matchName !== groupName || found) throw new Error('AE scene contains unsupported or duplicate property groups.'); found = true;
		if (++budget.properties > 65_536) throw new Error('AE scene property budget exceeded.');
		const children = array(root.children);
		for (let child = 0; child < children.length; child++) {
			if (++budget.properties > 65_536) throw new Error('AE scene property budget exceeded.'); const raw = object(children[child]), name = raw.matchName;
			if (typeof name !== 'string' || (camera ? name !== 'ADBE Camera Zoom' && name !== 'ADBE Camera Focus Distance' && name !== 'ADBE Camera Depth of Field' : name !== 'ADBE Light Color' && name !== 'ADBE Light Intensity') || names[name] || raw.kind !== 'numeric' || raw.samples !== undefined) throw new Error('AE scene option is duplicated, sampled or unsupported.');
			names[name] = true; const expression = raw.expression === null ? null : object(raw.expression);
			if (expression?.enabled) throw new Error('AE scene expressions require a separate mapping.'); properties.push(readNumeric(raw, warnings, budget));
		}
	}
	if (!found || !foundTransform) throw new Error('AE scene option group is missing.');
	if (camera) {
		bounded(lookup(properties, 'ADBE Camera Zoom'), 1, 1e-6, 1e9); bounded(lookup(properties, 'ADBE Camera Focus Distance'), 1, 0, 1e9); fixed(lookup(properties, 'ADBE Camera Depth of Field'), [0]);
		bounded(lookup(transform, 'ADBE Position'), 3, -1e9, 1e9); bounded(lookup(transform, 'ADBE Rotate Z'), 1, -1e9, 1e9);
		fixed(lookup(transform, 'ADBE Orientation'), [0, 0, 0]); fixed(lookup(transform, 'ADBE Rotate X'), [0]); fixed(lookup(transform, 'ADBE Rotate Y'), [0]);
		for (let index = 0; index < transform.length; index++) {
			const property = transform[index]!, name = property.matchName;
			if (name === 'ADBE Anchor Point') fixed(property, [0, 0, 0]); else if (name === 'ADBE Scale') fixed(property, [100, 100, 100]); else if (name === 'ADBE Opacity') fixed(property, [100]);
		}
	} else {
		if (transform.length) throw new Error('Ambient host plans must use the reviewed identity transform.');
		bounded(lookup(properties, 'ADBE Light Intensity'), 1, 0, 6400); const color = lookup(properties, 'ADBE Light Color'); bounded(color, 4, 0, 1);
		if (color.keys.length || color.value[3] !== 1) throw new Error('Ambient color requires static opaque SDR channels.');
	}
	warnings.push('Camera/ambient-light parameters require installed-AE projection, clipping, light/material and color reference qualification. Compare the source scene.');
	return { kind: camera ? 'camera' : 'ambient', properties };
}
