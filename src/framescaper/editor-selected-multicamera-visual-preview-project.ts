/* SPDX-License-Identifier: AGPL-3.0-only */

import { framescaperProjectForRuntimeConsumersTimelineImage } from './editor-project-timeline-image-runtime.ts';
import type { FramescaperMulticameraGroupSequence } from './editor-project-sequence-multicam.ts';
import {
	validateFramescaperProjectTimelineImage,
	type FramescaperProjectTimelineImage,
} from './editor-project-timeline-image.ts';

type Data = Record<string, unknown>;

/** Give the strict visual plan the active camera while retaining its authored project shape. */
export function materializeFramescaperSelectedMulticameraVisualPreviewProject(
	profile: unknown,
	project: FramescaperProjectTimelineImage,
): FramescaperProjectTimelineImage {
	validateFramescaperProjectTimelineImage(profile, project);
	const groups = project.multicameraGroups as readonly FramescaperMulticameraGroupSequence[];
	if (groups.length === 0) return project;
	const playback = framescaperProjectForRuntimeConsumersTimelineImage(profile, project);
	const activeClips = new Map((playback.clips as readonly Data[]).map((clip) => [String(clip.id), clip]));
	const outputIds = new Set(groups.map((group) => group.outputClipId));
	const draft = structuredClone(project) as unknown as Data;
	draft.clips = (draft.clips as Data[]).map((clip) => {
		if (!outputIds.has(String(clip.id))) return clip;
		const active = activeClips.get(String(clip.id));
		if (!active || active.kind !== 'video') {
			throw new ReferenceError(`Multicamera preview output ${String(clip.id)} is unavailable.`);
		}
		return {
			...clip,
			sourceId: active.sourceId,
			sourceInFrame: active.sourceInFrame,
			sourceFrameCount: active.sourceFrameCount,
		};
	});
	validateFramescaperProjectTimelineImage(profile, draft);
	return draft as unknown as FramescaperProjectTimelineImage;
}
