/* SPDX-License-Identifier: AGPL-3.0-only */

import { TrackMeter } from '@soundscaper/design-system/TrackMeter';

import { useAudioEditorTelemetrySelector } from '../DesignSystemRuntime.jsx';
import { meterPercent } from './geometry.ts';

interface MeterSnapshot {
	readonly dbfs?: number;
	readonly peak?: number;
}

interface MeterTelemetrySnapshot {
	readonly meters?: Readonly<{
		readonly master?: MeterSnapshot;
		readonly groups?: Readonly<Record<string, MeterSnapshot>>;
		readonly sends?: Readonly<Record<string, MeterSnapshot>>;
		readonly tracks?: Readonly<Record<string, MeterSnapshot>>;
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
		(telemetry: MeterTelemetrySnapshot) => telemetry.meters?.tracks?.[trackId],
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
			if (scope === 'master') return telemetry.meters?.master;
			if (!busId) return undefined;
			return scope === 'group'
				? telemetry.meters?.groups?.[busId]
				: telemetry.meters?.sends?.[busId];
		},
	);
	return <StereoTrackMeters meter={meter} />;
}

function StereoTrackMeters({ meter }: Readonly<{ meter?: MeterSnapshot }>) {
	const volume = meterPercent(meter?.dbfs);
	const clipped = (meter?.peak || 0) >= 1;
	return <>
		<TrackMeter variant="stereo" volume={volume} clipped={clipped} />
		<TrackMeter variant="stereo" volume={volume} clipped={clipped} />
	</>;
}
