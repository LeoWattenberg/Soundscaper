/**
 * Resolve the channel layout for a destructive Audacity-style track range.
 *
 * Tracks do not own a channel layout in the editor model, so a range spanning
 * clips retains the widest overlapping source, preserving its native channels
 * while narrower clips and gaps can be represented without downmixing.
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
		if (Number.isInteger(sourceChannelCount) && sourceChannelCount >= 1 && sourceChannelCount <= 32) {
			channelCount = Math.max(channelCount, sourceChannelCount);
		}
	}
	return channelCount;
}

/** Copy a private render into the selection's bounded native source layout. */
export function matchAudacitySelectionChannels(renderedChannels, channelCount) {
	if (!Number.isInteger(channelCount) || channelCount < 1 || channelCount > 32) {
		throw new RangeError('An Audacity selection must contain between one and 32 channels.');
	}
	if (!Array.isArray(renderedChannels) || !renderedChannels.length || !(renderedChannels[0] instanceof Float32Array)) {
		throw new TypeError('The Audacity selection render did not produce PCM channels.');
	}
	const frameCount = renderedChannels[0].length;
	if (renderedChannels.some((channel) => !(channel instanceof Float32Array) || channel.length !== frameCount)) {
		throw new RangeError('The Audacity selection render produced mismatched channels.');
	}
	if (channelCount > 2 && renderedChannels.length < channelCount) {
		throw new RangeError('The Audacity selection render omitted native channels.');
	}
	if (channelCount === 1) return [renderedChannels[0].slice()];
	return Array.from({ length: channelCount }, (_, channel) =>
		(renderedChannels[channel] || renderedChannels[0]).slice());
}
