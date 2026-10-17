/* SPDX-License-Identifier: AGPL-3.0-only */
import { parseMotionAeShapeProfile, type MotionAeShapeProfile, type MotionAeShapeProfileHost } from './motion-ae-host-shape-profile.ts';
import { stringifyMotionAeHostJson } from './motion-ae-host-json.ts';
export interface MotionAeCalibrationProperty {
	name: string; readonly matchName: string; readonly numProperties: number; readonly numKeys: number;
	readonly value: unknown; readonly expressionEnabled: boolean; readonly canSetEnabled: boolean; enabled: boolean;
	property(name: string | number): MotionAeCalibrationProperty | null; addProperty(matchName: string): MotionAeCalibrationProperty; setValue(value: unknown): void;
}
export interface MotionAeCalibrationLayer { name: string; property(name: string): MotionAeCalibrationProperty | null }
export interface MotionAeCalibrationComposition {
	comment: string; readonly numLayers: number; readonly layers: { addShape(): MotionAeCalibrationLayer };
	layer(index: number): MotionAeCalibrationLayer; remove(): void; openInViewer(): unknown;
}
export interface MotionAeCalibrationHost {
	readonly identity: MotionAeShapeProfileHost;
	begin(): void; end(): void; create(): MotionAeCalibrationComposition; shape(): unknown;
}
const names = [
	'1 Fill: Non-Zero Winding; Path: original direction',
	'2 Fill: Even-Odd; Path: click Reverse Path Direction once',
	'3 Stroke: Butt Cap; Miter Join; Miter Limit 4',
	'4 Stroke: Round Cap; Round Join; Miter Limit 4',
	'5 Stroke: Projecting Cap; Bevel Join; Miter Limit 4',
];
const layerName = 'Review each named group; all Blend Modes must be Normal';
export const MOTION_AE_SHAPE_REVIEW = 'In the new Motionscaper Shape Style Review composition, expand the five named groups. Set each group and its fill/stroke Blend Mode to Normal. Set Fill 1 to Non-Zero Winding and Fill 2 to Even-Odd. Leave Path 1 direction unchanged; click Reverse Path Direction once for Path 2. Set the three stroke Cap/Join choices exactly as their group names specify (Projecting Cap means square). Do not add, rename or delete groups. Then keep this composition active and run Motionscaper-Capture-Shape-Profile.jsx. Review against the labels in your installed AE UI; cancel if any control is unavailable. This calibrates dropdown meanings only, not rendering equivalence.';
function marker(identity: MotionAeShapeProfileHost): string { return 'org.motionscaper.ae-shape-calibration/1\n' + stringifyMotionAeHostJson(identity); }
function property(parent: { property(name: string | number): MotionAeCalibrationProperty | null }, name: string | number): MotionAeCalibrationProperty {
	const value = parent.property(name); if (!value) throw new Error('Shape calibration control is unavailable: ' + String(name)); return value;
}
function enabled(group: MotionAeCalibrationProperty): void { if (!group.canSetEnabled) throw new Error('Shape calibration requires visible enable switches.'); group.enabled = true; }
/** Called only by the separate preparation entry. Mutates one newly owned composition; never existing project items. */
export function prepareMotionAeShapeCalibration(host: MotionAeCalibrationHost): MotionAeCalibrationComposition {
	host.begin(); let comp: MotionAeCalibrationComposition | undefined, ended = false;
	try {
		comp = host.create(); comp.comment = marker(host.identity); const layer = comp.layers.addShape(); layer.name = layerName;
		const root = property(layer, 'ADBE Root Vectors Group'); if (root.numProperties !== 0) throw new Error('New calibration shape layer unexpectedly contains content.');
		for (let index = 0; index < names.length; index++) {
			root.addProperty('ADBE Vector Group'); const group = property(root, index + 1); group.name = names[index]!; enabled(group);
			const contents = property(group, 'ADBE Vectors Group'); contents.addProperty('ADBE Vector Shape - Group');
			const path = property(contents, 1); enabled(path); property(path, 'ADBE Vector Shape').setValue(host.shape());
			contents.addProperty(index < 2 ? 'ADBE Vector Graphic - Fill' : 'ADBE Vector Graphic - Stroke');
			const paint = property(contents, 2); enabled(paint);
			if (index >= 2) { property(paint, 'ADBE Vector Stroke Width').setValue(8); property(paint, 'ADBE Vector Stroke Miter Limit').setValue(4); }
		}
		comp.openInViewer(); host.end(); ended = true; return comp;
	} catch (error) {
		const failures: string[] = [];
		if (comp) try { comp.remove(); } catch (cleanup) { failures.push(String(cleanup)); }
		if (!ended) try { host.end(); } catch (cleanup) { failures.push(String(cleanup)); }
		if (failures.length) { const failure = new Error('Shape calibration failed: ' + String(error) + '; owned cleanup failed: ' + failures.join('; '), { cause: error }); failure.cause = error; throw failure; } throw error;
	}
}
function popup(group: MotionAeCalibrationProperty, name: string): number {
	const item = property(group, name), value = item.value;
	if (item.numKeys !== 0 || item.expressionEnabled || typeof value !== 'number' || !isFinite(value) || value < 0 || value > 1_000_000_000 || value !== Math.floor(value)) throw new Error('Shape calibration popup is animated, unavailable or invalid: ' + name);
	return value;
}
/** Reads only the generated sample groups after the caller obtains explicit label-review confirmation. */
export function captureMotionAeShapeCalibration(comp: MotionAeCalibrationComposition, identity: MotionAeShapeProfileHost, reviewed: boolean): MotionAeShapeProfile {
	if (reviewed !== true || comp.comment !== marker(identity) || comp.numLayers !== 1) throw new Error('Choose the owned calibration composition for this exact AE host and confirm its reviewed labels.');
	const layer = comp.layer(1); if (layer.name !== layerName) throw new Error('Shape calibration sample layer changed.');
	const root = property(layer, 'ADBE Root Vectors Group'); if (root.numProperties !== names.length) throw new Error('Shape calibration sample inventory changed.');
	const groups: number[] = [], blends: number[] = [], fills: number[] = [], caps: number[] = [], joins: number[] = [], paths: number[] = [];
	for (let index = 0; index < names.length; index++) {
		const group = property(root, index + 1); if (group.matchName !== 'ADBE Vector Group' || group.name !== names[index] || !group.enabled) throw new Error('Shape calibration sample group changed.');
		const contents = property(group, 'ADBE Vectors Group'); if (contents.numProperties !== 2) throw new Error('Shape calibration content inventory changed.');
		const path = property(contents, 1), paint = property(contents, 2);
		if (path.matchName !== 'ADBE Vector Shape - Group' || !path.enabled || paint.matchName !== (index < 2 ? 'ADBE Vector Graphic - Fill' : 'ADBE Vector Graphic - Stroke') || !paint.enabled) throw new Error('Shape calibration sample paint changed.');
		groups.push(popup(group, 'ADBE Vector Blend Mode')); blends.push(popup(paint, 'ADBE Vector Blend Mode'));
		if (index < 2) { fills.push(popup(paint, 'ADBE Vector Fill Rule')); paths.push(popup(path, 'ADBE Vector Shape Direction')); }
		else { caps.push(popup(paint, 'ADBE Vector Stroke Line Cap')); joins.push(popup(paint, 'ADBE Vector Stroke Line Join')); if (popup(paint, 'ADBE Vector Stroke Miter Limit') !== 4) throw new Error('Review Miter Limit 4 for every sample stroke.'); }
	}
	for (let index = 1; index < groups.length; index++) if (groups[index] !== groups[0]) throw new Error('Review Normal blend mode on every sample group.');
	if (blends[0] !== blends[1] || blends[2] !== blends[3] || blends[2] !== blends[4]) throw new Error('Review Normal blend mode on every sample paint.');
	return parseMotionAeShapeProfile(stringifyMotionAeHostJson({ format: 'org.motionscaper.ae-shape-profile', version: 1, host: identity, reviewed: true,
		mapping: { groupNormal: groups[0], fillNormal: blends[0], strokeNormal: blends[2], fillNonzero: fills[0], fillEvenodd: fills[1],
			capButt: caps[0], capRound: caps[1], capSquare: caps[2], joinMiter: joins[0], joinRound: joins[1], joinBevel: joins[2], pathForward: paths[0], pathReversed: paths[1] } }), identity);
}
