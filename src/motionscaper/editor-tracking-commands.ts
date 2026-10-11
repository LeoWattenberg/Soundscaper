/* SPDX-License-Identifier: AGPL-3.0-only */
import { normalizeMotionscaperProject } from './editor-project-validation.ts';
import { applyMotionscaperCommands, type MotionscaperProjectCommand } from './editor-project-commands.ts';
import type { MotionComposition, MotionLayer } from '../common/editor/motion-composition.ts';
import { createMotionTrackingResult, normalizeMotionTrackingResult, type MotionTrackingResult } from '../common/editor/motion-tracking-contract.ts';
import { admitMotionTrackingResult } from '../common/editor/motion-tracking-authority.ts';
import { motionTrackingApplicationGeometry, motionTrackingGeometryDigest, motionTrackingTargetDigest } from '../common/editor/motion-tracking-admission.ts';
import { normalizeMotionTrackingApplication, type MotionTrackingApplication, type MotionTrackingBaseline } from '../common/editor/motion-tracking-application-contract.ts';
import { motionTrackingStabilization } from '../common/editor/motion-tracking-primitives.ts';
import { motionTransformMatrix, type MotionMatrix4 } from '../common/editor/motion-transform.ts';
import { motionPropertyOfKind, type MotionVector2, type MotionVector3, type MotionVector3Property } from '../common/editor/motion-property.ts';
import { compareRationals, subtractRationals } from '../common/editor/timeline-time.ts';
import { freezeMotionValue, motionId, motionInteger, motionNumber } from '../common/editor/motion-values.ts';
export type MotionscaperTrackingCommand =
	| { readonly type: 'accept'; readonly compositionId: string; readonly result: MotionTrackingResult }
	| { readonly type: 'remove'; readonly compositionId: string; readonly analysisId: string }
	| { readonly type: 'correct'; readonly compositionId: string; readonly analysisId: string; readonly frame: number; readonly points: readonly MotionVector2[] }
	| { readonly type: 'detach'; readonly compositionId: string; readonly targetLayerId: string; readonly kind: MotionTrackingApplication['kind']; readonly effectId?: string }
	| ({ readonly compositionId: string; readonly analysisId: string; readonly targetLayerId: string; readonly replaceAnimation: boolean } & (
		{ readonly type: 'apply-point' } | { readonly type: 'apply-stabilization'; readonly strength: number } | { readonly type: 'apply-corner-pin'; readonly effectId: string }));

