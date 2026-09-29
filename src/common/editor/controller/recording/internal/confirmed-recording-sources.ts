/* SPDX-License-Identifier: AGPL-3.0-only */

import type { RoutedRecordingSourceSession } from './recording-session-service.ts';

/** Keep independently acknowledged inputs on the same AudioContext frame. */
export async function confirmRoutedRecordingStart(
	sessions: readonly RoutedRecordingSourceSession[],
	minimumFutureFrame: (attempt: number) => number = () => 0,
	currentFrame: () => number = () => 0,
): Promise<number> {
	const live = sessions.filter((session) => !session.disconnected);
	if (!live.length) throw new Error('No recording input remains to start.');
	const confirmed = await Promise.all(live.map(async (session) => {
		if (!session.controller.startConfirmed || session.startFrame === undefined) {
			throw new Error('A recording input cannot confirm its scheduled start.');
		}
		return session.controller.startConfirmed({ startFrame: session.startFrame, stopFrame: session.stopFrame });
	}));
	let sharedFrame = Math.max(...confirmed.map((result) => result.startFrame));
	for (let attempt = 0; attempt < 4; attempt += 1) {
		const target = Math.max(sharedFrame, minimumFutureFrame(attempt));
		await Promise.all(live.map(async (session, index) => {
			const accepted = confirmed[index];
			if (accepted?.startFrame === target) return;
			if (!session.controller.rescheduleConfirmed || session.startFrame === undefined || !accepted) {
				throw new Error('A recording input cannot move to the shared start frame.');
			}
			const stopFrame = session.stopFrame === undefined ? undefined : session.stopFrame + target - session.startFrame;
			const moved = await session.controller.rescheduleConfirmed({ startFrame: target, stopFrame });
			if (moved.startFrame !== target) throw new Error('A recording input rejected the shared start frame.');
			confirmed[index] = moved;
		}));
		sharedFrame = target;
		if (sharedFrame > currentFrame() + 128) break;
		if (attempt === 3) throw new Error('The recording inputs could not confirm a future shared start frame.');
	}
	for (const session of live) {
		if (session.stopFrame !== undefined && session.startFrame !== undefined) {
			session.stopFrame += sharedFrame - session.startFrame;
		}
		session.startFrame = sharedFrame;
	}
	return sharedFrame;
}
