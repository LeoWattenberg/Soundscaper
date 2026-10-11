/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MotionAeLayer, MotionAeProperty, MotionAeReportEntry, MotionAeSceneMetadata } from './motion-ae-exchange-types.ts';
import type { MotionLayer, MotionLayerContent, MotionTransform } from './motion-composition.ts';
import { convertMotionAeNumericProperty, motionAeBoundedClock } from './motion-ae-property-conversion.ts';
import { exportMotionAeNumeric } from './motion-ae-export-property.ts';
import { normalizeMotionAeProperties } from './motion-ae-property-custody.ts';
import { motionColor, motionScalar, motionVector, type MotionScalarProperty } from './motion-property.ts';
import { decodeMotionChannel, encodeMotionChannel } from './motion-surface.ts';
import { motionEnum, motionRecord } from './motion-values.ts';
import type { Rational } from './timeline-time.ts';

type Numeric = Extract<MotionAeProperty, { kind: 'numeric' }>;
export interface MotionAeSceneReview { readonly scene?: { readonly colorSpace: 'linear-rec709-d65' | 'srgb' } }
export interface MotionAeSceneConversion { readonly content: MotionLayerContent; readonly transform: MotionTransform }
export interface MotionAeSceneExport { readonly scene: MotionAeSceneMetadata; readonly properties: readonly MotionAeProperty[] }
const differences = 'Camera/light parameters remain editable, but AE projection, clipping, light/material response and working-space appearance are not qualified against Motion. Compare a rendered reference. Motion uses near 0.1 and far 10000000; inactive AE depth-of-field settings remain in original custody.';
function review(options: MotionAeSceneReview): 'linear-rec709-d65' | 'srgb' {
	if (!options.scene) throw new Error('Enable structural camera/light review and choose the source/destination light color interpretation before editable scene conversion.');
	const value = motionRecord(options.scene, ['colorSpace'], 'AE scene review');
	return motionEnum(value.colorSpace, ['linear-rec709-d65', 'srgb'], 'AE scene light color space');
}
function issue(report: MotionAeReportEntry[], id: string, message: string): null { report.push({ scopeId: id, propertyPath: '', status: 'unsupported', code: 'scene-mapping', message }); return null; }
function identity(): MotionTransform { return { anchor: motionVector([0, 0, 0]), position: motionVector([0, 0, 0]), scale: motionVector([1, 1, 1]), rotation: motionVector([0, 0, 0]), opacity: motionScalar(1) }; }
function group(name: string, children: readonly MotionAeProperty[]): MotionAeProperty { return { kind: 'group', matchName: name, name, children }; }
function numeric(name: string, value: readonly number[]): Numeric { return { kind: 'numeric', matchName: name, name, value, keys: [], expression: null, spatial: false }; }
function numericMap(properties: readonly MotionAeProperty[], groupName: string): Map<string, Numeric> {
	const groups = properties.filter(property => property.matchName === groupName), source = groups[0];
	if (groups.length !== 1 || source?.kind !== 'group') throw new Error(`Exactly one captured ${groupName} is required.`);
	const values = new Map<string, Numeric>();
	for (const property of source.children) {
		if (property.kind !== 'numeric' || values.has(property.matchName)) throw new Error('Scene properties require unique captured numeric values.');
		values.set(property.matchName, property);
	} return values;
}
function required(values: Map<string, Numeric>, name: string, size: number): Numeric {
	const value = values.get(name); if (!value || value.value.length !== size) throw new Error(`Captured ${name} requires ${String(size)} dimensions.`); return value;
}
function fixed(value: Numeric, expected?: readonly number[]): boolean {
	return !value.keys.length && !value.samples && !value.expression?.enabled && (!expected || value.value.length === expected.length && value.value.every((number, axis) => number === expected[axis]));
}
function scalar(source: Numeric, rate: Rational, scale: number, minimum: number, maximum: number): MotionScalarProperty {
	if (source.value.length !== 1 || source.samples || source.expression?.enabled || [source.value, ...source.keys.map(key => key.value)].some(value => value[0]! * scale < minimum || value[0]! * scale > maximum)) throw new Error('This scene scalar requires finite in-range values and authored hold/linear keys; expressions and frame samples need a separate reviewed mapping.');
	const converted = convertMotionAeNumericProperty(source, { frameRate: rate, axes: [0], defaults: [0], scale });
	if (converted.property?.kind !== 'scalar') throw new Error(converted.message); return converted.property;
}
function cameraTransform(properties: readonly MotionAeProperty[], rate: Rational): MotionTransform {
	const values = numericMap(properties, 'ADBE Transform Group');
	for (const name of values.keys()) if (!['ADBE Anchor Point', 'ADBE Position', 'ADBE Point of Interest', 'ADBE Scale', 'ADBE Orientation', 'ADBE Rotate X', 'ADBE Rotate Y', 'ADBE Rotate Z', 'ADBE Opacity'].includes(name)) throw new Error('This camera transform contains an unsupported or separated channel.');
	for (const [name, expected] of [['ADBE Orientation', [0, 0, 0]], ['ADBE Rotate X', [0]], ['ADBE Rotate Y', [0]]] as const) if (!fixed(required(values, name, expected.length), expected)) throw new Error('The editable camera subset requires neutral orientation and X/Y rotation; retain point-of-interest or tilted cameras as rendered fallback.');
	for (const [name, expected] of [['ADBE Anchor Point', [0, 0, 0]], ['ADBE Scale', [100, 100, 100]], ['ADBE Opacity', [100]]] as const) {
		const value = values.get(name); if (value && !fixed(value, expected)) throw new Error('The editable camera subset requires zero anchor, unit scale and full opacity.');
	}
	const source = required(values, 'ADBE Position', 3);
	if (source.samples || source.expression?.enabled) throw new Error('Camera position expressions and samples need an explicit scene sampling mapping.');
	const position = convertMotionAeNumericProperty(source, { frameRate: rate, axes: [0, 1, 2], defaults: [0, 0, 0], scale: 1 });
	if (position.property?.kind !== 'vector3') throw new Error(position.message);
	const roll = scalar(required(values, 'ADBE Rotate Z', 1), rate, 1, -1e9, 1e9);
	return { ...identity(), position: position.property, rotation: { kind: 'vector3', value: [0, 0, roll.value], curves: [null, null, roll.curve], expression: null } };
}
/** A deliberately closed structural subset. The report is required even on success. */
export function convertMotionAeSceneLayer(layer: MotionAeLayer, rate: Rational, options: MotionAeSceneReview, report: MotionAeReportEntry[]): MotionAeSceneConversion | null {
	try {
		const colorSpace = review(options);
		if ((layer.kind !== 'camera' && layer.kind !== 'light') || layer.parentId !== null || layer.matte || layer.adjustment || layer.scene?.autoOrient !== 'none') throw new Error('Editable scenes require an unparented camera/light with explicitly captured NO_AUTO_ORIENT and no matte or adjustment semantics.');
		const properties = normalizeMotionAeProperties(layer.properties, { properties: 0, keys: 0 });
		const groupName = layer.kind === 'camera' ? 'ADBE Camera Options Group' : 'ADBE Light Options Group';
		for (const property of properties) if (property.matchName !== 'ADBE Transform Group' && property.matchName !== groupName && (property.kind !== 'group' || property.children.length)) throw new Error('This scene layer contains additional effects, materials or other unsupported controls. Render the original scene.');
		const values = numericMap(properties, groupName); let result: MotionAeSceneConversion;
		if (layer.kind === 'camera') {
			if (!fixed(required(values, 'ADBE Camera Depth of Field', 1), [0])) throw new Error('Enabled or animated AE depth of field requires rendered fallback.');
			const known = ['ADBE Camera Zoom', 'ADBE Camera Depth of Field', 'ADBE Camera Focus Distance', 'ADBE Camera Aperture', 'ADBE Camera Blur Level', 'ADBE Iris Shape', 'ADBE Iris Rotation', 'ADBE Iris Roundness', 'ADBE Iris Aspect Ratio', 'ADBE Iris Diffraction Fringe', 'ADBE Iris Highlight Gain', 'ADBE Iris Highlight Threshold', 'ADBE Iris Hightlight Saturation'];
			for (const name of values.keys()) if (!known.includes(name)) throw new Error('This camera option has no structural mapping.');
			result = { content: { kind: 'camera', projection: 'perspective', zoom: scalar(required(values, 'ADBE Camera Zoom', 1), rate, 1, 1e-6, 1e9), near: 0.1, far: 1e7,
				focusDistance: scalar(required(values, 'ADBE Camera Focus Distance', 1), rate, 1, 0, 1e9), aperture: motionScalar(0) }, transform: cameraTransform(properties, rate) };
		} else {
			if (layer.scene.lightType !== 'ambient') throw new Error('This editable light subset requires the captured SDK AMBIENT type. Point/spot falloff, parallel, environment and shadow semantics require a separate mapping or rendered fallback.');
			for (const name of values.keys()) if (!['ADBE Light Color', 'ADBE Light Intensity'].includes(name)) throw new Error('This ambient light exposes additional unsupported controls.');
			const color = values.get('ADBE Light Color');
			if (!color || ![3, 4].includes(color.value.length) || !fixed(color) || color.value.some(value => value < 0 || value > 1) || color.value.length === 4 && color.value[3] !== 1) throw new Error('Ambient light color requires static opaque SDR RGB; animated or translucent colors need a separate mapping.');
			const rgb = color.value.slice(0, 3).map(value => colorSpace === 'srgb' ? decodeMotionChannel(value, 'srgb') : value);
			result = { content: { kind: 'light', lightType: 'ambient', color: motionColor([rgb[0]!, rgb[1]!, rgb[2]!, 1]), intensity: scalar(required(values, 'ADBE Light Intensity', 1), rate, 0.01, 0, 64), coneAngle: motionScalar(90), coneFeather: motionScalar(0), castsShadows: false }, transform: identity() };
		}
		if (properties.some(root => root.kind === 'group' && root.children.some(property => property.kind === 'numeric' && property.keys.some(key => motionAeBoundedClock(key.time * rate.num / rate.den).quantized)))) report.push({ scopeId: layer.id, propertyPath: '', status: 'sampled', code: 'clock-quantization', message: 'AE floating key times were rounded to the bounded one-millionth Motion frame. Original times remain in custody.' });
		report.push({ scopeId: layer.id, propertyPath: groupName, status: 'editable', code: 'scene-parameters', message: 'The admitted camera or ambient-light parameters and hold/linear keys remain editable. Ambient spatial controls have no lighting effect and use identity transforms.' },
			{ scopeId: layer.id, propertyPath: '', status: 'unsupported', code: 'scene-renderer-differences', message: differences }); return result;
	} catch (error) { return issue(report, layer.id, error instanceof Error ? error.message : String(error)); }
}
function fixedMotion(property: MotionScalarProperty, expected: number): boolean { return property.value === expected && !property.curve && !property.expression?.enabled; }
export function exportMotionAeSceneLayer(layer: MotionLayer, rate: Rational, options: MotionAeSceneReview, report: MotionAeReportEntry[]): MotionAeSceneExport | null {
	try {
		const colorSpace = review(options);
		if ((layer.kind !== 'camera' && layer.kind !== 'light') || layer.parentId !== null || layer.matte || layer.masks.length || layer.effects.some(effect => effect.enabled)) throw new Error('Editable camera/light export requires no parent, matte, mask or enabled effects.');
		const exportNumeric = (property: Parameters<typeof exportMotionAeNumeric>[0], name: string, axes: readonly number[], scale = 1, spatial = false): Numeric => {
			if (property.expression?.enabled) throw new Error('Scene expressions require an explicit scene expression mapping.');
			const result = exportMotionAeNumeric(property, { matchName: name, name, axes, scale, spatial, rate: rate.num / rate.den, startFrame: layer.startFrame });
			if (result.unsupported) throw new Error(result.unsupported); return result.property;
		};
		let properties: readonly MotionAeProperty[], scene: MotionAeSceneMetadata = { autoOrient: 'none' };
		if (layer.kind === 'camera') {
			const { anchor, scale, rotation, opacity } = layer.transform;
			if (layer.projection !== 'perspective' || !fixedMotion(layer.aperture, 0) || anchor.value.some(value => value !== 0) || anchor.curves.some(Boolean) || anchor.expression?.enabled
				|| scale.value.some(value => value !== 1) || scale.curves.some(Boolean) || scale.expression?.enabled || !fixedMotion(opacity, 1)
				|| rotation.value[0] !== 0 || rotation.value[1] !== 0 || rotation.curves[0] || rotation.curves[1]) throw new Error('Editable AE cameras require perspective projection, zero aperture/anchor, unit scale/full opacity and Z roll only.');
			const transform = group('ADBE Transform Group', [exportNumeric(layer.transform.position, 'ADBE Position', [0, 1, 2], 1, true), numeric('ADBE Orientation', [0, 0, 0]), numeric('ADBE Rotate X', [0]), numeric('ADBE Rotate Y', [0]), exportNumeric(rotation, 'ADBE Rotate Z', [2])]);
			properties = [transform, group('ADBE Camera Options Group', [exportNumeric(layer.zoom, 'ADBE Camera Zoom', [0]), numeric('ADBE Camera Depth of Field', [0]), exportNumeric(layer.focusDistance, 'ADBE Camera Focus Distance', [0])])];
		} else {
			if (layer.lightType !== 'ambient' || layer.castsShadows || layer.color.expression?.enabled || layer.color.curves.some(Boolean) || layer.color.value[3] !== 1 || layer.color.value.some(value => value < 0 || value > 1)) throw new Error('Editable AE lights currently require ambient, no shadows and static opaque SDR color.');
			const rgb = layer.color.value.slice(0, 3).map(value => colorSpace === 'srgb' ? encodeMotionChannel(value, 'srgb') : value);
			scene = { autoOrient: 'none', lightType: 'ambient' }; properties = [group('ADBE Transform Group', []), group('ADBE Light Options Group', [numeric('ADBE Light Color', [...rgb, 1]), exportNumeric(layer.intensity, 'ADBE Light Intensity', [0], 100)])];
		}
		// Reuse the independent import boundary to reject out-of-range values and unsupported temporal semantics before host publication.
		const probe: MotionAeLayer = { id: layer.id, name: layer.name, kind: layer.kind, sourceId: null, parentId: null, matte: null, startTime: 0, inPoint: 0, outPoint: 1, stretch: 100, enabled: layer.enabled, threeD: true, adjustment: false, blendMode: 'normal', scene, properties };
		if (!convertMotionAeSceneLayer(probe, rate, options, [])) throw new Error('The scene values or key interpolation exceed the editable camera/light subset.');
		report.push({ scopeId: layer.id, propertyPath: '', status: 'editable', code: 'scene-parameters', message: 'Admitted camera/ambient-light values and authored keys map to SDK-named controls. The host importer must create and verify the corresponding native layer type.' },
			{ scopeId: layer.id, propertyPath: '', status: 'unsupported', code: 'scene-renderer-differences', message: differences }); return { scene, properties };
	} catch (error) { return issue(report, layer.id, error instanceof Error ? error.message : String(error)); }
}
