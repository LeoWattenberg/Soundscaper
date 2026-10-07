/* SPDX-License-Identifier: AGPL-3.0-only */

import { useId } from 'react';
import AudioEditorTimeCodeInput from '../AudioEditorTimeCodeInput.tsx';
import {
	normalizeTimedRecordingDialogValue,
	timedRecordingLocalDateTimeValid,
	type TimedRecordingDialogValue,
	updateTimedRecordingDialogDuration,
	updateTimedRecordingDialogEnd,
	updateTimedRecordingDialogEndMode,
	updateTimedRecordingDialogStart,
} from './timed-recording-dialog-model.ts';

interface TimedRecordingDialogCopy extends Readonly<Record<string, string>> {
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
	const invalidDateId = useId();
	const startInvalid = model.startTime !== '' && !timedRecordingLocalDateTimeValid(model.startTime);
	const endInvalid = model.endMode === 'end' && model.endTime !== ''
		&& !timedRecordingLocalDateTimeValid(model.endTime);
	return <form data-timed-recording-dialog onSubmit={(event) => {
		event.preventDefault();
		onSubmit();
	}}>
		<label className="kw-audio-editor-dialog__field kw-audio-editor-timed-recording__start">
			<span>{copy.timedRecordingStartTime}</span>
			<input
				className="kw-audio-editor-timed-recording__control"
				type="datetime-local"
				step="0.001"
				value={model.startTime}
				aria-invalid={startInvalid || undefined}
				aria-describedby={startInvalid ? invalidDateId : undefined}
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
					className="kw-audio-editor-timed-recording__control" variant="light"
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
				<input className="kw-audio-editor-timed-recording__control"
					type="datetime-local" step="0.001" aria-label={copy.timedRecordingEndDateTime}
					value={model.endTime} disabled={model.endMode !== 'end'}
					aria-invalid={endInvalid || undefined} aria-describedby={endInvalid ? invalidDateId : undefined}
					onChange={(event) => onValueChange(updateTimedRecordingDialogEnd(
						model,
						event.currentTarget.value,
					))} />
			</div>
		</fieldset>
		{(startInvalid || endInvalid) && <p id={invalidDateId} role="alert">
			{copy.timedRecordingInvalidLocalDateTime}
		</p>}
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
