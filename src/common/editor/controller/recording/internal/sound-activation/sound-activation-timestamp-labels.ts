/* SPDX-License-Identifier: AGPL-3.0-only */

import { createAddLabelCommand, createAddLabelTrackCommand } from '../../../../commands/factories.ts';
import { scaleSampleFrame } from '../../../../timeline-time.ts';
import type { RecordingProject } from '../../recording-transaction-types.ts';

export interface RecordingActivationTimestamp {
	readonly startFrame: number;
	readonly offsetFrames: number;
	readonly sampleRate: number;
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
	const existingTrack = input.project.tracks.find((track) => track.type === 'label');
	const labelTrackId = existingTrack?.id ?? input.createId('label-track');
	const commands: Array<ReturnType<typeof createAddLabelTrackCommand> | ReturnType<typeof createAddLabelCommand>> = [];
	if (!existingTrack) commands.push(createAddLabelTrackCommand({
		id: labelTrackId,
		name: input.labelTrackName,
	}));
	const frames = input.timestamps.map((timestamp) => timestamp.startFrame + scaleSampleFrame(
			timestamp.offsetFrames,
			timestamp.sampleRate,
			input.projectSampleRate,
			'point',
		)).sort((left, right) => left - right);
	for (const frame of frames) {
		commands.push(createAddLabelCommand(labelTrackId, {
			id: input.createId('label'),
			title: formatProjectTime(frame, input.projectSampleRate),
			startFrame: frame,
			endFrame: frame,
		}));
	}
	return commands;
}

function formatProjectTime(frame: number, sampleRate: number): string {
	const totalMilliseconds = Math.round((frame / sampleRate) * 1_000);
	const milliseconds = totalMilliseconds % 1_000;
	const totalSeconds = Math.floor(totalMilliseconds / 1_000);
	const seconds = totalSeconds % 60;
	const minutes = Math.floor(totalSeconds / 60) % 60;
	const hours = Math.floor(totalSeconds / 3_600);
	return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(milliseconds).padStart(3, '0')}`;
}
