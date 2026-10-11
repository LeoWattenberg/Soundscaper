/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MotionAeLayer, MotionAeReportEntry } from './motion-ae-exchange-types.ts';
import { convertMotionAeNumericProperty } from './motion-ae-property-conversion.ts';
import type { MotionTransform } from './motion-composition.ts';
import type { Rational } from './timeline-time.ts';

export function convertMotionAeTransform(layer: MotionAeLayer, frameRate: Rational, base: MotionTransform, report: MotionAeReportEntry[], durationFrames: number): MotionTransform {
	let transform = base;
	const reportUnsupported = (path: string, message: string) => { report.push({ scopeId: layer.id, propertyPath: path, status: 'unsupported', code: 'property-mapping', message }); };
	if (!layer.properties.some((property) => property.matchName === 'ADBE Transform Group')) reportUnsupported('', 'The exchange has no captured transform group. Default Motion transforms are used in this partial draft.');
	for (let rootIndex = 0; rootIndex < layer.properties.length; rootIndex++) {
		const group = layer.properties[rootIndex]!, root = `${String(rootIndex)}:${group.matchName}`;
		if (group.kind === 'group' && group.children.length === 0) continue;
		if (group.matchName === 'ADBE Root Vectors Group' && layer.kind === 'shape') continue; // Shape conversion owns its report.
		if (group.matchName === 'ADBE Text Properties' && layer.kind === 'text') continue; // Text conversion owns its report.
		if (group.matchName === 'ADBE Mask Parade') continue; // The mask converter owns its admission and report.
		if (group.matchName !== 'ADBE Transform Group' || group.kind !== 'group') {
			reportUnsupported(root, 'This property group remains in the original exchange. Render the complete composition in AE to retain its appearance.'); continue;
		}
		const names = new Set<string>();
		for (let index = 0; index < group.children.length; index++) {
			const property = group.children[index]!, path = `${root}/${String(index)}:${property.matchName}`;
			if (names.has(property.matchName)) { reportUnsupported(path, 'Duplicate transform identity is not mapped.'); continue; }
			names.add(property.matchName);
			if (property.kind !== 'numeric') { reportUnsupported(path, 'This transform requires numeric conversion or AE rendering.'); continue; }
			const name = property.matchName;
			if (property.samples) {
				const samples = property.samples, rate = frameRate.num / frameRate.den;
				const begin = samples.firstFrame / samples.frameRate, end = (samples.firstFrame + samples.values.length - 1) / samples.frameRate;
				if (begin > Math.max(0, layer.inPoint) || end < Math.min(durationFrames / rate, layer.outPoint)) {
					reportUnsupported(path, 'AE samples do not cover this layer’s active composition range. Export a complete sampled composition before mapping this property.'); continue;
				}
			}
			if (['ADBE Orientation', 'ADBE Rotate X', 'ADBE Rotate Y'].includes(name) && property.keys.length === 0 && !property.expression?.enabled && !property.samples && property.value.every((value) => value === 0)) continue;
			const field = name === 'ADBE Anchor Point' ? 'anchor' : name === 'ADBE Position' ? 'position' : name === 'ADBE Scale' ? 'scale'
				: name === 'ADBE Rotate Z' ? 'rotation' : name === 'ADBE Opacity' ? 'opacity' : null;
			if (!field) { reportUnsupported(path, 'This transform or separated channel needs an explicit mapping; sample or render in AE.'); continue; }
			const options = field === 'opacity' ? { axes: [0], defaults: [1], scale: 0.01 }
				: field === 'rotation' ? { axes: [null, null, 0], defaults: [0, 0, 0], scale: 1 }
					: { axes: [0, 1, property.value.length === 3 ? 2 : null], defaults: field === 'scale' ? [1, 1, 1] : [0, 0, 0], scale: field === 'scale' ? 0.01 : 1 };
			const converted = convertMotionAeNumericProperty(property, { frameRate, ...options });
			report.push({ scopeId: layer.id, propertyPath: path, status: converted.status, code: 'numeric-mapping', message: converted.message });
			if (converted.quantizedClock) report.push({ scopeId: layer.id, propertyPath: path, status: 'sampled', code: 'clock-quantization', message: 'AE floating key times were rounded to one millionth of a Motion frame; original times remain in the exchange.' });
			if (converted.property?.kind === 'scalar' && field === 'opacity') transform = { ...transform, opacity: converted.property };
			else if (converted.property?.kind === 'vector3' && field !== 'opacity') transform = { ...transform, [field]: converted.property };
		}
	}
	return transform;
}
