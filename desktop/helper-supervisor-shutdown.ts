/* SPDX-License-Identifier: AGPL-3.0-only */

/** Fail-closed graceful ownership of the legacy assistance helper's current and spawning generations. */

import { validateHelperHostMessage } from './helper-contract.ts';
import type { HelperChannel } from './helper-supervisor-contracts.ts';
import { HelperSupervisionError } from './helper-supervision-state.ts';
import { awaitGracefulHelperShutdown } from './graceful-helper-shutdown.ts';

export function shutdownSupervisedHelperChannel(
	channel: HelperChannel,
	timeoutMs: number,
	setTimeoutImpl: typeof setTimeout,
	clearTimeoutImpl: typeof clearTimeout,
): Promise<void> {
	return awaitGracefulHelperShutdown({
		channel, message: validateHelperHostMessage({ contractVersion: 1, type: 'shutdown' }),
		timeoutMs, label: 'assistance helper', setTimeoutImpl, clearTimeoutImpl,
	});
}

export async function awaitHelperSupervisorShutdown(
	channel: HelperChannel | null,
	starting: Promise<void> | null,
	timeoutMs: number,
	setTimeoutImpl: typeof setTimeout,
	clearTimeoutImpl: typeof clearTimeout,
): Promise<void> {
	const tasks: Promise<void>[] = [];
	if (channel) tasks.push(shutdownSupervisedHelperChannel(
		channel, timeoutMs, setTimeoutImpl, clearTimeoutImpl,
	));
	if (starting) tasks.push(starting.catch((error: unknown) => {
		if (!(error instanceof HelperSupervisionError) || error.cause_ !== 'disposed') throw error;
	}));
	const results = await Promise.allSettled(tasks);
	const failures = results.flatMap((result) => result.status === 'rejected' ? [result.reason] : []);
	if (failures.length) throw new AggregateError(failures,
		'The assistance helper did not complete graceful shutdown.');
}
