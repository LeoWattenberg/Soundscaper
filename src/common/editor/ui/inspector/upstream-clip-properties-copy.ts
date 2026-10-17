/* SPDX-License-Identifier: AGPL-3.0-only */
/** The port stays a presentation component; editor catalogs own its words. */
export function upstreamClipPropertiesLabels(copy: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
	return {
		'Clip properties': copy.clipPropertiesCommand, 'Clip': copy.clip, 'Clips': copy.clipPropertiesSelectedClips,
		'Clip name': copy.clipName, 'Track': copy.track, 'Clip color': copy.clipColor, 'Track color': copy.followTrackColor,
		'Position': copy.clipPosition, 'Start': copy.clipStart, 'Length': copy.clipDuration, 'End': copy.clipEnd,
		'Trim start': copy.clipTrimStart, 'Trim end': copy.clipTrimEnd, 'Clip in its source': copy.clipInSource,
		'Fades': copy.clipFadesTitle, 'Fade in': copy.fadeIn, 'Fade out': copy.fadeOut,
		'Fade in shape': copy.fadeInShape, 'Fade out shape': copy.fadeOutShape,
		'Pitch & speed': copy.clipPitchAndSpeed, 'Pitch': copy.clipPitchIndicator, 'Speed': copy.clipSpeedIndicator,
		'Reverse': copy.reverse, 'Reset': copy.reset, 'Reset pitch and speed': copy.resetPitchSpeed,
		'Mixed': copy.clipMixed, 'Custom': copy.clipCustomShape, 'Selected clips': copy.clipPropertiesSelectedClips,
		'First start': copy.clipFirstStart, 'Last end': copy.clipLastEnd, 'Span': copy.clipSpan,
		'{count} clips': copy.clipSelectionCount, 'Group': copy.clipGroup,
		'No clip selected. Select a clip, or right-click one and choose Clip properties.': copy.noClipSelected,
	};
}
