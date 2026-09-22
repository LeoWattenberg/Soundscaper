/* SPDX-License-Identifier: AGPL-3.0-only */

import type { RoutedRecordingSourceSession } from './recording-session-service.ts';

/** Transition every live source, rolling back those already changed if one rejects. */
export function transitionRoutedRecordingSources(
	sourceSessions: readonly RoutedRecordingSourceSession[],
	direction: 'pause' | 'resume',
	beginStop: () => Promise<void>,
): boolean {
	const previousControllerState = direction === 'pause' ? 'recording' : 'paused';
	const nextControllerState = direction === 'pause' ? 'paused' : 'recording';
	const rollbackDirection = direction === 'pause' ? 'resume' : 'pause';
	const transitioned: RoutedRecordingSourceSession[] = [];
	let transitionFailure: unknown = null;
	let rejected = false;
	let uncertainFailure = false;
	for (const session of sourceSessions) {
		if (session.stopped || session.disconnected) continue;
		try {
			const result = session.controller[direction]();
			if (result === false) {
				rejected = true;
				transitionFailure = new Error(`A routed recording source rejected ${direction}.`);
				if (session.controller.state === nextControllerState) transitioned.push(session);
				else if (session.controller.state !== undefined
					&& session.controller.state !== previousControllerState) uncertainFailure = true;
				break;
			}
			transitioned.push(session);
		} catch (error) {
			transitionFailure = error;
			if (session.controller.state === nextControllerState) transitioned.push(session);
			else if (session.controller.state === undefined
				|| session.controller.state !== previousControllerState) uncertainFailure = true;
			break;
		}
	}
	if (transitionFailure === null) return true;

	const rollbackFailures: unknown[] = [];
	for (const session of transitioned.reverse()) {
		try {
			const result = session.controller[rollbackDirection]();
			if (result === false || (session.controller.state !== undefined
				&& session.controller.state !== previousControllerState)) {
				rollbackFailures.push(new Error(
					`A routed recording source rejected the ${direction} rollback.`,
				));
			}
		} catch (error) {
			rollbackFailures.push(error);
		}
	}
	if (uncertainFailure || rollbackFailures.length) {
		void beginStop();
		throw new AggregateError(
			[transitionFailure, ...rollbackFailures],
			`Routed recording ${direction} rollback failed; capture is stopping.`,
		);
	}
	if (rejected) return false;
	throw transitionFailure;
}
