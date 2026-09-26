/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useRef } from 'react';

interface VideoPreviewProject {
	readonly id?: string;
	readonly tracks?: readonly {
		readonly type?: string;
		readonly clipIds?: readonly string[];
	}[];
}

/** Open the preview for new timeline video, while respecting a later manual close. */
export function useAutoShowVideoPreview(
	project: VideoPreviewProject | null | undefined,
	visible: boolean,
	onShow: () => void,
	enabled: boolean,
): void {
	const seen = useRef<{ projectId: string | null; clipIds: Set<string> }>({
		projectId: null,
		clipIds: new Set(),
	});
	useEffect(() => {
		if (!enabled) return;
		const clipIds = new Set(project?.tracks
			?.filter((track) => track.type === 'video')
			.flatMap((track) => track.clipIds ?? []) ?? []);
		const projectId = project?.id ?? null;
		const previous = seen.current;
		const added = projectId !== previous.projectId
			? clipIds.size > 0
			: [...clipIds].some((id) => !previous.clipIds.has(id));
		seen.current = { projectId, clipIds };
		if (added && !visible) onShow();
	}, [enabled, onShow, project, visible]);
}
