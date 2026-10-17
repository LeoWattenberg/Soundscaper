/* SPDX-License-Identifier: AGPL-3.0-only */
interface SourceMonitorIdentity {
	readonly sourceId: string | null;
	readonly openRevision: number;
	readonly project: unknown;
}
interface SourceMonitorOwner {
	getSnapshot(): Readonly<{ project: unknown }>;
	readonly actions: Readonly<{ video: Readonly<{ sourceMonitor: Readonly<{
		view(): Readonly<{ sourceId: string | null; openRevision: number }>;
	}> }> }>;
}

/** Controller adoption is synchronous; React's retired render may still finish before effect cleanup. */
export function sourceMonitorIdentityIsCurrent(owner: SourceMonitorOwner, expected: SourceMonitorIdentity): boolean {
	if (expected.sourceId === null || owner.getSnapshot().project !== expected.project) return false;
	const current = owner.actions.video.sourceMonitor.view();
	return current.sourceId === expected.sourceId && current.openRevision === expected.openRevision;
}
