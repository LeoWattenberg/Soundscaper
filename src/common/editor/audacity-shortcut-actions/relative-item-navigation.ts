/* SPDX-License-Identifier: AGPL-3.0-only */

import { itemNavigationClipGeometry } from './item-navigation-geometry.ts';
import type { ControllerProject } from '../controller/track-audio/track-domain-types.ts';

/** Compare authored items in one clock before choosing the adjacent item. */
export function relativeNavigationClipId(
	project: ControllerProject | null | undefined,
	selectedClipId: string | null | undefined,
	direction: number,
): string | null {
	if (!project?.clips.length) return null;
	const clips = project.clips.map(clip => ({
		id: clip.id,
		startFrame: itemNavigationClipGeometry(project, clip).timelineStartFrame,
	})).sort((left, right) => left.startFrame - right.startFrame
		|| (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
	const index = Math.max(0, clips.findIndex(clip => clip.id === selectedClipId));
	return clips[Math.max(0, Math.min(clips.length - 1, index + direction))]?.id ?? null;
}
