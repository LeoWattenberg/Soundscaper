/* SPDX-License-Identifier: AGPL-3.0-only */

import type { MutableEngineMeterReading } from './engine-meter-reading.ts';
import type { StripMeterSnapshot } from '../production-audio/strip-meter-session.ts';

interface ChannelMeterFrame {
	readonly master: MutableEngineMeterReading;
	readonly tracks: Readonly<Record<string, MutableEngineMeterReading>>;
	readonly groups: Readonly<Record<string, MutableEngineMeterReading>>;
	readonly sends: Readonly<Record<string, MutableEngineMeterReading>>;
	readonly productionMeters?: readonly StripMeterSnapshot[];
}

/** Scalar levels summarize channel measurements, never a cancellable mono downmix. */
export function reconcileEngineChannelMeters<Frame extends ChannelMeterFrame>(frame: Frame): Frame {
	for (const { strip, channels } of frame.productionMeters ?? []) {
		const target = strip.kind === 'master' ? frame.master
			: strip.kind === 'track' ? frame.tracks[strip.id]
				: frame.groups[strip.id] ?? frame.sends[strip.id];
		if (!target || !channels.length) continue;
		const peak = Math.max(...channels.map(channel => channel.peak));
		const rms = Math.sqrt(channels.reduce((sum, channel) => sum + channel.rms ** 2, 0) / channels.length);
		Object.assign(target, { peak, rms, dbfs: peak > 0 ? 20 * Math.log10(peak) : -Infinity });
	}
	return frame;
}
