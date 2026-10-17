/* SPDX-License-Identifier: AGPL-3.0-only */

import { snapAudioEditorFrameWithProject } from '../../snap-grid.js';
import { fadeField, fadeDurationAtPointer, type FadeClip, type ClipFadeEdge } from './clip-fade-geometry.ts';
import { clipFadePointerEdit } from './clip-fade-edit.ts';

interface FadeSession {
	readonly original: FadeClip;
	readonly edge: ClipFadeEdge;
	readonly initial: number;
	readonly startX: number;
	readonly pixelsPerSecond: number;
	readonly boundaryFrames?: readonly number[];
}

/** Pointer preview and commit deliberately share one frame-based snap calculation. */
export function previewClipFadePointer(session: FadeSession, clientX: number, shiftKey: boolean,
	project: { readonly snap?: { readonly enabled?: boolean } }, sampleRate: number, playheadFrame: number) {
	const clip = session.original;
	if (Math.abs(clientX - session.startX) < 1) return { [fadeField(session.edge)]: session.initial };
	const rawDurationFrames = fadeDurationAtPointer(session.edge, session.initial, session.startX, clientX,
		session.pixelsPerSecond, sampleRate, clip.durationFrames);
	const rawBoundary = clip.timelineStartFrame + (session.edge === 'in' ? rawDurationFrames : clip.durationFrames - rawDurationFrames);
	return clipFadePointerEdit({ clip, edge: session.edge, rawDurationFrames, sampleRate,
		pixelsPerSecond: session.pixelsPerSecond, playheadFrame, gridEnabled: project.snap?.enabled === true,
		gridFrame: Number(snapAudioEditorFrameWithProject(rawBoundary, project, { force: true })),
		shiftKey, boundaryFrames: session.boundaryFrames ?? [],
	});
}
