/* SPDX-License-Identifier: AGPL-3.0-only */

interface PunchTransitionClip {
	readonly timelineStartFrame: number;
	readonly durationFrames: number;
}

interface PunchTransitionRange {
	readonly startFrame: number;
	readonly endFrame: number;
}

interface PunchTransitionRequest {
	readonly transitionInFrames?: number;
	readonly transitionOutFrames?: number;
}

function boundedFrames(value: unknown, durationFrames: number): number {
	if (value === undefined) return 0;
	if (!Number.isSafeInteger(value) || (value as number) < 0) {
		throw new RangeError('Punch transition frames must be a nonnegative safe integer.');
	}
	return Math.min(value as number, Math.floor((durationFrames - 1) / 2));
}

/** Keep only unambiguous old material under each edge of a recorded punch. */
export function punchTransitionCutRange(
	range: PunchTransitionRange,
	clips: readonly PunchTransitionClip[],
	request: PunchTransitionRequest = {},
): PunchTransitionRange & { readonly durationFrames: number } {
	const durationFrames = range.endFrame - range.startFrame;
	const requestedIn = boundedFrames(request.transitionInFrames, durationFrames);
	const requestedOut = boundedFrames(request.transitionOutFrames, durationFrames);
	let startFrame = range.startFrame;
	let endFrame = range.endFrame;
	if (requestedIn > 0) {
		const outgoing = clips.filter((clip) => clip.timelineStartFrame < range.startFrame
			&& clip.timelineStartFrame + clip.durationFrames > range.startFrame);
		if (outgoing.length === 1 && clips.every((clip) => clip === outgoing[0]
			|| clip.timelineStartFrame + clip.durationFrames <= range.startFrame
			|| clip.timelineStartFrame >= range.startFrame + requestedIn)) {
			startFrame += requestedIn;
		}
	}
	if (requestedOut > 0) {
		const incoming = clips.filter((clip) => clip.timelineStartFrame < range.endFrame
			&& clip.timelineStartFrame + clip.durationFrames > range.endFrame);
		const candidate = incoming[0];
		if (incoming.length === 1 && candidate) {
			const available = Math.min(requestedOut, range.endFrame - candidate.timelineStartFrame);
			if (clips.every((clip) => clip === candidate
				|| clip.timelineStartFrame >= range.endFrame
				|| clip.timelineStartFrame + clip.durationFrames <= range.endFrame - available)) {
				endFrame -= available;
			}
		}
	}
	return { startFrame, endFrame, durationFrames: endFrame - startFrame };
}
