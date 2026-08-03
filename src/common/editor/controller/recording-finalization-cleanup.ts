/* SPDX-License-Identifier: AGPL-3.0-only */

interface CommittedRecordingSourceCleanup {
	readonly sourceId: string;
	deactivateSource(sourceId: string): PromiseLike<void> | void;
	deleteAnalysis?(sourceId: string): PromiseLike<unknown> | unknown;
	deleteStoredSource(sourceId: string): PromiseLike<unknown> | unknown;
}

/** Fence a committed source provider before deleting any of its backing data. */
export async function cleanupCommittedRecordingSource(
	cleanup: CommittedRecordingSourceCleanup,
): Promise<unknown[]> {
	try {
		await cleanup.deactivateSource(cleanup.sourceId);
	} catch (error) {
		return [error];
	}
	const failures: unknown[] = [];
	if (cleanup.deleteAnalysis) {
		try {
			await cleanup.deleteAnalysis(cleanup.sourceId);
		} catch (error) {
			failures.push(error);
		}
	}
	try {
		await cleanup.deleteStoredSource(cleanup.sourceId);
	} catch (error) {
		failures.push(error);
	}
	return failures;
}

export function throwRecordingFinalizationFailure(
	primaryFailure: unknown,
	cleanupFailures: readonly unknown[],
): never {
	if (cleanupFailures.length) {
		throw new AggregateError(
			[primaryFailure, ...cleanupFailures],
			'Recording finalization and source rollback both failed.',
			{ cause: primaryFailure },
		);
	}
	throw primaryFailure;
}
