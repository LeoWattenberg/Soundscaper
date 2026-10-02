/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useMemo, useState } from 'react';
import { TimeCode, type TimeCodeFormat } from '@soundscaper/design-system/TimeCode';

import { framesToSeconds, secondsToFrames } from '../../design-system-adapters.js';
import { resolveSequenceTimingView, type SequenceTimingProject } from '../../sequence-timing-model.ts';
import { useAudioEditorTelemetrySelector } from '../DesignSystemRuntime.jsx';
import TimeCodeFormatControl from './TimeCodeFormatControl.tsx';
import {
	sequenceDisplaySecondsAtSample,
	sequenceTimeCodeFormat,
	sequenceTimeCodeLabelAtDisplaySeconds,
} from './telemetry-timecode-model.ts';

export interface TimeCodeTelemetryController {
	subscribeTelemetry(listener: () => void): () => void;
	getTelemetrySnapshot(): { readonly positionFrame?: number };
	readonly actions?: {
		readonly transport?: { seek(frame: number): unknown };
		readonly sequences?: { seekLabel(label: string): unknown };
	};
}

export interface TelemetryTimeCodeProps {
	readonly controller: TimeCodeTelemetryController;
	readonly copy: Readonly<Record<string, string>>;
	readonly project?: SequenceTimingProject | null;
	readonly durationFrames: number;
	readonly isCompact?: boolean;
	readonly sequenceTiming?: boolean;
	readonly recording?: unknown;
	readonly run: (operation: () => unknown) => unknown;
	readonly preferredFormat?: TimeCodeFormat | null;
	readonly onFormatChange?: (format: TimeCodeFormat) => void;
	readonly onUndock?: () => void;
	readonly onRedock?: () => void;
}

/** Shared telemetry leaf for the toolbar and the optional large clock. */
export default function TelemetryTimeCode({
	controller, copy, project, durationFrames, isCompact, sequenceTiming = false,
	recording, run, preferredFormat, onFormatChange, onUndock, onRedock,
}: TelemetryTimeCodeProps) {
	const sequenceView = useMemo(() => sequenceTiming && Array.isArray(project?.sequences) && project.sequences.length
		? resolveSequenceTimingView(project) : null, [project, sequenceTiming]);
	const defaultFormat = sequenceView ? sequenceTimeCodeFormat(sequenceView) : 'hh:mm:ss+hundredths';
	const [localFormat, setLocalFormat] = useState<TimeCodeFormat | null>(null);
	useEffect(() => setLocalFormat(null), [defaultFormat]);
	const format = preferredFormat ?? localFormat ?? defaultFormat;
	const positionFrame = useAudioEditorTelemetrySelector(
		controller,
		(telemetry: { positionFrame?: number }) => telemetry.positionFrame || 0,
	) as number;
	const sampleRate = Number(project?.sampleRate) || 48_000;
	const frameRate = sequenceView ? sequenceView.rate.num / sequenceView.rate.den : 24;
	const timeValue = sequenceView
		? sequenceDisplaySecondsAtSample(positionFrame, sequenceView, sampleRate)
		: framesToSeconds(positionFrame, { sampleRate });
	const negative = timeValue < 0;
	return <div className="kw-audio-editor__timecode" data-time-display
		data-compact={isCompact ? 'true' : undefined} data-negative={negative ? 'true' : undefined}>
		{negative && <span className="kw-audio-editor__timecode-sign">−</span>}
		<TimeCodeFormatControl label={`${copy.playhead}: ${copy.format}`} format={format} frameRate={frameRate}
			onFormatChange={(nextFormat) => { setLocalFormat(nextFormat); onFormatChange?.(nextFormat); }}
			dockingLabel={onRedock ? copy.timecodeRedock : copy.timecodeUndock}
			onDockingChange={onRedock ?? onUndock}
		>
			<TimeCode
				ariaLabel={copy.playhead} format={format} value={Math.abs(timeValue)}
				sampleRate={sampleRate} frameRate={frameRate} showFormatSelector={false}
				disabled={Boolean(recording)}
				onChange={(seconds) => run(() => sequenceView
					? controller.actions?.sequences?.seekLabel(sequenceTimeCodeLabelAtDisplaySeconds(
						negative ? -seconds : seconds, sequenceView,
					))
					: controller.actions?.transport?.seek(secondsToFrames(seconds, {
						maximumFrame: durationFrames, sampleRate,
					})))}
			/>
		</TimeCodeFormatControl>
	</div>;
}
