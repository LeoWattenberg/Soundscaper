/* SPDX-License-Identifier: AGPL-3.0-only */

import { audacityWaveformChannelGeometry } from '../../audacity-waveform-renderer.js';
import { unscaleWaveformAmplitude } from '../../waveform-amplitude-scale.ts';
import { MAXIMUM_WAVEFORM_VERTICAL_ZOOM } from './geometry.ts';

/** Convert a channel's pointer height through its chosen scale and magnification. */
export function samplePointerAmplitude(
	channelY: number,
	height: number,
	format: string | undefined,
	zoomValue: unknown,
	halfWave: boolean,
): number {
	const zoom = Math.max(0, Math.min(MAXIMUM_WAVEFORM_VERTICAL_ZOOM, Number(zoomValue) || 0));
	if (format !== 'logarithmic-db') return (1 - 2 * channelY / height) / 2 ** zoom;
	const { centerY, maxAmplitude } = audacityWaveformChannelGeometry(0, height, halfWave);
	const scaled = maxAmplitude > 0 ? (centerY - channelY) / (maxAmplitude * 2 ** zoom) : 0;
	return unscaleWaveformAmplitude(Math.max(halfWave ? 0 : -1, Math.min(1, scaled)), 'db');
}
