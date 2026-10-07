/* SPDX-License-Identifier: AGPL-3.0-only */

import { snapAudioEditorFrameWithProject } from '../../snap-grid.js';

interface KeyboardClipMoveProject extends Readonly<Record<string, unknown>> {
	readonly snap?: Readonly<{ enabled?: boolean }>;
}

/** A keyboard move must reach the adjacent snap line rather than round back to its origin. */
export function keyboardClipMoveFrame(project: KeyboardClipMoveProject, startFrame: number, deltaFrames: number): number {
	if (!project.snap?.enabled || !deltaFrames) return Math.max(0, startFrame + deltaFrames);
	const direction = Math.sign(deltaFrames);
	return Number(snapAudioEditorFrameWithProject(Math.max(0, startFrame + direction), project,
		{ mode: direction > 0 ? 'next' : 'previous', minimumFrame: 0 }));
}
