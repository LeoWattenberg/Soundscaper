/* SPDX-License-Identifier: AGPL-3.0-only */
import { readMotionAeImportPath, type MotionAeImportPath } from './motion-ae-host-import-path.ts';
import type { MotionAeImportNumeric } from './motion-ae-host-import-plan.ts';
export interface MotionAeImportShapeGroup {
	readonly name: string; readonly path: MotionAeImportPath; readonly transform: readonly MotionAeImportNumeric[];
	readonly paint: { readonly kind: 'fill' | 'stroke'; readonly color: readonly number[]; readonly opacity: MotionAeImportNumeric; readonly width: MotionAeImportNumeric | null;
		readonly lineCap: 'butt' | 'round' | 'square' | null; readonly lineJoin: 'miter' | 'round' | 'bevel' | null };
}
interface Budget { properties: number; keys: number }
type NumericReader = (value: Record<string, unknown>, warnings: string[], budget: Budget) => MotionAeImportNumeric;
function record(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Object.prototype.toString.call(value) === '[object Array]') throw new Error('AE shape requires a record.'); return value as Record<string, unknown>; }
function array(value: unknown, maximum: number): readonly unknown[] { if (Object.prototype.toString.call(value) !== '[object Array]' || (value as unknown[]).length > maximum) throw new Error('AE shape array budget exceeded.'); return value as unknown[]; }
function group(value: unknown, matchName: string, budget: Budget, active = false): Record<string, unknown> {
	const item = record(value); if (++budget.properties > 65_536) throw new Error('AE import property budget exceeded.');
	if (item.kind !== 'group' || item.matchName !== matchName || (active && item.enabled !== true)) throw new Error('AE shape requires captured active ' + matchName); return item;
}
function fields(value: Record<string, unknown>, allowed: readonly string[], budget: Budget): Record<string, Record<string, unknown>> {
	const children = array(value.children, allowed.length), result: Record<string, Record<string, unknown>> = {};
	for (let index = 0; index < children.length; index++) {
		if (++budget.properties > 65_536) throw new Error('AE import property budget exceeded.'); const child = record(children[index]);
		let name: string | undefined; for (let candidate = 0; candidate < allowed.length; candidate++) if (child.matchName === allowed[candidate]) name = allowed[candidate];
		if (name === undefined || result[name]) throw new Error('AE shape has unsupported or duplicated controls.'); result[name] = child;
	} return result;
}
function style(value: Record<string, unknown>, normal = true): Record<string, unknown> {
	const result = record(value.vectorStyle); if (normal && result.blendMode !== 'normal') throw new Error('AE shape needs reviewed normal vector blending.'); return result;
}
/** Only explicit named semantics are admitted. Raw popup values never become host write authority. */
export function readMotionAeImportShapes(input: unknown, warnings: string[], budget: Budget, readNumeric: NumericReader): readonly MotionAeImportShapeGroup[] {
	const roots = array(input, 65_536); let root: Record<string, unknown> | undefined;
	for (let i = 0; i < roots.length; i++) { const item = record(roots[i]); if (item.matchName !== 'ADBE Root Vectors Group') continue; if (root) throw new Error('AE shape has duplicate roots.'); root = group(item, 'ADBE Root Vectors Group', budget); }
	if (!root) throw new Error('AE shape root is missing.'); const rawGroups = array(root.children, 1024), result: MotionAeImportShapeGroup[] = [];
	function numeric(field: Record<string, unknown> | undefined, dimensions: number, animated: boolean, min = -1e12, max = 1e12): MotionAeImportNumeric {
		if (!field || field.kind !== 'numeric' || field.samples !== undefined || (field.expression !== null && record(field.expression).enabled !== false)) throw new Error('AE shape numeric control requires authored values without samples or enabled expressions.');
		const value = readNumeric(field, warnings, budget); if (value.spatial || value.value.length !== dimensions || (!animated && value.keys.length)) throw new Error('AE shape numeric control dimensions/animation are unsupported.');
		const check = (values: readonly number[]) => { for (let i = 0; i < values.length; i++) if (values[i]! < min || values[i]! > max) throw new Error('AE shape value is outside its supported range.'); };
		check(value.value); for (let i = 0; i < value.keys.length; i++) { const key = value.keys[i]!; check(key.value); if (key.inInterpolation === 'bezier' || key.outInterpolation === 'bezier' || key.roving) throw new Error('AE shape easing needs explicit baked keys.'); }
		return value;
	}
	function rawPopup(source: Record<string, Record<string, unknown>>, name: string): void { if (source[name]) numeric(source[name], 1, false); }
	for (let i = 0; i < rawGroups.length; i++) {
		const item = group(rawGroups[i], 'ADBE Vector Group', budget, true); style(item);
		if (typeof item.name !== 'string' || item.name.length > 1024) throw new Error('AE shape name exceeds its budget.');
		const parts = fields(item, ['ADBE Vectors Group', 'ADBE Vector Transform Group', 'ADBE Vector Blend Mode'], budget); rawPopup(parts, 'ADBE Vector Blend Mode');
		const content = group(parts['ADBE Vectors Group'], 'ADBE Vectors Group', budget), children = array(content.children, 2); if (children.length !== 2) throw new Error('AE shape requires one path followed by one paint.');
		const pathGroup = group(children[0], 'ADBE Vector Shape - Group', budget, true), pathFields = fields(pathGroup, ['ADBE Vector Shape', 'ADBE Vector Shape Direction'], budget);
		if (style(pathGroup, false).pathDirection !== 'forward') throw new Error('AE shape needs explicit forward path direction.'); rawPopup(pathFields, 'ADBE Vector Shape Direction');
		const path = readMotionAeImportPath(pathFields['ADBE Vector Shape'], budget);
		const rawPaint = record(children[1]), stroke = rawPaint.matchName === 'ADBE Vector Graphic - Stroke', label = stroke ? 'Stroke' : 'Fill';
		const paint = group(rawPaint, 'ADBE Vector Graphic - ' + label, budget, true), paintStyle = style(paint);
		const paintFields = fields(paint, ['ADBE Vector Blend Mode', 'ADBE Vector Composite Order', 'ADBE Vector ' + label + ' Color', 'ADBE Vector ' + label + ' Opacity', ...(stroke ? ['ADBE Vector Stroke Width', 'ADBE Vector Stroke Miter Limit', 'ADBE Vector Stroke Line Cap', 'ADBE Vector Stroke Line Join', 'ADBE Vector Stroke Dashes', 'ADBE Vector Stroke Taper', 'ADBE Vector Stroke Wave'] : ['ADBE Vector Fill Rule'])], budget);
		rawPopup(paintFields, 'ADBE Vector Blend Mode'); rawPopup(paintFields, 'ADBE Vector Composite Order');
		const rawColor = paintFields['ADBE Vector ' + label + ' Color'], colorLength = array(rawColor?.value, 4).length;
		if (colorLength !== 3 && colorLength !== 4) throw new Error('AE shape requires solid RGB color.'); const color = numeric(rawColor, colorLength, false, 0, 1).value;
		if (colorLength === 4 && color[3] !== 1) throw new Error('AE shape color alpha must use its separate opacity control.');
		const opacity = numeric(paintFields['ADBE Vector ' + label + ' Opacity'], 1, true, 0, 100);
		let width: MotionAeImportNumeric | null = null, lineCap: MotionAeImportShapeGroup['paint']['lineCap'] = null, lineJoin: MotionAeImportShapeGroup['paint']['lineJoin'] = null;
		if (stroke) {
			width = numeric(paintFields['ADBE Vector Stroke Width'], 1, true, 0, 32768);
			if (numeric(paintFields['ADBE Vector Stroke Miter Limit'], 1, false).value[0] !== 4) throw new Error('AE shape miter limit must be four.');
			if (paintStyle.lineCap !== 'butt' && paintStyle.lineCap !== 'round' && paintStyle.lineCap !== 'square') throw new Error('AE shape line cap is unavailable.'); lineCap = paintStyle.lineCap;
			if (paintStyle.lineJoin !== 'miter' && paintStyle.lineJoin !== 'round' && paintStyle.lineJoin !== 'bevel') throw new Error('AE shape line join is unavailable.'); lineJoin = paintStyle.lineJoin;
			rawPopup(paintFields, 'ADBE Vector Stroke Line Cap'); rawPopup(paintFields, 'ADBE Vector Stroke Line Join');
			const dashes = paintFields['ADBE Vector Stroke Dashes']; if (dashes && (dashes.kind !== 'group' || array(dashes.children, 0).length)) throw new Error('AE shape dashes are unsupported.');

			const taper = paintFields['ADBE Vector Stroke Taper'], wave = paintFields['ADBE Vector Stroke Wave'];
			if (taper) {
				const controls = fields(group(taper, 'ADBE Vector Stroke Taper', budget), ['ADBE Vector Taper Start Width', 'ADBE Vector Taper Length Units', 'ADBE Vector Taper End Width', 'ADBE Vector Taper End Ease', 'ADBE Vector Taper End Length', 'ADBE Vector Taper Start Length', 'ADBE Vector Taper Start Ease'], budget);
				for (const key in controls) if (Object.prototype.hasOwnProperty.call(controls, key)) numeric(controls[key], 1, false);
				if (numeric(controls['ADBE Vector Taper Start Length'], 1, false).value[0] !== 0 || numeric(controls['ADBE Vector Taper End Length'], 1, false).value[0] !== 0) throw new Error('AE shape taper must be neutral.');
			}
			if (wave) {
				const controls = fields(group(wave, 'ADBE Vector Stroke Wave', budget), ['ADBE Vector Taper Wave Amount', 'ADBE Vector Taper Wave Units', 'ADBE Vector Taper Wave Phase', 'ADBE Vector Taper Wavelength'], budget);
				for (const key in controls) if (Object.prototype.hasOwnProperty.call(controls, key)) numeric(controls[key], 1, false);
				if (numeric(controls['ADBE Vector Taper Wave Amount'], 1, false).value[0] !== 0) throw new Error('AE shape wave must be neutral.');
			}
		} else { if (paintStyle.fillRule !== 'nonzero') throw new Error('AE shape needs nonzero fill rule.'); rawPopup(paintFields, 'ADBE Vector Fill Rule'); }
		const transformNames = ['ADBE Vector Anchor', 'ADBE Vector Position', 'ADBE Vector Scale', 'ADBE Vector Rotation', 'ADBE Vector Skew', 'ADBE Vector Skew Axis', 'ADBE Vector Group Opacity'];
		const transformFields = fields(group(parts['ADBE Vector Transform Group'], 'ADBE Vector Transform Group', budget), transformNames, budget), transform: MotionAeImportNumeric[] = [];
		for (let index = 0; index < transformNames.length; index++) transform.push(numeric(transformFields[transformNames[index]!], index < 3 ? 2 : 1, false));
		if (transform[2]!.value[0]! <= 0 || transform[2]!.value[0] !== transform[2]!.value[1] || transform[4]!.value[0] !== 0 || transform[6]!.value[0] !== 100) throw new Error('AE shape supports only positive similarity group transforms.');
		result.push({ name: item.name, path, transform, paint: { kind: stroke ? 'stroke' : 'fill', color, opacity, width, lineCap, lineJoin } });
	}
	if (!result.length) throw new Error('AE editable shape has no paint groups.'); return result;
}
