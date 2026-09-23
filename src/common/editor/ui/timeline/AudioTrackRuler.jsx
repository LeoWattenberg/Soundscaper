import { useRef } from 'react';

import { useNonPassiveWheel } from '../useNonPassiveWheel.js';
import { accumulateTimelineZoomWheel } from '../workspace/timeline-navigation-geometry.js';
import { audioEditorStereoChannelGeometry } from './stereo-channel-height-runtime.ts';
import { renderAmplitudeRulers, renderFrequencyRulers } from './track-row-helpers.jsx';
import { frequencyRulerWheelRange, verticalRulerWheelZoom } from './vertical-ruler-gesture.ts';

export function AudioTrackRuler({
	track, displayMode, halfWave = displayMode === 'half-wave', bodyTop, bodyHeight, width, channelCount, channelHeightRatio,
	sampleRate, spectrogramScale, waveformRulerFormat, waveformZoom, disabled, copy,
	tabIndex, onOpenRulerFlyout, onKeyDown, onWaveformZoom, onFrequencyRange,
}) {
	const rulerRef = useRef(null);
	const wheelRef = useRef(null);
	const spectralHeight = displayMode === 'multiview' ? Math.floor(bodyHeight / 2) : bodyHeight;
	const minimumFrequency = Math.max(0, Number(track.spectrogram?.minimumFrequency) || 0);
	const maximumFrequency = Math.min(sampleRate / 2, Number(track.spectrogram?.maximumFrequency) || sampleRate / 2);
	useNonPassiveWheel(rulerRef, (event) => {
		if (event.altKey || !event.deltaY) return;
		const rect = rulerRef.current.getBoundingClientRect();
		const localY = event.clientY - rect.top - bodyTop;
		const frequencyRuler = displayMode === 'spectrogram' || displayMode === 'multiview' && localY < spectralHeight;
		const zoom = event.ctrlKey || event.metaKey;
		if (!frequencyRuler && !zoom) return;
		event.preventDefault();
		event.stopPropagation();
		if (disabled) return;
		if (frequencyRuler) {
			const channels = channelCount === 2
				? audioEditorStereoChannelGeometry(spectralHeight, channelHeightRatio)
				: [{ top: 0, height: spectralHeight }];
			const channel = channels.find(band => localY < band.top + band.height) || channels[channels.length - 1];
			const fraction = (localY - channel.top) / Math.max(1, channel.height);
			const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? channel.height : 1);
			onFrequencyRange(frequencyRulerWheelRange({ minimumFrequency, maximumFrequency }, spectrogramScale, sampleRate / 2, fraction, delta, zoom));
		} else {
			const accumulated = accumulateTimelineZoomWheel(wheelRef.current, event, bodyHeight);
			wheelRef.current = accumulated.state;
			if (accumulated.zoom) onWaveformZoom(verticalRulerWheelZoom(waveformZoom, accumulated.zoom === 'in' ? -1 : 1));
		}
	});
	const amplitudeRulers = (height) => renderAmplitudeRulers(
		channelCount, height, width, halfWave ? 'half-wave' : 'waveform', waveformRulerFormat, waveformZoom, channelHeightRatio,
	);
	const frequencyRulers = (height) => renderFrequencyRulers(
		channelCount, height, width, minimumFrequency, maximumFrequency, spectrogramScale, channelHeightRatio,
	);
	return <div
		ref={rulerRef}
		className="audio-editor-vertical-ruler"
		data-track-ruler
		data-ruler-format={waveformRulerFormat}
		data-ruler-zoom={waveformZoom}
		data-ruler-frequency-minimum={minimumFrequency}
		data-ruler-frequency-maximum={maximumFrequency}
		role="region"
		aria-label={`${track.name}: ${displayMode === 'spectrogram' ? copy.spectrogramView : displayMode === 'multiview' ? copy.multiview : copy.waveformView}`}
		tabIndex={tabIndex}
		style={{ paddingTop: bodyTop }}
		onContextMenu={(event) => onOpenRulerFlyout(displayMode, event)}
		onKeyDown={onKeyDown}
	>
		{displayMode === 'spectrogram' ? frequencyRulers(bodyHeight) : displayMode === 'multiview'
			? <>{frequencyRulers(spectralHeight)}{amplitudeRulers(bodyHeight - spectralHeight)}</>
			: amplitudeRulers(bodyHeight)}
	</div>;
}
