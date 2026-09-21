/* SPDX-License-Identifier: AGPL-3.0-only */

/** Runs ordered cleanup phases while retaining every failure until all assistance helpers have flushed. */

export async function awaitAssistanceCleanupPhases(
	phases: readonly (readonly (() => void | Promise<void>)[])[],
): Promise<void> {
	const failures: unknown[] = [];
	for (const phase of phases) {
		const results = await Promise.allSettled(phase.map((run) => Promise.resolve().then(run)));
		for (const result of results) if (result.status === 'rejected') failures.push(result.reason);
	}
	if (failures.length) throw new AggregateError(failures,
		'Local assistance cleanup did not complete successfully.');
}
