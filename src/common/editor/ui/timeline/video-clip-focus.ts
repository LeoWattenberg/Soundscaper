/* SPDX-License-Identifier: AGPL-3.0-only */

import { focusFirst } from './timeline-navigation.js';

/** Picture clips and their fade handles form one track-scoped Tab sequence. */
export function focusAdjacentVideoClip(root: ParentNode | null, clipId: string, direction: -1 | 1): boolean {
	const clips = [...root?.querySelectorAll<HTMLElement>('[data-clip-id]') ?? []]
		.filter(clip => clip.getAttribute('role') === 'group');
	const index = clips.findIndex(clip => clip.dataset.clipId === clipId);
	const next = clips[index + direction];
	if (index < 0 || !next) return false;
	const handle = direction === -1
		? [...next.querySelectorAll<HTMLButtonElement>('[data-video-clip-fade-handle]')].filter(handle => !handle.disabled).at(-1) : null;
	return focusFirst(handle ?? next);
}
