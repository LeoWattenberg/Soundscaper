/* SPDX-License-Identifier: AGPL-3.0-only */

import { createAddLabelCommand, createAddLabelTrackCommand } from '../../../../commands/factories.ts';
import { scaleSampleFrame } from '../../../../timeline-time.ts';
import type { RecordingProject } from '../../recording-transaction-types.ts';

export interface RecordingActivationTimestamp {
	readonly startFrame: number;
	readonly offsetFrames: number;
	readonly sampleRate: number;
	readonly occurredAtMs: number;
}

interface TimestampCommandInput {
	readonly project: RecordingProject;
	readonly labelTrackName: string;
	readonly projectSampleRate: number;
	readonly createId: (prefix: string) => string;
	readonly timestamps: readonly RecordingActivationTimestamp[];
}

/** Build point labels in the same transaction as the compacted recording. */
export function createSoundActivationTimestampCommands(input: TimestampCommandInput) {
	if (!input.timestamps.length) return [];
	const existingTrack = input.project.tracks.find((track) => track.type === 'label' && track.locked !== true);
	const labelTrackId = existingTrack?.id ?? input.createId('label-track');
	const commands: Array<ReturnType<typeof createAddLabelTrackCommand> | ReturnType<typeof createAddLabelCommand>> = [];
	if (!existingTrack) commands.push(createAddLabelTrackCommand({
		id: labelTrackId,
		name: input.labelTrackName,
	}));
	const events = input.timestamps.map((timestamp) => ({
		frame: timestamp.startFrame + scaleSampleFrame(
			timestamp.offsetFrames,
			timestamp.sampleRate,
			input.projectSampleRate,
			'point',
		),
		occurredAtMs: timestamp.occurredAtMs,
	})).sort((left, right) => left.frame - right.frame);
	for (const { frame, occurredAtMs } of events) {
		commands.push(createAddLabelCommand(labelTrackId, {
			id: input.createId('label'),
			title: formatWallClockTime(occurredAtMs),
			startFrame: frame,
			endFrame: frame,
		}));
	}
	return commands;
}

function formatWallClockTime(occurredAtMs: number): string {
	const date = new Date(occurredAtMs);
	if (Number.isNaN(date.getTime())) throw new RangeError('The sound activation wall-clock time is invalid.');
	const twoDigits = (value: number) => String(value).padStart(2, '0');
	const offsetMinutes = -date.getTimezoneOffset();
	const sign = offsetMinutes < 0 ? '-' : '+';
	const offset = Math.abs(offsetMinutes);
	return `${String(date.getFullYear()).padStart(4, '0')}-${twoDigits(date.getMonth() + 1)}-${twoDigits(date.getDate())}`
		+ `T${twoDigits(date.getHours())}:${twoDigits(date.getMinutes())}:${twoDigits(date.getSeconds())}`
		+ `.${String(date.getMilliseconds()).padStart(3, '0')}${sign}${twoDigits(Math.floor(offset / 60))}:${twoDigits(offset % 60)}`;
}
