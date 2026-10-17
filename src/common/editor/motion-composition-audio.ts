/* SPDX-License-Identifier: AGPL-3.0-only */

import type { MotionscaperProject } from './motion-project-types.ts';

/** Retain audio authority even when an enabled placement falls between sampled video frames. */
export function motionCompositionHasAudio(project: MotionscaperProject, compositionId: string): boolean {
	const visited = new Set<string>();
	const visit = (id: string): boolean => {
		if (visited.has(id)) return false; visited.add(id);
		const composition = project.compositions.find((candidate) => candidate.id === id);
		return composition?.audio.some((placement) => placement.enabled) === true || composition?.layers.some((layer) => layer.enabled && (
			layer.kind === 'precomp' ? visit(layer.compositionId)
				: layer.kind === 'footage' && layer.audioEnabled && project.assets.some((asset) => asset.id === layer.assetId && asset.kind === 'footage' && asset.hasAudio)
		)) === true;
	};
	return visit(compositionId);
}
