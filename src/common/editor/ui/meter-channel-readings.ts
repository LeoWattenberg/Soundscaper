/* SPDX-License-Identifier: AGPL-3.0-only */

import type { StripMeterSnapshot } from '../production-audio/strip-meter-session.ts';

export interface ScalarMeterSnapshot {
	readonly dbfs?: number;
	readonly peak?: number;
}

export type MeterScope = 'track' | 'group' | 'send' | 'master';
export type ChannelMeterSource = StripMeterSnapshot | ScalarMeterSnapshot | undefined;

export function productionStripMeter(
	meters: readonly StripMeterSnapshot[] | undefined,
	scope: MeterScope,
	targetId: string,
): StripMeterSnapshot | undefined {
	return meters?.find(({ strip }) => scope === 'master'
		? strip.kind === 'master'
		: strip.kind === (scope === 'track' ? 'track' : 'mixer-node') && strip.id === targetId);
}

export function meterChannelReadings(meter: ChannelMeterSource): readonly Readonly<{ level: number; clipped: boolean }>[] {
	if (meter && 'channels' in meter && meter.channels.length > 0) {
		const channels = meter.channels.slice(0, 2).map(({ peak }) => channelReading(20 * Math.log10(peak), peak));
		return channels.length === 1 ? [channels[0]!, channels[0]!] : channels;
	}
	const scalar = meter && !('channels' in meter) ? meter : undefined;
	const reading = channelReading(Number(scalar?.dbfs), scalar?.peak);
	return [reading, reading];
}

function channelReading(db: number, peak?: number): Readonly<{ level: number; clipped: boolean }> {
	return {
		level: Number.isFinite(db) ? Math.max(0, Math.min(100, (db + 60) / 60 * 100)) : 0,
		clipped: peak === undefined ? Number.isFinite(db) && db >= 0 : peak >= 1,
	};
}
