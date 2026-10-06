/* SPDX-License-Identifier: AGPL-3.0-only */

type Awaitable<Value> = Value | PromiseLike<Value>;
export interface ConsolidationFailure { readonly error: unknown }

/** Retain the primary failure while still awaiting the owned cleanup. */
export async function cleanupConsolidation(
	cleanup: () => Awaitable<unknown>, primary?: ConsolidationFailure,
): Promise<void> {
	try { await cleanup(); } catch (error) {
		if (primary) throw consolidationCleanupFailure(primary.error, error);
		throw error;
	}
}

function consolidationCleanupFailure(primary: unknown, cleanup: unknown): AggregateError {
	return new AggregateError([primary, cleanup], 'Consolidation and owned-resource cleanup failed.', { cause: primary });
}

/** Cleanup runs exactly once, whether the operation succeeds or rejects. */
export async function withConsolidationCleanup<Value>(
	operation: () => Awaitable<Value>, cleanup: () => Awaitable<unknown>,
): Promise<Value> {
	let value: Value;
	try { value = await operation(); } catch (error) {
		await cleanupConsolidation(cleanup, { error });
		throw error;
	}
	await cleanupConsolidation(cleanup);
	return value;
}
