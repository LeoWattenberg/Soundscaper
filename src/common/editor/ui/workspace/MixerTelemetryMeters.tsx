/* SPDX-License-Identifier: AGPL-3.0-only */

import { useAudioEditorTelemetrySelector } from '../DesignSystemRuntime.jsx';

interface MixerMeterSnapshot {
	readonly dbfs?: number;
}

interface MixerMeterTelemetrySnapshot {
	readonly meters?: Readonly<{
		readonly master?: MixerMeterSnapshot;
		readonly groups?: Readonly<Record<string, MixerMeterSnapshot>>;
		readonly sends?: Readonly<Record<string, MixerMeterSnapshot>>;
		readonly tracks?: Readonly<Record<string, MixerMeterSnapshot>>;
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
	const level = useAudioEditorTelemetrySelector(
		controller,
		(telemetry: MixerMeterTelemetrySnapshot) => {
			if (scope === 'track') return mixerMeterPercent(telemetry.meters?.tracks?.[targetId]);
			if (scope === 'master') return mixerMeterPercent(telemetry.meters?.master);
			return mixerMeterPercent(telemetry.meters?.[`${scope}s`]?.[targetId]);
		},
	);

	return <>
		<MixerMeterBar level={level} />
		<MixerMeterBar level={level} />
	</>;
}

function MixerMeterBar({ level }: Readonly<{ level: number }>) {
	const clampedLevel = Math.max(0, Math.min(100, level));
	const fillPercent = 100 - clampedLevel;
	const isClipping = clampedLevel >= 95;
	return <div className="mixer-channel__meter-bar">
		<div className={`mixer-channel__meter-clip ${isClipping ? 'mixer-channel__meter-clip--active' : ''}`} />
		<div className="mixer-channel__meter-fill" style={{ top: `${fillPercent}%` }} />
	</div>;
}

function mixerMeterPercent(meter: MixerMeterSnapshot | undefined): number {
	const db = Number(meter?.dbfs);
	return Number.isFinite(db) ? Math.max(0, Math.min(100, (db + 60) / 60 * 100)) : 0;
}
