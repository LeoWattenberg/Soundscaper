/* SPDX-License-Identifier: AGPL-3.0-only */

import AudioEditorTimeCodeInput from '../AudioEditorTimeCodeInput.tsx';
import {
	normalizeTimedRecordingDialogValue,
	type TimedRecordingDialogValue,
	updateTimedRecordingDialogDuration,
	updateTimedRecordingDialogEnd,
	updateTimedRecordingDialogEndMode,
	updateTimedRecordingDialogStart,
} from './timed-recording-dialog-model.ts';

interface TimedRecordingDialogCopy extends Readonly<Record<string, string>> {
	readonly timedRecordingDescription: string;
	readonly timedRecordingStartTime: string;
	readonly timedRecordingEnd: string;
	readonly timedRecordingDuration: string;
	readonly timedRecordingEndDateTime: string;
	readonly timedRecordingCurrent: string;
	readonly timedRecordingCurrentRange: string;
}

interface ScheduledRecording {
	readonly startTimeMs: number;
	readonly endTimeMs?: number;
}

interface TimedRecordingDialogFieldsProps {
	readonly value: unknown;
	readonly onValueChange: (value: TimedRecordingDialogValue) => void;
	readonly onSubmit: () => void;
	readonly scheduledRecording?: ScheduledRecording | null;
	readonly copy: TimedRecordingDialogCopy;
	readonly locale: string;
}

export default function TimedRecordingDialogFields({
	value,
	onValueChange,
	onSubmit,
	scheduledRecording,
	copy,
	locale,
}: TimedRecordingDialogFieldsProps) {
	const model = normalizeTimedRecordingDialogValue(value);
	return <form data-timed-recording-dialog onSubmit={(event) => {
		event.preventDefault();
		onSubmit();
	}}>
		<p>{copy.timedRecordingDescription}</p>
		<label className="kw-audio-editor-dialog__field">
			<span>{copy.timedRecordingStartTime}</span>
			<input
				type="datetime-local"
				step="1"
				value={model.startTime}
				onChange={(event) => onValueChange(updateTimedRecordingDialogStart(
					model,
					event.currentTarget.value,
				))}
			/>
		</label>
		<fieldset className="kw-audio-editor-timed-recording__end">
			<legend>{copy.timedRecordingEnd}</legend>
			<div className="kw-audio-editor-timed-recording__end-option">
				<label>
					<input type="radio" name="timed-recording-end-mode" value="duration"
						checked={model.endMode === 'duration'} onChange={() => onValueChange(
							updateTimedRecordingDialogEndMode(model, 'duration'),
						)} />
					<span>{copy.timedRecordingDuration}</span>
				</label>
				<AudioEditorTimeCodeInput label={copy.timedRecordingDuration}
					value={model.durationSeconds} unit="seconds" minimum={1}
					disabled={model.endMode !== 'duration'} onChange={(duration) => onValueChange(
						updateTimedRecordingDialogDuration(model, duration),
					)} />
			</div>
			<div className="kw-audio-editor-timed-recording__end-option">
				<label>
					<input type="radio" name="timed-recording-end-mode" value="end"
						checked={model.endMode === 'end'} onChange={() => onValueChange(
							updateTimedRecordingDialogEndMode(model, 'end'),
						)} />
					<span>{copy.timedRecordingEndDateTime}</span>
				</label>
				<input type="datetime-local" step="1" aria-label={copy.timedRecordingEndDateTime}
					value={model.endTime} disabled={model.endMode !== 'end'}
					onChange={(event) => onValueChange(updateTimedRecordingDialogEnd(
						model,
						event.currentTarget.value,
					))} />
			</div>
		</fieldset>
		{scheduledRecording && <p>{scheduledRecordingText(scheduledRecording, copy, locale)}</p>}
	</form>;
}

function scheduledRecordingText(
	scheduled: ScheduledRecording,
	copy: TimedRecordingDialogCopy,
	locale: string,
): string {
	const start = new Date(scheduled.startTimeMs).toLocaleString(locale);
	if (scheduled.endTimeMs === undefined) return copy.timedRecordingCurrent.replace('{time}', start);
	return copy.timedRecordingCurrentRange
		.replace('{start}', start)
		.replace('{end}', new Date(scheduled.endTimeMs).toLocaleString(locale));
}
