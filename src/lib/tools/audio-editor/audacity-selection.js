/**
 * Resolve the channel layout for a destructive Audacity-style track range.
 *
 * Tracks do not own a channel layout in the editor model, so a range spanning
 * clips is mono only when every overlapping source is mono. One stereo source
 * promotes the whole range to stereo, preserving stereo material while mono
 * clips and gaps can be represented in that layout without downmixing.
 */
export function audacitySelectionChannelCount(project, trackId, startFrame, endFrame) {
	if (!project || !Number.isSafeInteger(startFrame) || !Number.isSafeInteger(endFrame) || endFrame <= startFrame) return 0;
	const track = project.tracks?.find((candidate) => candidate.id === trackId);
	if (!track) return 0;
	const clips = new Map((project.clips || []).map((clip) => [clip.id, clip]));
	const sources = new Map((project.sources || []).map((source) => [source.id, source]));
	let channelCount = 0;
	for (const clipId of track.clipIds || []) {
		const clip = clips.get(clipId);
		if (!clip || clip.timelineStartFrame >= endFrame || clip.timelineStartFrame + clip.durationFrames <= startFrame) continue;
		const sourceChannelCount = sources.get(clip.sourceId)?.channelCount;
		if (sourceChannelCount === 2) return 2;
		if (sourceChannelCount === 1) channelCount = 1;
	}
	return channelCount;
}

/** Match the fixed stereo Web Audio render to the selection's source layout. */
export function matchAudacitySelectionChannels(renderedChannels, channelCount) {
	if (channelCount !== 1 && channelCount !== 2) throw new RangeError('An Audacity selection must contain one or two channels.');
	if (!Array.isArray(renderedChannels) || !renderedChannels.length || !(renderedChannels[0] instanceof Float32Array)) {
		throw new TypeError('The Audacity selection render did not produce PCM channels.');
	}
	const frameCount = renderedChannels[0].length;
	if (renderedChannels.some((channel) => !(channel instanceof Float32Array) || channel.length !== frameCount)) {
		throw new RangeError('The Audacity selection render produced mismatched channels.');
	}
	if (channelCount === 1) return [renderedChannels[0].slice()];
	const left = renderedChannels[0].slice();
	const right = (renderedChannels[1] || renderedChannels[0]).slice();
	return [left, right];
}
