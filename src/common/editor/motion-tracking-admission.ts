/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MotionComposition, MotionLayer } from './motion-composition.ts';
import { normalizeMotionscaperProject } from './motion-project-validation.ts';
import { motionTrackingDigest, type MotionTrackingResult } from './motion-tracking-contract.ts';
import type { MotionTrackingApplication } from './motion-tracking-application-contract.ts';
import { createMotionTrackingFreshnessChecker } from './motion-tracking-authority.ts';
export interface MotionTrackingDiagnostic { readonly compositionId: string; readonly analysisId: string; readonly targetLayerId: string | null; readonly message: string }
export function motionTrackingGeometryDigest(layer: MotionLayer): string {
	const { anchor, position, scale, rotation } = layer.transform;
	return motionTrackingDigest({ id: layer.id, parentId: layer.parentId, is3D: layer.is3D, startFrame: layer.startFrame, inFrame: layer.inFrame, outFrame: layer.outFrame, anchor, position, scale, rotation });
}
export function motionTrackingTargetDigest(layer: MotionLayer, application: Pick<MotionTrackingApplication, 'kind' | 'effectId' | 'baseline'>): string {
	const authority = { baseline: application.baseline, id: layer.id, parentId: layer.parentId, is3D: layer.is3D, startFrame: layer.startFrame, inFrame: layer.inFrame, outFrame: layer.outFrame, anchor: layer.transform.anchor };
	if (application.kind === 'point') return motionTrackingDigest({ ...authority, position: layer.transform.position });
	if (application.kind === 'stabilize') return motionTrackingDigest({ ...authority, position: layer.transform.position, scale: layer.transform.scale, rotation: layer.transform.rotation });
	const index = layer.effects.findIndex(effect => effect.id === application.effectId);
	if (index < 0) throw new Error('Tracking corner-pin effect is missing; reapply or detach its tracking application.');
	return motionTrackingDigest({ ...authority, transform: { position: layer.transform.position, scale: layer.transform.scale, rotation: layer.transform.rotation },
		// Earlier effects may move the retained local raster origin; preserve their exact order.
		effects: layer.effects.slice(0, index + 1) });
}
export function motionTrackingApplicationGeometry(composition: MotionComposition, result: MotionTrackingResult, application: MotionTrackingApplication): boolean {
	const source = composition.layers.find(layer => layer.id === result.binding.layerId); const target = composition.layers.find(layer => layer.id === application.targetLayerId);
	if (application.kind === 'corner-pin' && !target?.effects.some(effect => effect.id === application.effectId)) return false;
	return Boolean(source && target && motionTrackingGeometryDigest(source) === application.sourceGeometryDigest && motionTrackingTargetDigest(target, application) === application.targetDigest);
}
/** Read-only gate: stale intent stays editable and is never silently rewritten or omitted. */
export function motionTrackingReadiness(projectValue: unknown): readonly MotionTrackingDiagnostic[] {
	const project = normalizeMotionscaperProject(projectValue); const diagnostics: MotionTrackingDiagnostic[] = [];
	const checkFreshness = createMotionTrackingFreshnessChecker(project);
	for (const composition of project.compositions) {
		for (const result of composition.tracking ?? []) {
			const freshness = checkFreshness(result);
			if (freshness.status === 'stale') diagnostics.push({ compositionId: composition.id, analysisId: result.id, targetLayerId: null, message: freshness.reason });
		}
		for (const application of composition.trackingApplications ?? []) {
			const result = composition.tracking?.find(result => result.id === application.analysisId);
			let message: string | null = null;
			try {
				if (!result || result.digest !== application.analysisDigest) message = 'Tracking analysis changed or is missing; reapply the track or detach this application before preview/export.';
				else if (!motionTrackingApplicationGeometry(composition, result, application)) message = 'Applied tracking geometry was edited; reapply the track or detach the application to keep the manual edit.';
				else if (result.samples.some(sample => sample.status === 'lost')) message = 'Applied tracking contains unresolved loss; correct every lost frame and reapply before preview/export.';
			} catch (error) { message = error instanceof Error ? error.message : 'Tracking application is unavailable; reapply or detach it.'; }
			if (message) diagnostics.push({ compositionId: composition.id, analysisId: application.analysisId, targetLayerId: application.targetLayerId, message });
		}
	}
	return Object.freeze(diagnostics.map(diagnostic => Object.freeze(diagnostic)));
}
export function requireMotionTrackingReady(project: unknown): void { const diagnostics = motionTrackingReadiness(project); if (diagnostics.length) throw new Error(diagnostics.map(diagnostic => diagnostic.message).join(' ')); }
