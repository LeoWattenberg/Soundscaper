/* SPDX-License-Identifier: AGPL-3.0-only */

import { TrackMeter } from '@soundscaper/design-system/TrackMeter';

import { useAudioEditorTelemetrySelector } from '../DesignSystemRuntime.jsx';
import { meterChannelReadings, productionStripMeter, type ScalarMeterSnapshot, type ChannelMeterSource } from '../meter-channel-readings.ts';
import type { StripMeterSnapshot } from '../../production-audio/strip-meter-session.ts';

interface MeterTelemetrySnapshot {
	readonly meters?: Readonly<{
		readonly master?: ScalarMeterSnapshot;
		readonly groups?: Readonly<Record<string, ScalarMeterSnapshot>>;
		readonly sends?: Readonly<Record<string, ScalarMeterSnapshot>>;
		readonly tracks?: Readonly<Record<string, ScalarMeterSnapshot>>;
		readonly productionMeters?: readonly StripMeterSnapshot[];
	}>;
}

interface MeterTelemetryController {
	readonly getTelemetrySnapshot: () => MeterTelemetrySnapshot;
	readonly subscribeTelemetry: (listener: () => void) => () => void;
}

export function TrackTelemetryMeters({
	controller,
	trackId,
}: Readonly<{
	controller: MeterTelemetryController;
	trackId: string;
}>) {
	const meter = useAudioEditorTelemetrySelector(
		controller,
		(telemetry: MeterTelemetrySnapshot) => productionStripMeter(telemetry.meters?.productionMeters, 'track', trackId)
			?? telemetry.meters?.tracks?.[trackId],
	);
	return <StereoTrackMeters meter={meter} />;
}

export function OutputTelemetryMeters({
	controller,
	scope,
	busId,
}: Readonly<{
	controller: MeterTelemetryController;
	scope: 'master' | 'group' | 'send';
	busId?: string;
}>) {
	const meter = useAudioEditorTelemetrySelector(
		controller,
		(telemetry: MeterTelemetrySnapshot) => {
			const production = productionStripMeter(telemetry.meters?.productionMeters, scope, busId ?? '');
			if (production) return production;
			if (scope === 'master') return telemetry.meters?.master;
			if (!busId) return undefined;
			return scope === 'group'
				? telemetry.meters?.groups?.[busId]
				: telemetry.meters?.sends?.[busId];
		},
	);
	return <StereoTrackMeters meter={meter} />;
}

function StereoTrackMeters({ meter }: Readonly<{ meter?: ChannelMeterSource }>) {
	return <>{meterChannelReadings(meter).map(({ level, clipped }, index) => (
		<TrackMeter key={index} variant="stereo" volume={level} clipped={clipped} />
	))}</>;
}
