/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MotionLayer, MotionMask } from './motion-composition.ts';
import type { MotionAeLayer, MotionAeProperty, MotionAeReportEntry } from './motion-ae-exchange-types.ts';
import { convertMotionAePath, exportMotionAePath } from './motion-ae-path-conversion.ts';
import { convertMotionAeNumericProperty } from './motion-ae-property-conversion.ts';
import { exportMotionAeNumeric } from './motion-ae-export-property.ts';
import { motionScalar, motionVector } from './motion-property.ts';
import type { Rational } from './timeline-time.ts';

type Group = Extract<MotionAeProperty, { kind: 'group' }>;
function staticZero(property: MotionAeProperty | undefined, dimensions: number): boolean {
	return property?.kind === 'numeric' && property.value.length === dimensions && property.value.every(value => value === 0) && !property.keys.length && !property.expression?.enabled && !property.samples;
}
export function convertMotionAeMasks(layer: MotionAeLayer, rate: Rational, allocateId: () => string, report: MotionAeReportEntry[]): readonly MotionMask[] {
	const result: MotionMask[] = [];
	for (let root = 0; root < layer.properties.length; root++) {
		const group = layer.properties[root]!; if (group.matchName !== 'ADBE Mask Parade') continue;
		const path = `${String(root)}:ADBE Mask Parade`;
		const issue = (message: string, propertyPath = path) => report.push({ scopeId: layer.id, propertyPath, code: 'mask-mapping', status: 'unsupported', message });
		if (group.kind !== 'group' || group.children.length > 256) { issue('The AE mask group exceeds the editable mask capability. Render it in AE.'); continue; }
		for (let index = 0; index < group.children.length; index++) {
			const entry = group.children[index]!, location = `${path}/${String(index)}:${entry.matchName}`;
			if (entry.kind !== 'group' || entry.matchName !== 'ADBE Mask Atom' || !entry.mask) { issue('Captured mask metadata is required before editable conversion. Export again with the current bridge.', location); continue; }
			const metadata = entry.mask;
			if (metadata.mode === 'none') continue;
			if (metadata.mode === 'darken' || metadata.mode === 'lighten' || metadata.rotoBezier || metadata.motionBlur === 'on') { issue('This mask mode, RotoBezier or forced mask motion blur needs an AE-rendered fallback.', location); continue; }
			const fields = new Map(entry.children.map(property => [property.matchName, property]));
			const shape = fields.get('ADBE Mask Shape'), opacity = fields.get('ADBE Mask Opacity');
			if (fields.size !== entry.children.length || entry.children.some(property => !['ADBE Mask Shape', 'ADBE Mask Opacity', 'ADBE Mask Feather', 'ADBE Mask Offset'].includes(property.matchName))
				|| shape?.kind !== 'shape' || opacity?.kind !== 'numeric' || opacity.value.length !== 1 || opacity.samples !== undefined
				|| !staticZero(fields.get('ADBE Mask Feather'), 2) || !staticZero(fields.get('ADBE Mask Offset'), 1)) {
				issue('Only captured authored path/opacity masks with zero feather and expansion are editable. Sampled opacity needs range-qualified mapping. AE feather radius and Motion Gaussian sigma are not interchangeable; render other masks in AE.', location); continue;
			}
			const convertedPath = convertMotionAePath(shape, rate), convertedOpacity = convertMotionAeNumericProperty(opacity, { frameRate: rate, axes: [0], defaults: [1], scale: 0.01 });
			if (!convertedPath.property || convertedOpacity.property?.kind !== 'scalar') { issue(!convertedPath.property ? convertedPath.message : convertedOpacity.message, location); continue; }
			result.push({ id: allocateId(), path: convertedPath.property, opacity: convertedOpacity.property, feather: motionVector([0, 0]), expansion: motionScalar(0), inverted: metadata.inverted, operation: metadata.mode });
			report.push({ scopeId: layer.id, propertyPath: location, code: 'mask-mapping', status: 'editable', message: 'Mask path, opacity, inversion and operation remain editable. Pixel-edge and compositing reference qualification in installed AE remains pending.' });
			if (convertedPath.quantizedClock || convertedOpacity.quantizedClock) report.push({ scopeId: layer.id, propertyPath: location, code: 'clock-quantization', status: 'sampled', message: 'Mask key times were rounded to one millionth of a Motion frame; original times remain in custody.' });
		}
	}
	return result;
}
export function exportMotionAeMasks(layer: MotionLayer, scopeId: string, rate: number, report: MotionAeReportEntry[]): readonly Group[] {
	if (!layer.masks.length) return [];
	const children: Group[] = [];
	for (const mask of layer.masks) {
		const location = `masks/${mask.id}`, issue = (message: string) => report.push({ scopeId, propertyPath: location, code: 'mask-mapping', status: 'unsupported', message });
		if (mask.feather.value.some(value => value !== 0) || mask.feather.curves.some(Boolean) || mask.feather.expression?.enabled || mask.expansion.value !== 0 || mask.expansion.curve || mask.expansion.expression?.enabled) {
			issue('Mask feather and expansion require a qualified rendered fallback. Motion Gaussian sigma is not an AE feather radius. This mask stays in original.mscape.'); continue;
		}
		const shape = exportMotionAePath(mask.path, { matchName: 'ADBE Mask Shape', name: 'Mask Path', rate, startFrame: layer.startFrame });
		const opacity = exportMotionAeNumeric(mask.opacity, { matchName: 'ADBE Mask Opacity', name: 'Mask Opacity', rate, startFrame: layer.startFrame, axes: [0], scale: 100, spatial: false });
		if (shape.unsupported || opacity.unsupported || opacity.property.expression?.enabled) { issue(shape.unsupported ?? opacity.unsupported ?? 'Mask opacity expressions are inert; the mask remains in original.mscape.'); continue; }
		const zero = (matchName: string, value: readonly number[]): MotionAeProperty => ({ kind: 'numeric', matchName, name: matchName, value, spatial: false, keys: [], expression: null });
		children.push({ kind: 'group', matchName: 'ADBE Mask Atom', name: mask.id,
			mask: { mode: mask.operation, inverted: mask.inverted, rotoBezier: false, featherFalloff: 'linear', motionBlur: 'off' },
			children: [shape.property, opacity.property, zero('ADBE Mask Feather', [0, 0]), zero('ADBE Mask Offset', [0])] });
		report.push({ scopeId, propertyPath: location, code: 'mask-mapping', status: 'editable', message: 'Mask geometry, opacity, inversion and operation are mapped structurally. Installed AE pixel-edge/reference qualification remains pending.' });
	}
	return [{ kind: 'group', name: 'Masks', matchName: 'ADBE Mask Parade', children }];
}
