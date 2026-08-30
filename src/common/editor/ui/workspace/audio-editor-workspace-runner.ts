/* SPDX-License-Identifier: AGPL-3.0-only */

export type AudioEditorWorkspaceRunner = (operation: () => unknown) => unknown;

export function runAwaitedAudioEditorOperation<Result>(
	run: AudioEditorWorkspaceRunner,
	operation: () => Result | PromiseLike<Result>,
): Promise<Awaited<Result>> {
	return Promise.resolve().then(() => {
		let failedSynchronously = false;
		let synchronousFailure: unknown;
		const result = run(() => {
			try {
				return operation();
			} catch (error) {
				failedSynchronously = true;
				synchronousFailure = error;
				throw error;
			}
		});
		if (failedSynchronously) throw synchronousFailure;
		return result as Result | PromiseLike<Result>;
	}) as Promise<Awaited<Result>>;
}
