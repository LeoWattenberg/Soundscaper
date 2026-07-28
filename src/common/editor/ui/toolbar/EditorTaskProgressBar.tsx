/* SPDX-License-Identifier: AGPL-3.0-only */

import { useAudioEditorTelemetrySelector } from '../DesignSystemRuntime.jsx';
import {
	selectFallbackTaskProgress,
	type TaskProgressBusySnapshot,
	type TaskProgressViewModel,
} from '../task-progress-ui-model.ts';

interface TelemetryController {
	readonly subscribeTelemetry: (listener: () => void) => () => void;
	readonly getTelemetrySnapshot: () => Readonly<{ taskProgress?: TaskProgressViewModel | null }>;
}

export default function EditorTaskProgressBar({
	controller,
	snapshot,
	statusMessage,
}: Readonly<{
	controller: TelemetryController;
	snapshot: TaskProgressBusySnapshot;
	statusMessage: string;
}>) {
	const telemetryProgress = useAudioEditorTelemetrySelector(
		controller,
		(telemetry: Readonly<{ taskProgress?: TaskProgressViewModel | null }>) => telemetry.taskProgress ?? null,
	);
	const progress = telemetryProgress || selectFallbackTaskProgress(snapshot, statusMessage);
	if (!progress) return null;
	const determinate = progress.value != null;
	const percentage = determinate
		? Math.round(Math.max(0, Math.min(1, Number(progress.value) || 0)) * 100)
		: null;
	const label = progress.label || statusMessage;

	return (
		<div
			className="kw-audio-editor__task-progress"
			data-editor-task-progress={progress.kind}
			data-indeterminate={determinate ? undefined : ''}
		>
			<div
				className="kw-audio-editor__task-progress-track"
				role="progressbar"
				aria-label={label}
				aria-valuemin={determinate ? 0 : undefined}
				aria-valuemax={determinate ? 100 : undefined}
				aria-valuenow={percentage ?? undefined}
			>
				<span
					className="kw-audio-editor__task-progress-fill"
					style={determinate ? { width: `${percentage}%` } : undefined}
				/>
			</div>
			{percentage != null && <output aria-label={`${label}: ${percentage}%`}>{percentage}%</output>}
		</div>
	);
}
