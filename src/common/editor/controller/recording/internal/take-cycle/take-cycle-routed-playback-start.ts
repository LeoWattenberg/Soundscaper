/* SPDX-License-Identifier: AGPL-3.0-only */

import { CLOCKED_RECORDING_START_LEAD_SECONDS } from '../../../../recording-start-lead.ts';
import { secondsToSampleFrame } from '../../../../timeline-time.ts';
import { audibleRecordingStartTime } from '../recording-start-timing.ts';
import { confirmRoutedRecordingStart } from '../confirmed-recording-sources.ts';
import type {
	RecordingCaptureControllerLike,
	RoutedRecordingSourceSession,
} from '../recording-session-service.ts';
import type { TakeCycleRoutedCaptureEngine } from './take-cycle-routed-capture-types.ts';

interface ClockedContext {
	readonly currentTime: number;
	readonly sampleRate: number;
}

interface ControlledSource {
	readonly kind: 'device' | 'display';
	readonly controller: RecordingCaptureControllerLike | null;
}

/** Arm every take-cycle input on the audio clock before playback sources start. */
export async function startTakeCycleRoutedPlayback({
	context, engine, loopStartFrame, sources, assertCurrent,
}: Readonly<{
	context: ClockedContext;
	engine: Pick<TakeCycleRoutedCaptureEngine, 'playAt' | 'getPlaybackGraphLatencyFrames'>;
	loopStartFrame: number;
	sources: readonly ControlledSource[];
	assertCurrent: () => void;
}>): Promise<void> {
	const controlled = sources.map((source) => {
		if (!source.controller) throw new Error('No routed take cycle recorder is available.');
		return { kind: source.kind, controller: source.controller };
	});
	if (!controlled.length) throw new Error('No routed take cycle recorder is available.');
	const scheduledTime = context.currentTime + CLOCKED_RECORDING_START_LEAD_SECONDS;
	let recorderArmed = false;
	const playbackStartTime = await engine.playAt(scheduledTime, loopStartFrame, async (candidate) => {
		assertCurrent();
		const requestedFrame = secondsToSampleFrame(audibleRecordingStartTime(
			candidate, scheduledTime, engine.getPlaybackGraphLatencyFrames?.() ?? 0, context.sampleRate,
		), context.sampleRate, 'enclosingEnd');
		const sessions: RoutedRecordingSourceSession[] = controlled.map((source) => ({
			kind: source.kind, controller: source.controller,
			disconnected: false, stopped: false, startFrame: requestedFrame,
		}));
		const confirmedFrame = await confirmRoutedRecordingStart(
			sessions,
			(attempt) => secondsToSampleFrame(context.currentTime
				+ CLOCKED_RECORDING_START_LEAD_SECONDS * 2 ** attempt, context.sampleRate, 'enclosingEnd'),
			() => secondsToSampleFrame(context.currentTime, context.sampleRate, 'enclosingEnd'),
		);
		assertCurrent();
		recorderArmed = true;
		return candidate + (confirmedFrame - requestedFrame) / context.sampleRate;
	});
	assertCurrent();
	if (recorderArmed) return;
	// Older engine integrations ignore the optional pre-start callback.
	const startFrame = secondsToSampleFrame(audibleRecordingStartTime(
		playbackStartTime, scheduledTime,
		engine.getPlaybackGraphLatencyFrames?.() ?? 0, context.sampleRate,
	), context.sampleRate, 'enclosingEnd');
	for (const source of controlled) {
		source.controller.start({ startFrame });
		assertCurrent();
	}
}
