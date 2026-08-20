/* SPDX-License-Identifier: AGPL-3.0-only */

export interface CapturedVideoProxyCleanupOperation {
	readonly operationId: string;
	readonly projectId: string;
	readonly sourceId: string;
	readonly baseFingerprint: string;
}

export interface CapturedVideoProxyClaimCleanup {
	cleanupOperation(operation: CapturedVideoProxyCleanupOperation, scope: Readonly<{
		readonly sessionProjects: readonly unknown[];
		readonly histories: readonly unknown[];
		readonly pendingSaveSnapshots: readonly unknown[];
	}>): PromiseLike<Readonly<{ readonly status: 'settled' | 'indeterminate' }>>;
}

export async function cleanupCapturedVideoProxyClaims(
	cleanup: CapturedVideoProxyClaimCleanup,
	operation: CapturedVideoProxyCleanupOperation | null,
	snapshot: Readonly<{ readonly tabs: readonly Readonly<{ readonly history: unknown }>[] }>,
): Promise<unknown[]> {
	if (!operation) return [];
	try {
		const result = await cleanup.cleanupOperation(operation, {
			sessionProjects: snapshot.tabs.map(({ history }) => (
				(history as Readonly<{ readonly present: unknown }>).present
			)),
			histories: snapshot.tabs.map(({ history }) => history),
			pendingSaveSnapshots: [],
		});
		return result.status === 'settled'
			? []
			: [new Error('Captured proxy claim cleanup is indeterminate and retained for startup retry.')];
	} catch (error) { return [error]; }
}
