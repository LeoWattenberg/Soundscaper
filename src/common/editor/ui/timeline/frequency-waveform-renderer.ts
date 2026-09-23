/* SPDX-License-Identifier: AGPL-3.0-only */

import { drawAudacityWaveformChannel } from '../../audacity-waveform-renderer.js';
import type { WaveformRendering } from '../../design-system-adapters/types.ts';
import {
	frequencyWaveformColor,
	type FrequencyWaveformProjection,
} from './frequency-waveform-projection.ts';

export interface FrequencyWaveformChannelDrawingOptions {
	readonly channel: number;
	readonly width: number;
	readonly pixelRatioX: number;
	readonly centerY: number;
	readonly maxAmplitude: number;
	readonly halfWave: boolean;
	readonly envelopeGain?: (x: number, width: number) => number;
	readonly centerLineColor?: string | null;
}

export interface ThreeBandWaveformChannelDrawingOptions extends FrequencyWaveformChannelDrawingOptions {
	readonly colors: Readonly<Record<'low' | 'mid' | 'high', string>>;
	readonly opacity?: number;
}

export interface RainbowWaveformChannelDrawingOptions extends FrequencyWaveformChannelDrawingOptions {
	readonly showRms?: boolean;
}

/** Keep mode-specific palette and dispatch out of the ordinary timeline startup painter. */
export function drawFrequencyWaveformChannel(
	context: CanvasRenderingContext2D,
	mode: string,
	rendering: WaveformRendering,
	projection: FrequencyWaveformProjection | null | undefined,
	options: FrequencyWaveformChannelDrawingOptions,
	style: CSSStyleDeclaration,
	showRms: boolean,
): boolean {
	if (!projection) return false;
	if (mode === 'waveform-three-band') {
		drawThreeBandWaveformChannel(context, projection, {
			...options,
			colors: {
				low: style.getPropertyValue('--frequency-waveform-low').trim() || '#7048c8',
				mid: style.getPropertyValue('--frequency-waveform-mid').trim() || '#159c68',
				high: style.getPropertyValue('--frequency-waveform-high').trim() || '#e76f19',
			},
			opacity: 0.72,
		});
		return true;
	}
	if (mode !== 'waveform-rainbow') return false;
	drawRainbowWaveformChannel(context, rendering, projection, { ...options, showRms });
	return true;
}

/** Paint the three frequency summaries on one shared channel zero line. */
export function drawThreeBandWaveformChannel(
	context: CanvasRenderingContext2D,
	projection: FrequencyWaveformProjection,
	options: ThreeBandWaveformChannelDrawingOptions,
): void {
	context.save();
	context.globalAlpha = finiteOpacity(options.opacity ?? 0.72);
	(['low', 'mid', 'high'] as const).forEach((band, index) => {
		drawAudacityWaveformChannel(context, projection.bands[band], {
			...options,
			sampleColor: options.colors[band],
			rmsColor: options.colors[band],
			showRms: false,
			centerLineColor: index === 2 ? options.centerLineColor : null,
		});
	});
	context.restore();
	if (projection.bands.high.mode === 'summary') drawSummaryCenterLine(context, options);
}

/** Paint the ordinary waveform shape with a centroid-derived color per column. */
export function drawRainbowWaveformChannel(
	context: CanvasRenderingContext2D,
	rendering: WaveformRendering,
	projection: FrequencyWaveformProjection,
	options: RainbowWaveformChannelDrawingOptions,
): void {
	const colors = Array.from(projection.centroidHz, (frequency, index) => frequencyWaveformColor(
		frequency,
		projection.centroidWeight[index] ?? 0,
		projection.sampleRate,
	));
	const rmsColors = colors.map(lightenRainbowColor);
	const colorAt = (x: number) => colors[columnAt(x, options.width, colors.length)] ?? 'rgb(50, 50, 50)';
	const rmsColorAt = (x: number) => rmsColors[columnAt(x, options.width, rmsColors.length)] ?? 'rgb(128, 128, 128)';
	drawAudacityWaveformChannel(context, rendering, {
		...options,
		sampleColor: colorAt,
		rmsColor: rmsColorAt,
		showRms: Boolean(options.showRms),
	});
	if (rendering.mode === 'summary') drawSummaryCenterLine(context, options);
}

/** Lighten in RGB space: equal channel-difference scaling retains the source hue. */
function lightenRainbowColor(color: string): string {
	const channels = /^rgb\((\d+), (\d+), (\d+)\)$/u.exec(color);
	if (!channels) return color;
	return `rgb(${channels.slice(1).map((channel) => (
		Math.round(Number(channel) + (255 - Number(channel)) * 0.38)
	)).join(', ')})`;
}

function drawSummaryCenterLine(
	context: CanvasRenderingContext2D,
	options: FrequencyWaveformChannelDrawingOptions,
): void {
	if (!options.centerLineColor) return;
	context.strokeStyle = options.centerLineColor;
	context.beginPath();
	context.moveTo(0, options.centerY);
	context.lineTo(options.width, options.centerY);
	context.stroke();
}

function columnAt(x: number, width: number, columnCount: number): number {
	if (!columnCount) return 0;
	const normalized = Math.max(0, Math.min(1, Number(x) / Math.max(Number.EPSILON, width)));
	return Math.min(columnCount - 1, Math.floor(normalized * columnCount));
}

function finiteOpacity(value: number): number {
	if (!Number.isFinite(value)) return 0.72;
	return Math.max(0, Math.min(1, value));
}
