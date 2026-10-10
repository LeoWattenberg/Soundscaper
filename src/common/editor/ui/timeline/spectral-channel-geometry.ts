/* SPDX-License-Identifier: AGPL-3.0-only */

import { audioEditorStereoChannelGeometry, type AudioEditorStereoChannelGeometry } from './stereo-channel-height-runtime.ts';

/** Spectrogram frequencies repeat in each displayed channel band. */
export function spectralChannelBands(height: number, channelCount: number, ratio: number): readonly AudioEditorStereoChannelGeometry[] {
	return channelCount === 2 ? audioEditorStereoChannelGeometry(height, ratio) : [{ top: 0, height }];
}

/** A stroke keeps the channel where it began when it crosses the divider. */
export function spectralChannelAtY(y: number, height: number, channelCount: number, ratio: number): AudioEditorStereoChannelGeometry {
	const bands = spectralChannelBands(height, channelCount, ratio);
	return bands.find(band => y < band.top + band.height) ?? bands[bands.length - 1]!;
}
