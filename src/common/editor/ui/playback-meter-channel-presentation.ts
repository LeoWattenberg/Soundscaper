/* SPDX-License-Identifier: AGPL-3.0-only */

import type { EngineMeterReading } from '../engine/public-api.ts';
import type { StripChannelMeterSnapshot, StripMeterSnapshot } from '../production-audio/strip-meter-session.ts';
import { playbackMeterAmplitudeToDb, playbackMeterPercent } from '../playback-meter.js';
import { productionStripMeter } from './meter-channel-readings.ts';
import type { MeterSettings } from './meter-settings.ts';

type ChannelPlaybackMeter = EngineMeterReading & { readonly channels?: readonly StripChannelMeterSnapshot[] };
interface PlaybackMeters {
	readonly master?: EngineMeterReading;
	readonly productionMeters?: readonly StripMeterSnapshot[];
}
const projections = new WeakMap<EngineMeterReading, Readonly<{
	channels: readonly StripChannelMeterSnapshot[];
	reading: ChannelPlaybackMeter;
}>>();

/** Preserve scalar programme/loudness fields alongside the existing master channel readings. */
export function playbackMeterWithChannels(meters?: PlaybackMeters): ChannelPlaybackMeter | undefined {
	const master = meters?.master;
	const channels = productionStripMeter(meters?.productionMeters, 'master', '')?.channels;
	if (!master || !channels?.length) return master;
	const existing = projections.get(master);
	if (existing?.channels === channels) return existing.reading;
	const reading = { ...master, channels };
	projections.set(master, { channels, reading });
	return reading;
}

/** Each stereo bar inherits geometry and paints only its own measured signal. */
export function audioMeterChannelStyle(
	channel: StripChannelMeterSnapshot | undefined,
	type: MeterSettings['type'],
	range: number,
	orientation: 'horizontal' | 'vertical',
): Readonly<Record<string, string>> | undefined {
	if (!channel || type === 'ebu-r128') return undefined;
	const peak = playbackMeterPercent(playbackMeterAmplitudeToDb(channel.peak, range), type, range);
	const rms = Math.min(peak, playbackMeterPercent(playbackMeterAmplitudeToDb(channel.rms, range), type, range));
	return {
		'--playback-meter-peak': `${peak}%`,
		'--playback-meter-rms': `${rms}%`,
		'--playback-meter-peak-transform': `${orientation === 'vertical' ? 'scaleY' : 'scaleX'}(${peak / 100})`,
	};
}
