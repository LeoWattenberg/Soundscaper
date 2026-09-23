/* SPDX-License-Identifier: AGPL-3.0-only */

import { type DragEvent, type RefObject, useCallback, useEffect } from 'react';

import {
	clearActiveTimelineClipDragPayload,
	writeTimelineClipDragPayload,
} from '../../project-bin-dnd.js';

interface TimelineUploadClip {
	readonly id: string;
	readonly kind?: string;
	readonly title?: string;
	readonly name?: string;
}

interface TimelineUploadProject {
	readonly id: string;
	readonly clips: readonly TimelineUploadClip[];
}

/** Turn the existing clip-menu button into a native export handle without changing pointer editing. */
export function useTimelineClipUploadDrag(input: Readonly<{
	readonly project: TimelineUploadProject;
	readonly rootRef: RefObject<HTMLElement | null>;
	readonly viewportRevision: string;
}>) {
	const { project, rootRef, viewportRevision } = input;
	useEffect(() => {
		const root = rootRef.current;
		if (!root) return undefined;
		const decorated: HTMLButtonElement[] = [];
		for (const clipElement of root.querySelectorAll<HTMLElement>('[data-clip-id]')) {
			const clip = project.clips.find((candidate) => (
				String(candidate.id) === clipElement.getAttribute('data-clip-id')
			));
			const handle = clipElement.querySelector<HTMLButtonElement>('.clip-header__menu-button');
			if (!handle || clip?.kind !== 'audio') continue;
			handle.draggable = true;
			handle.dataset.timelineClipUploadDrag = 'true';
			decorated.push(handle);
		}
		return () => {
			for (const handle of decorated) {
				handle.draggable = false;
				delete handle.dataset.timelineClipUploadDrag;
			}
		};
	}, [project.clips, rootRef, viewportRevision]);

	const onDragStart = useCallback((event: DragEvent<HTMLElement>) => {
		const target = event.target instanceof Element ? event.target : null;
		if (!target?.closest('[data-timeline-clip-upload-drag]')) return;
		const clipId = target.closest<HTMLElement>('[data-clip-id]')?.getAttribute('data-clip-id');
		const clip = project.clips.find((candidate) => String(candidate.id) === String(clipId));
		if (clip?.kind !== 'audio'
			|| !writeTimelineClipDragPayload(event.dataTransfer, project.id, { ...clip, kind: clip.kind })) {
			event.preventDefault();
		}
	}, [project]);

	return Object.freeze({
		onDragStart,
		onDragEnd: clearActiveTimelineClipDragPayload,
	});
}
