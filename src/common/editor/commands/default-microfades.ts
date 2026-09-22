/* SPDX-License-Identifier: AGPL-3.0-only */

/** Give newly exposed audio edges the same editable fades as the clip controls. */
interface MicrofadeClip {
	readonly id: string;
	readonly kind?: string;
	readonly sourceStartFrame: number;
	readonly sourceDurationFrames: number;
	readonly durationFrames: number;
	readonly fadeInFrames?: number;
	readonly fadeOutFrames?: number;
}

interface MicrofadeProject {
	readonly sampleRate: number;
	readonly clips: readonly MicrofadeClip[];
}

interface MicrofadeDraft extends MicrofadeProject {
	readonly clips: MicrofadeClip[];
}

interface MicrofadeChanges {
	readonly fadeInFrames?: number;
	readonly fadeOutFrames?: number;
}

export const DEFAULT_CLIP_MICROFADE_SECONDS = 0.002;

export function defaultClipMicrofadeChanges(
	before: MicrofadeProject,
	after: MicrofadeProject,
): ReadonlyMap<string, MicrofadeChanges> {
	const previous = new Map(before.clips.map((clip) => [clip.id, clip]));
	const frames = Math.max(1, Math.round(after.sampleRate * DEFAULT_CLIP_MICROFADE_SECONDS));
	const changes = new Map<string, MicrofadeChanges>();
	for (const clip of after.clips) {
		if (clip.kind !== 'audio') continue;
		const old = previous.get(clip.id);
		const exposedStart = !old || clip.sourceStartFrame !== old.sourceStartFrame;
		const exposedEnd = !old
			|| clip.sourceStartFrame + clip.sourceDurationFrames
				!== old.sourceStartFrame + old.sourceDurationFrames;
		const duration = Math.min(frames, Math.floor(clip.durationFrames / 2));
		const update: { fadeInFrames?: number; fadeOutFrames?: number } = {};
		if (duration > 0 && exposedStart && (clip.fadeInFrames ?? 0) === 0) update.fadeInFrames = duration;
		if (duration > 0 && exposedEnd && (clip.fadeOutFrames ?? 0) === 0) update.fadeOutFrames = duration;
		if (Object.keys(update).length > 0) changes.set(clip.id, update);
	}
	return changes;
}

export function applyDefaultClipMicrofades(before: MicrofadeProject, after: MicrofadeDraft): void {
	const changes = defaultClipMicrofadeChanges(before, after);
	for (const [index, clip] of after.clips.entries()) {
		const update = changes.get(clip.id);
		if (update) after.clips[index] = { ...clip, ...update };
	}
}
