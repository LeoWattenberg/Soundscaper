/* SPDX-License-Identifier: AGPL-3.0-only */

import { rebindFramescaperVisualSourceIdentitiesVisual } from './editor-project-visual-source-rebind.ts';

/** Follow Scape collision remaps through every finishing-owned source reference. */
export function rebindFramescaperSourceIdentitiesFinishing(
	project: Record<string, unknown>,
	sourceIdMap: ReadonlyMap<string, string>,
): void {
	rebindFramescaperVisualSourceIdentitiesVisual(project, sourceIdMap);
	if (![...sourceIdMap].some(([before, after]) => before !== after)) return;
	for (const field of ['videoSourceColorInterpretations', 'videoProcessorStacks', 'videoMotionAnalyses']) {
		if (!Array.isArray(project[field])) continue;
		project[field] = (project[field] as Record<string, unknown>[]).map((value) => ({
			...value,
			sourceId: sourceIdMap.get(String(value.sourceId)) ?? value.sourceId,
		}));
	}
	if (!Array.isArray(project.videoVisualPresentations)) return;
	project.videoVisualPresentations = (project.videoVisualPresentations as Record<string, unknown>[])
		.map((value) => {
			const owner = value.owner as Record<string, unknown> | undefined;
			if (owner?.kind !== 'source' && owner?.kind !== 'generator') return value;
			return {
				...value,
				owner: { ...owner, id: sourceIdMap.get(String(owner.id)) ?? owner.id },
			};
		});
}