/** All derived intent is published through the existing atomic composition replacement/history. */
export function createMotionscaperTrackingCommands(projectValue: unknown, request: MotionscaperTrackingCommand, capabilities: { readonly cornerPin?: boolean } = {}): readonly MotionscaperProjectCommand[] {
	const project = normalizeMotionscaperProject(projectValue); const compositionId = motionId(request.compositionId);
	const composition = project.compositions.find(item => item.id === compositionId); if (!composition) throw new Error('Tracking composition is missing.');
	let next: MotionComposition;
	if (request.type === 'accept') {
		const result = admitMotionTrackingResult(project, request.result, 'new');
		if (result.binding.compositionId !== compositionId) throw new Error('Tracking result belongs to a different composition.');
		next = { ...composition, tracking: [...(composition.tracking ?? []).filter(item => item.id !== result.id), result] };
	} else if (request.type === 'detach') {
		next = { ...composition, trackingApplications: (composition.trackingApplications ?? []).filter(item => !(item.targetLayerId === request.targetLayerId && item.kind === request.kind && item.effectId === (request.effectId ?? null))) };
	} else {
		const stored = composition.tracking?.find(item => item.id === request.analysisId); if (!stored) throw new Error('Tracking analysis is missing; analyze the footage first.');
		if (request.type === 'remove') next = { ...composition, tracking: composition.tracking!.filter(item => item.id !== stored.id) };
		else {
			const result = admitMotionTrackingResult(project, stored, 'persisted');
			if (request.type === 'correct') {
				const frame = motionInteger(request.frame, 'tracking correction frame', result.settings.firstFrame, result.settings.firstFrame + result.settings.frameCount - 1);
				const corrected = createMotionTrackingResult({ id: result.id, binding: result.binding, settings: result.settings,
					samples: result.samples.map(sample => sample.frame === frame ? { frame, status: 'manual', points: request.points, confidence: 1, error: 0 } : sample) });
				next = { ...composition, tracking: composition.tracking!.map(item => item.id === result.id ? corrected : item) };
			} else next = apply(composition, result, request, capabilities);
		}
	}
	const commands: readonly MotionscaperProjectCommand[] = [{ type: 'composition/replace', composition: next }];
	applyMotionscaperCommands(project, commands); return freezeMotionValue(commands);
}
type ApplyRequest = Extract<MotionscaperTrackingCommand, { readonly replaceAnimation: boolean }>;
function apply(composition: MotionComposition, resultValue: MotionTrackingResult, request: ApplyRequest, capabilities: { readonly cornerPin?: boolean }): MotionComposition {
	const result = normalizeMotionTrackingResult(resultValue);
	if (result.samples.some(sample => sample.status === 'lost')) throw new Error('Tracking has lost frames; manually correct each lost frame or reanalyze before applying.');
	const source = composition.layers.find(item => item.id === result.binding.layerId)!; const target = composition.layers.find(item => item.id === request.targetLayerId);
	if (!target) throw new Error('Tracking target layer is missing.');
	const kind: MotionTrackingApplication['kind'] = request.type === 'apply-point' ? 'point' : request.type === 'apply-stabilization' ? 'stabilize' : 'corner-pin';
	if ((kind === 'point' && result.settings.mode !== 'point') || (kind === 'stabilize' && result.settings.mode !== 'stabilize') || (kind === 'corner-pin' && result.settings.mode !== 'planar')) throw new Error('Tracking result mode does not match this application.');
	if (kind === 'corner-pin' && capabilities.cornerPin !== true) throw new Error('Motion corner-pin rendering is unavailable; retain the analysis and enable a qualified corner-pin renderer before applying.');
	if (kind === 'corner-pin' && ['null', 'camera', 'light', 'adjustment'].includes(target.kind)) throw new Error('Corner pin needs a layer with its own rendered pixels; select footage, an image, text, shapes, a solid or a precomposition.');
	if (kind !== 'corner-pin' && composition.trackingApplications?.some(item => item.targetLayerId === target.id && item.kind !== kind && item.kind !== 'corner-pin')) throw new Error('A different tracking application owns the target transform; detach it before applying this track.');
	if (source.parentId !== null || target.parentId !== null || source.is3D || target.is3D) throw new Error('Tracking application currently requires unparented 2D source and target layers; bake their parent/3D transform first.');
	if (compareRationals(result.settings.firstFrame, target.inFrame) < 0 || compareRationals(result.settings.firstFrame, target.startFrame) < 0 || compareRationals(result.settings.firstFrame + result.settings.frameCount - 1, target.outFrame) >= 0) throw new Error('Tracking application range must fit nonnegative target-local frames; trim the analysis range.');
	const effectId = request.type === 'apply-corner-pin' ? motionId(request.effectId) : null;
	const previous = composition.trackingApplications?.find(item => item.targetLayerId === target.id && item.kind === kind && item.effectId === effectId);
	const owned = previous && previous.analysisId === result.id && motionTrackingApplicationGeometry(composition, result, previous);
	if (previous && !owned && !request.replaceAnimation) throw new Error('Tracking target or source geometry changed; detach it or explicitly replace its authored animation.');
	const baseline = owned ? previous.baseline : baselineFor(target);
	const sourceBaseline = source.id === target.id && owned ? baseline : staticBaseline(source);
	const sourceMatrix = matrix(sourceBaseline); matrix(baseline);
	let replacement: MotionLayer;
	if (kind === 'point') {
		if (!owned && !request.replaceAnimation && animated(target.transform.position)) throw new Error('Target position is already animated; choose explicit replacement or another layer.');
		if (animated(target.transform.anchor)) throw new Error('Bake the target anchor animation before applying a point track.');
		const origin = map(sourceMatrix, result.settings.points[0]!);
		const values = result.samples.map(sample => { if (sample.status === 'lost') throw new Error('Unresolved point loss.'); const point = map(sourceMatrix, sample.points[0]!); return [baseline.position[0] + point[0] - origin[0], baseline.position[1] + point[1] - origin[1], baseline.position[2]] as const; });
		replacement = { ...target, transform: { ...target.transform, position: curve3(result, target, values) } };
	} else if (request.type === 'apply-stabilization') {
		if (source.id !== target.id) throw new Error('Stabilization must target the analyzed footage layer.');
		if (!owned && !request.replaceAnimation && [target.transform.position, target.transform.rotation, target.transform.scale].some(animated)) throw new Error('Target transform is already animated; explicitly replace it before stabilizing.');
		if (Math.abs(baseline.scale[0] - baseline.scale[1]) > 1e-9 || baseline.scale[0] <= 0) throw new Error('Similarity stabilization needs uniform positive source scale; bake nonuniform or reflected geometry first.');
		const strength = motionNumber(request.strength, 'stabilization strength', 0, 1);
		const transforms = result.samples.map(sample => {
			if (sample.status === 'lost') throw new Error('Unresolved stabilization loss.');
			const inverse = motionTrackingStabilization(result.settings.points.map((point, index) => ({ source: point, target: sample.points[index]!, confidence: 1 })), strength);
			const angle = baseline.rotation[2] * Math.PI / 180; const scale = baseline.scale[0];
			// Conjugate source-space inverse motion through the original static source transform.
			const c = Math.cos(inverse.rotationRadians) * inverse.scale; const s = Math.sin(inverse.rotationRadians) * inverse.scale;
			const ax = c * baseline.anchor[0] - s * baseline.anchor[1] + inverse.translateX - baseline.anchor[0];
			const ay = s * baseline.anchor[0] + c * baseline.anchor[1] + inverse.translateY - baseline.anchor[1];
			return { position: [baseline.position[0] + scale * (Math.cos(angle) * ax - Math.sin(angle) * ay), baseline.position[1] + scale * (Math.sin(angle) * ax + Math.cos(angle) * ay), baseline.position[2]] as const,
				scale: [baseline.scale[0] * inverse.scale, baseline.scale[1] * inverse.scale, baseline.scale[2]] as const, rotation: [baseline.rotation[0], baseline.rotation[1], baseline.rotation[2] + inverse.rotationRadians * 180 / Math.PI] as const };
		});
		replacement = { ...target, transform: { ...target.transform, position: curve3(result, target, transforms.map(value => value.position)), scale: curve3(result, target, transforms.map(value => value.scale)), rotation: curve3(result, target, transforms.map(value => value.rotation)) } };
	} else {
		staticBaseline(target); const targetMatrix = matrix(baseline);
		const old = target.effects.find(effect => effect.id === effectId);
		if (old && !owned && !request.replaceAnimation) throw new Error('The corner-pin effect identity is already authored; choose explicit replacement or another identity.');
		const names = ['top-left', 'top-right', 'bottom-right', 'bottom-left'];
		const parameters = names.map((id, corner) => ({ id, value: motionPropertyOfKind({ kind: 'vector2', expression: null,
			...vectorCurve(result, target, result.samples.map(sample => { if (sample.status === 'lost') throw new Error('Unresolved planar loss.'); return unmap(targetMatrix, map(sourceMatrix, sample.points[corner]!)); })) }, 'vector2') }));
		const effect = { id: effectId!, type: 'corner-pin', enabled: true, parameters };
		replacement = { ...target, effects: old ? target.effects.map(item => item.id === effectId ? effect : item) : [...target.effects, effect] };
	}
	const layers = composition.layers.map(layer => layer.id === replacement.id ? replacement : layer);
	const resultingSource = layers.find(layer => layer.id === source.id)!;
	const partial = { analysisId: result.id, analysisDigest: result.digest, targetLayerId: target.id, kind, effectId, baseline };
	const application = normalizeMotionTrackingApplication({ ...partial, sourceGeometryDigest: motionTrackingGeometryDigest(resultingSource), targetDigest: motionTrackingTargetDigest(replacement, partial) });
	return { ...composition, layers, trackingApplications: [...(composition.trackingApplications ?? []).filter(item => !(item.targetLayerId === target.id && item.kind === kind && item.effectId === effectId)), application] };
}
function animated(property: MotionVector3Property): boolean { return property.expression !== null || property.curves.some(Boolean); }
function baselineFor(layer: MotionLayer): MotionTrackingBaseline { const { anchor, position, scale, rotation } = layer.transform; return { anchor: anchor.value, position: position.value, scale: scale.value, rotation: rotation.value }; }
function staticBaseline(layer: MotionLayer): MotionTrackingBaseline {
	if ([layer.transform.anchor, layer.transform.position, layer.transform.scale, layer.transform.rotation].some(animated)) throw new Error('Tracking projection requires a static 2D source/target transform; bake animated geometry first.');
	return baselineFor(layer);
}
function matrix(baseline: MotionTrackingBaseline): MotionMatrix4 {
	if (baseline.rotation[0] !== 0 || baseline.rotation[1] !== 0 || baseline.position[2] !== 0 || baseline.anchor[2] !== 0 || baseline.scale[2] !== 1 || Math.abs(baseline.scale[0] * baseline.scale[1]) < 1e-12) throw new Error('Tracking application requires a nonsingular 2D transform; bake unsupported geometry first.');
	return motionTransformMatrix({ ...baseline, opacity: 1 });
}
function map(matrix: MotionMatrix4, point: MotionVector2): MotionVector2 { return [matrix[0] * point[0] + matrix[4] * point[1] + matrix[12], matrix[1] * point[0] + matrix[5] * point[1] + matrix[13]]; }
function unmap(matrix: MotionMatrix4, point: MotionVector2): MotionVector2 { const x = point[0] - matrix[12]; const y = point[1] - matrix[13]; const determinant = matrix[0] * matrix[5] - matrix[1] * matrix[4]; return [(matrix[5] * x - matrix[4] * y) / determinant, (matrix[0] * y - matrix[1] * x) / determinant]; }
function vectorCurve(result: MotionTrackingResult, layer: MotionLayer, values: readonly (readonly number[])[]) {
	return { value: values[0]!, curves: values[0]!.map((_, channel) => ({ anchors: values.map((value, index) => ({ position: subtractRationals(result.samples[index]!.frame, layer.startFrame), value: value[channel]! })), segments: values.slice(1).map(() => ({ kind: 'linear' as const })) })) };
}
function curve3(result: MotionTrackingResult, layer: MotionLayer, values: readonly MotionVector3[]): MotionVector3Property { return motionPropertyOfKind({ kind: 'vector3', expression: null, ...vectorCurve(result, layer, values) }, 'vector3'); }
