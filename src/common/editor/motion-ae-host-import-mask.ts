/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MotionAeMaskMetadata } from './motion-ae-exchange-types.ts';
import { readMotionAeImportPath, type MotionAeImportPath } from './motion-ae-host-import-path.ts';
import type { MotionAeImportNumeric } from './motion-ae-host-import-plan.ts';
export interface MotionAeImportMask {
	readonly name: string; readonly metadata: MotionAeMaskMetadata;
	readonly path: MotionAeImportPath;
	readonly opacity: MotionAeImportNumeric;
}
function record(input: unknown): Record<string, unknown> {
	if (input === null || typeof input !== 'object' || Object.prototype.toString.call(input) === '[object Array]') throw new Error('AE mask expected a record.'); return input as Record<string, unknown>;
}
function array(input: unknown, maximum: number): readonly unknown[] {
	if (Object.prototype.toString.call(input) !== '[object Array]' || (input as unknown[]).length > maximum) throw new Error('AE mask array budget exceeded.'); return input as unknown[];
}
function boolean(input: unknown): boolean { if (typeof input !== 'boolean') throw new Error('AE mask boolean is invalid.'); return input; }
/** ES3-safe admission before any host mutation. Only the explicitly implemented hard-edge subset is admitted. */
export function readMotionAeImportMasks(input: unknown, warnings: string[], budget: { properties: number; keys: number },
	readNumeric: (value: Record<string, unknown>, warnings: string[], budget: { properties: number; keys: number }) => MotionAeImportNumeric,
): readonly MotionAeImportMask[] {
	const roots = array(input, 65_536), result: MotionAeImportMask[] = [];
	for (let root = 0; root < roots.length; root++) {
		const group = record(roots[root]); if (group.matchName !== 'ADBE Mask Parade') continue;
		if (group.kind !== 'group') throw new Error('AE mask parade is not a group.');
		const entries = array(group.children, 256);
		for (let index = 0; index < entries.length; index++) {
			const entry = record(entries[index]); if (++budget.properties > 65_536) throw new Error('AE import property budget exceeded.');
			if (entry.kind !== 'group' || entry.matchName !== 'ADBE Mask Atom' || !entry.mask) throw new Error('Captured mask metadata is required; export again with the current bridge.');
			const metadata = record(entry.mask), mode = metadata.mode;
			if (mode !== 'add' && mode !== 'subtract' && mode !== 'intersect' && mode !== 'difference' && mode !== 'none') throw new Error('AE editable mask mode is unsupported.');
			if (boolean(metadata.rotoBezier) || metadata.motionBlur === 'on') throw new Error('RotoBezier and forced mask motion blur require rendered fallback.');
			if (metadata.featherFalloff !== 'linear' && metadata.featherFalloff !== 'smooth') throw new Error('AE mask feather falloff is invalid.');
			if (metadata.motionBlur !== 'same-as-layer' && metadata.motionBlur !== 'off') throw new Error('AE mask motion blur is invalid.');
			if (typeof entry.name !== 'string' || entry.name.length > 1024) throw new Error('AE mask name exceeds its bound.');
			const fields: Record<string, Record<string, unknown>> = {}, children = array(entry.children, 4);
			for (let child = 0; child < children.length; child++) {
				if (++budget.properties > 65_536) throw new Error('AE import property budget exceeded.');
				const property = record(children[child]), name = property.matchName;
				if (name !== 'ADBE Mask Shape' && name !== 'ADBE Mask Opacity' && name !== 'ADBE Mask Feather' && name !== 'ADBE Mask Offset') throw new Error('AE mask property is not supported.');
				if (fields[name]) throw new Error('AE mask has duplicate properties.'); fields[name] = property;
			}
			for (const name of ['ADBE Mask Feather', 'ADBE Mask Offset']) {
				const field = fields[name]; if (!field || field.kind !== 'numeric') throw new Error('AE mask feather/expansion metadata is required.');
				const numeric = readNumeric(field, warnings, budget), expected = name === 'ADBE Mask Feather' ? 2 : 1;
				if (numeric.value.length !== expected || numeric.keys.length || numeric.spatial || field.samples !== undefined || (field.expression !== null && boolean(record(field.expression).enabled))) throw new Error('AE animated mask feather/expansion needs rendered fallback.');
				for (let channel = 0; channel < numeric.value.length; channel++) if (numeric.value[channel] !== 0) throw new Error('AE mask feather/expansion needs rendered fallback.');
			}
			const rawPath = fields['ADBE Mask Shape'], rawOpacity = fields['ADBE Mask Opacity'];
			if (!rawPath || rawPath.kind !== 'shape' || !rawOpacity || rawOpacity.kind !== 'numeric') throw new Error('AE mask path and opacity are required.');
			const path = readMotionAeImportPath(rawPath, budget);
			const opacity = readNumeric(rawOpacity, warnings, budget); if (opacity.spatial || opacity.value.length !== 1) throw new Error('AE mask opacity dimensions differ.');
			result.push({ name: entry.name, metadata: { mode, inverted: boolean(metadata.inverted), rotoBezier: false, featherFalloff: metadata.featherFalloff, motionBlur: metadata.motionBlur }, path, opacity });
		}
	}
	return result;
}
