/* SPDX-License-Identifier: AGPL-3.0-only */

/** Run one encode while retaining its primary failure if exact resource disposal also fails. */
export async function runFramescaperFinishingEncode<Result>(
	encode: () => PromiseLike<Result> | Result,
	dispose: () => PromiseLike<void> | void,
): Promise<Result> {
	let result: Result;
	try {
		result = await encode();
	} catch (error) {
		try { await dispose(); } catch (cleanupError) {
			throw finishingEncodeCleanupError(error, cleanupError);
		}
		throw error;
	}
	await dispose();
	return result;
}

function finishingEncodeCleanupError(primary: unknown, cleanup: unknown): AggregateError {
	return new AggregateError(
		[primary, cleanup], 'finishing picture export and cleanup failed.', { cause: primary },
	);
}
