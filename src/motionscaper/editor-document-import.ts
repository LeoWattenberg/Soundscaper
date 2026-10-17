/* SPDX-License-Identifier: AGPL-3.0-only */
import type { ScapeProjectInput } from '../common/editor/scape-project-input.ts';
import type { MotionscaperProject } from './editor-project-types.ts';
import type { MotionProjectImportState } from './editor-project-store.ts';
import { importMotionscaperArchive } from './editor-scape.ts';
import { normalizeMotionscaperProject } from './editor-project-validation.ts';
import { createMotionTrackingBinding, motionTrackingFreshness } from '../common/editor/motion-tracking-authority.ts';
import { createMotionTrackingResult } from '../common/editor/motion-tracking-contract.ts';

export type MotionArchiveOpenAction = 'import' | 'copy' | 'replace' | 'keep' | 'saved' | 'recover';
export interface MotionArchiveReview {
	readonly incoming: MotionscaperProject; readonly incomingDigest: string;
	readonly existing: (MotionProjectImportState & { readonly active: boolean }) | null;
}
export interface MotionArchiveOpenReceipt {
	readonly projectId: string; readonly action: MotionArchiveOpenAction; readonly bindOriginal: boolean;
}
/** Verify all original bytes without staging or publishing anything while the user reviews a collision. */
export async function inspectMotionArchive(input: ScapeProjectInput): Promise<MotionscaperProject | null> {
	const result = await importMotionscaperArchive(input, () => ({
		writeAssetChunk: () => Promise.resolve(), finishAsset: () => Promise.resolve(),
		commit: () => Promise.resolve(), rollback: () => Promise.resolve(),
	}));
	return result.kind === 'current' ? result.project : null;
}
/** New project ownership retains authored IDs and original interchange custody; fresh tracking keeps identical source authority. */
export function copyMotionArchiveProject(input: MotionscaperProject, id: string): MotionscaperProject {
	const base = normalizeMotionscaperProject({ ...input, id, compositions: input.compositions.map(({ tracking: _tracking, trackingApplications: _applications, ...composition }) => composition) });
	return normalizeMotionscaperProject({ ...base, compositions: input.compositions.map(composition => {
		const tracking = composition.tracking?.map(result => {
			// Stale analyses must remain stale; only already-valid source bindings can be reassigned without fresh analysis.
			const fresh = motionTrackingFreshness(input, result).status === 'fresh';
			const expected = fresh ? createMotionTrackingBinding(base, composition.id, result.binding.layerId, result.settings) : null;
			return createMotionTrackingResult({ id: result.id, settings: result.settings, samples: result.samples,
				binding: { ...result.binding, projectId: id, ...(expected ? { sourceDigest: expected.sourceDigest } : {}) } });
		});
		const trackingApplications = composition.trackingApplications?.map(application => {
			const old = composition.tracking?.find(result => result.id === application.analysisId), next = tracking?.find(result => result.id === application.analysisId);
			return old && next && old.digest === application.analysisDigest ? { ...application, analysisDigest: next.digest } : application;
		});
		return { ...composition, ...(tracking ? { tracking } : {}), ...(trackingApplications ? { trackingApplications } : {}) };
	}) });
}
