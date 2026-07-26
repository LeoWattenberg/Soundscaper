import React from 'react';
import { DbRuler, VerticalRuler } from '@dilsonspickles/components';

import {
	DEFAULT_WAVEFORM_RULER_STATE,
	MAXIMUM_WAVEFORM_VERTICAL_ZOOM,
} from './geometry.ts';

export function samplePointAtPointer(event, lane, clip, source, frameAtClientX, lockedChannel = null) {
	const rect = lane.getBoundingClientRect();
	const channelCount = Math.max(1, Number(source.channelCount) || 1);
	const localY = Math.max(0, Math.min(Math.max(1, rect.height) - Number.EPSILON, event.clientY - rect.top));
	const channelHeight = Math.max(1, rect.height / channelCount);
	const channel = lockedChannel == null
		? Math.max(0, Math.min(channelCount - 1, Math.floor(localY / channelHeight)))
		: Math.max(0, Math.min(channelCount - 1, Number(lockedChannel) || 0));
	const channelY = Math.max(0, Math.min(channelHeight, localY - channel * channelHeight));
	const timelineFrame = Math.max(
		clip.timelineStartFrame,
		Math.min(clip.timelineStartFrame + clip.durationFrames - 1, frameAtClientX(event.clientX, lane)),
	);
	return {
		channel,
		timelineFrame,
		value: Math.max(-1, Math.min(1, 1 - 2 * channelY / channelHeight)),
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
) {
	const normalizedChannelCount = Math.max(1, Math.min(2, Number(channelCount) || 1));
	const channelHeight = Math.floor(height / normalizedChannelCount);
	const halfWave = displayMode === 'half-wave';
	const normalizedZoom = Math.max(0, Math.min(MAXIMUM_WAVEFORM_VERTICAL_ZOOM, Number(zoom) || 0));
	const baseSpan = halfWave ? 1 : 2;
	const center = halfWave ? 0.5 : 0;
	const span = baseSpan / 2 ** normalizedZoom;
	const minimum = center - span / 2;
	const maximum = center + span / 2;
	return Array.from({ length: normalizedChannelCount }, (_, channel) => {
		const rulerHeight = channel === normalizedChannelCount - 1
			? height - channelHeight * channel
			: channelHeight;
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

export function clamp(value, minimum, maximum) {
	return Math.max(minimum, Math.min(maximum, value));
}
