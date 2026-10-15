/* SPDX-License-Identifier: AGPL-3.0-only */

interface WorkspaceFocusOwner {
	readonly activeElement?: unknown;
	readonly body?: unknown;
	readonly documentElement?: unknown;
}

const currentRequests = new WeakMap<WorkspaceFocusOwner, symbol>();

/**
 * A deferred panel handoff may follow an unmounted control, but must yield to
 * a newer handoff or a control the user has chosen while it waits for React.
 * The previous trigger may briefly regain focus when its menu closes.
 */
export function createWorkspaceFocusRequest(
	owner: WorkspaceFocusOwner,
	previous: unknown = null,
): () => boolean {
	const original = owner.activeElement;
	const request = Symbol('workspace focus request');
	currentRequests.set(owner, request);
	return () => {
		if (currentRequests.get(owner) !== request) return false;
		const active = owner.activeElement;
		if (active == null || active === owner.body || active === owner.documentElement
			|| active === original || active === previous) return true;
		currentRequests.delete(owner);
		return false;
	};
}
