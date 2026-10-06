/* SPDX-License-Identifier: AGPL-3.0-only */

import { syncBuiltinESMExports } from 'node:module';
import type { TestContext } from 'node:test';

/** In-memory lease drivers need expiry ordering without the packaged wait. */
export async function withMockLeaseExpiry<T>(
	context: TestContext,
	workflowId: string,
	run: () => Promise<T>,
): Promise<T> {
	context.mock.timers.enable({ apis: ['setTimeout'] });
	syncBuiltinESMExports();
	try {
		const pending = run();
		if (workflowId === 'stale-lease-takeover' || workflowId === 'crash-restart-recovery') {
			// The crash resolves before the production case schedules its timer.
			await Promise.resolve();
			context.mock.timers.runAll();
		}
		return await pending;
	} finally {
		context.mock.timers.reset();
		syncBuiltinESMExports();
	}
}
