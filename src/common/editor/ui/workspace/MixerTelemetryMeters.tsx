/* SPDX-License-Identifier: AGPL-3.0-only */

import { useAudioEditorTelemetrySelector } from '../DesignSystemRuntime.jsx';
import { meterChannelReadings, productionStripMeter, type ScalarMeterSnapshot } from '../meter-channel-readings.ts';
import type { StripMeterSnapshot } from '../../production-audio/strip-meter-session.ts';

interface MixerMeterTelemetrySnapshot {
	readonly meters?: Readonly<{
		readonly master?: ScalarMeterSnapshot;
		readonly groups?: Readonly<Record<string, ScalarMeterSnapshot>>;
		readonly sends?: Readonly<Record<string, ScalarMeterSnapshot>>;
		readonly tracks?: Readonly<Record<string, ScalarMeterSnapshot>>;
		readonly productionMeters?: readonly StripMeterSnapshot[];
	}>;
}

interface MixerMeterTelemetryController {
	readonly getTelemetrySnapshot: () => MixerMeterTelemetrySnapshot;
	readonly subscribeTelemetry: (listener: () => void) => () => void;
}

type MixerMeterScope = 'track' | 'group' | 'send' | 'master';

export function MixerTelemetryMeters({
	controller,
	scope,
	targetId,
}: Readonly<{
	controller: MixerMeterTelemetryController;
	scope: MixerMeterScope;
	targetId: string;
}>) {
	const meter = useAudioEditorTelemetrySelector(
		controller,
		(telemetry: MixerMeterTelemetrySnapshot) => {
			const production = productionStripMeter(telemetry.meters?.productionMeters, scope, targetId);
			if (production) return production;
			if (scope === 'track') return telemetry.meters?.tracks?.[targetId];
			if (scope === 'master') return telemetry.meters?.master;
			return telemetry.meters?.[`${scope}s`]?.[targetId];
		},
	);

	return <>{meterChannelReadings(meter).map((reading, index) => <MixerMeterBar key={index} {...reading} />)}</>;
}

function MixerMeterBar({ level, clipped }: Readonly<{ level: number; clipped: boolean }>) {
	const clampedLevel = Math.max(0, Math.min(100, level));
	return <div className="mixer-channel__meter-bar">
		<div className={`mixer-channel__meter-clip ${clipped ? 'mixer-channel__meter-clip--active' : ''}`} />
		<div className="mixer-channel__meter-fill" style={{ top: 0, height: '100%', transformOrigin: 'bottom', transform: `scaleY(${clampedLevel / 100})` }} />
	</div>;
}
