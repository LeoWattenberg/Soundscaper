/* SPDX-License-Identifier: AGPL-3.0-only */

const pending = new Map<string, Promise<void>>();

/** Close waits for the accepted parameter changes while their mounted owner drains. */
export function trackNativePluginParameterWrites(instanceId: string, operation: Promise<void>): void {
	pending.set(instanceId, operation);
	const release = () => { if (pending.get(instanceId) === operation) pending.delete(instanceId); };
	void operation.then(release, release);
}

export function pendingNativePluginParameterWrites(instanceId: string): Promise<void> | null {
	return pending.get(instanceId) ?? null;
}
