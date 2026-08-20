/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	FramescaperCaptureDurablePort,
	FramescaperCaptureDurableSession,
} from './framescaper-capture-session-types.ts';

const MAXIMUM_RECOVERY_PROJECTS = 4_096;

/** Scan current-first project ownership and admit at most one global recovery. */
export async function findFramescaperCaptureRecovery(
	durable: Pick<FramescaperCaptureDurablePort, 'findRecovery'>,
	currentProjectId: string | null,
	projectInventory?: (() => PromiseLike<readonly string[]> | readonly string[]) | null,
): Promise<FramescaperCaptureDurableSession | null> {
	const projectIds = currentProjectId === null ? [] : [projectId(currentProjectId)];
	if (projectInventory) {
		const inventory = await projectInventory();
		if (!Array.isArray(inventory) || inventory.length > MAXIMUM_RECOVERY_PROJECTS) {
			throw new RangeError('Framescaper capture recovery project inventory is invalid.');
		}
		for (const value of inventory) {
			const id = projectId(value);
			if (!projectIds.includes(id)) projectIds.push(id);
		}
	}
	let recovery: FramescaperCaptureDurableSession | null = null;
	for (const id of projectIds) {
		const candidate = await durable.findRecovery(id);
		if (!candidate) continue;
		if (recovery) {
			throw new Error('More than one Framescaper capture recovery session requires maintenance.');
		}
		recovery = candidate;
	}
	return recovery;
}

function projectId(value: unknown): string {
	if (typeof value !== 'string' || !value || value !== value.trim() || value.length > 256
		|| /[\u0000-\u001f\u007f]/u.test(value)) {
		throw new TypeError('Framescaper capture recovery project ID is invalid.');
	}
	return value;
}
