import React from 'react';
import { DbRuler, FrequencyRuler, VerticalRuler } from '@soundscaper/design-system/VerticalRuler';

import {
	DEFAULT_WAVEFORM_RULER_STATE,
	MAXIMUM_WAVEFORM_VERTICAL_ZOOM,
} from './geometry.ts';
import { audioEditorStereoChannelGeometry } from './stereo-channel-height-runtime.ts';

export function samplePointAtPointer(event, lane, clip, source, frameAtClientX, lockedChannel = null) {
	const rect = lane.getBoundingClientRect();
	const channelCount = Math.max(1, Number(source.channelCount) || 1);
	const requestedBodyTop = Number(lane.dataset?.channelBodyTop);
	const bodyTop = Number.isFinite(requestedBodyTop)
		? Math.max(0, Math.min(rect.height, requestedBodyTop))
		: 0;
	const laneHeight = Math.max(1, rect.height - bodyTop);
	const localY = Math.max(0, Math.min(laneHeight, event.clientY - rect.top - bodyTop));
	const channelGeometry = channelCount === 2
		? audioEditorStereoChannelGeometry(laneHeight, lane.dataset?.channelHeightRatio)
		: Array.from({ length: channelCount }, (_, channel) => ({
			top: channel * laneHeight / channelCount,
			height: laneHeight / channelCount,
		}));
	const pointedChannel = channelGeometry.findIndex(({ top, height }) => localY < top + height);
	const channel = lockedChannel == null
		? (pointedChannel < 0 ? channelCount - 1 : pointedChannel)
		: Math.max(0, Math.min(channelCount - 1, Number(lockedChannel) || 0));
	const geometry = channelGeometry[channel];
	const channelY = Math.max(0, Math.min(geometry.height, localY - geometry.top));
	const timelineFrame = Math.max(
		clip.timelineStartFrame,
		Math.min(clip.timelineStartFrame + clip.durationFrames - 1, frameAtClientX(event.clientX, lane)),
	);
	return {
		channel,
		timelineFrame,
		value: Math.max(-1, Math.min(1, 1 - 2 * channelY / geometry.height)),
	};
}

export function isRulerLoopBand(event, lane) {
	const ruler = lane.querySelector('canvas.timeline-ruler');
	const rect = ruler?.getBoundingClientRect() || lane.getBoundingClientRect();
	return event.clientY - rect.top <= rect.height / 2;
}

export function renderAmplitudeRulers(
	channelCount,
	height,
	width,
	displayMode,
	rulerFormat = DEFAULT_WAVEFORM_RULER_STATE.format,
	zoom = DEFAULT_WAVEFORM_RULER_STATE.zoom,
	channelHeightRatio = 0.5,
) {
	const normalizedChannelCount = Math.max(1, Math.min(2, Number(channelCount) || 1));
	const channelGeometry = normalizedChannelCount === 2
		? audioEditorStereoChannelGeometry(height, channelHeightRatio)
		: [{ top: 0, height }];
	const halfWave = displayMode === 'half-wave';
	const normalizedZoom = Math.max(0, Math.min(MAXIMUM_WAVEFORM_VERTICAL_ZOOM, Number(zoom) || 0));
	const baseSpan = halfWave ? 1 : 2;
	const center = halfWave ? 0.5 : 0;
	const span = baseSpan / 2 ** normalizedZoom;
	const minimum = center - span / 2;
	const maximum = center + span / 2;
	return Array.from({ length: normalizedChannelCount }, (_, channel) => {
		const rulerHeight = channelGeometry[channel].height;
		if (rulerFormat !== 'linear-amp') {
			const ruler = <DbRuler
				height={halfWave ? rulerHeight * 2 : rulerHeight}
				scale={rulerFormat === 'linear-db' ? 'linear' : 'logarithmic'}
				width={width}
			/>;
			return halfWave ? (
				<div
					className="audio-editor-half-wave-ruler"
					key={channel}
					style={{ height: rulerHeight, overflow: 'hidden' }}
				>
					{ruler}
				</div>
			) : React.cloneElement(ruler, { key: channel });
		}
		const ruler = <VerticalRuler
			height={rulerHeight}
			min={minimum}
			max={maximum}
			majorDivisions={halfWave ? 2 : 3}
			minorDivisions={1}
			width={width}
		/>;
		return halfWave ? (
			<div className="audio-editor-half-wave-ruler" key={channel} style={{ height: rulerHeight }}>
				{ruler}
			</div>
		) : React.cloneElement(ruler, { key: channel });
	});
}

export function renderFrequencyRulers(
	channelCount,
	height,
	width,
	minimumFrequency,
	maximumFrequency,
	scale,
	channelHeightRatio = 0.5,
) {
	const normalizedChannelCount = Math.max(1, Math.min(2, Number(channelCount) || 1));
	const channelGeometry = normalizedChannelCount === 2
		? audioEditorStereoChannelGeometry(height, channelHeightRatio)
		: [{ top: 0, height }];
	return channelGeometry.map(({ height: rulerHeight }, channel) => (
		<FrequencyRuler
			key={channel}
			height={rulerHeight}
			minFreq={minimumFrequency}
			maxFreq={maximumFrequency}
			scale={scale}
			width={width}
		/>
	));
}

export function clamp(value, minimum, maximum) {
	return Math.max(minimum, Math.min(maximum, value));
}
