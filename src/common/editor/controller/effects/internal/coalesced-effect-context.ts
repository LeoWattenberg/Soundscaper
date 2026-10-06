/* SPDX-License-Identifier: AGPL-3.0-only */

export type SimpleDryRangeRenderer = (trackId: string, startFrame: number, endFrame: number,
	channelCount: number, clipIds?: readonly string[] | null) => Promise<Float32Array[] | null>;

interface ContextTarget {
	readonly track: { readonly id: string };
	readonly startFrame: number;
	readonly endFrame: number;
	readonly channelCount: number;
	readonly clipIds?: readonly string[] | null;
}

/** Slice only the neutral direct renderer's PCM, whose samples do not depend on render bounds. */
export async function tryPrepareCoalescedEffectContext(target: ContextTarget, beforeFrames: number,
	afterFrames: number, projectEnd: number, headroomBytes: number, render: SimpleDryRangeRenderer) {
	const from = Math.max(0, target.startFrame - beforeFrames);
	const to = Math.max(target.endFrame, Math.min(projectEnd, target.endFrame + afterFrames));
	const extraBytes = (to - from) * target.channelCount * Float32Array.BYTES_PER_ELEMENT;
	// The combined input temporarily overlaps the three exact-span copies the worker owns.
	if (!Number.isFinite(extraBytes) || extraBytes > headroomBytes) return null;
	const channels = await render(target.track.id, from, to, target.channelCount, target.clipIds);
	if (!channels) return null;
	const start = target.startFrame - from;
	const end = target.endFrame - from;
	return {
		channels: channels.map((channel) => channel.slice(start, end)),
		context: {
			beforeChannels: channels.map((channel) => channel.slice(0, start)),
			...(afterFrames > 0 ? { afterChannels: channels.map((channel) => channel.slice(end)) } : {}),
		},
	};
}
