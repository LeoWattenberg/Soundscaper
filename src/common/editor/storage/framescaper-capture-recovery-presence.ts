/* SPDX-License-Identifier: AGPL-3.0-only */

import type { FramescaperCaptureSessionManifestRepository } from
	'./framescaper-capture-session-manifest-repository.ts';

/** The two inventory reads the presence check needs from the manifest repository. */
export type FramescaperCaptureRecoveryPresencePort = Pick<
	FramescaperCaptureSessionManifestRepository,
	'listCreations' | 'listProject'
>;

const MAXIMUM_PRESENCE_PROJECTS = 4_096;

/**
 * Whether durable capture state exists that a recovery scan could admit.
 *
 * The capture runtime is loaded on demand, so its full recovery scan cannot
 * run at startup. This answers the cheaper question first: is there any
 * capture creation journal at all, or any session manifest for the current
 * project or for a project in the inventory. Every session the real scan can
 * recover leaves one of those records behind, so a false negative is not
 * possible; a false positive only loads the runtime one session early.
 *
 * The inventory bound mirrors the recovery scan's own, so a store the scan
 * would refuse is refused here too rather than silently under-read.
 */
export async function framescaperCaptureRecoveryPresent(
	manifests: Readonly<FramescaperCaptureRecoveryPresencePort>,
	currentProjectId: string | null,
	projectInventory: readonly string[] = [],
): Promise<boolean> {
	if (!Array.isArray(projectInventory) || projectInventory.length > MAXIMUM_PRESENCE_PROJECTS) {
		throw new RangeError('Framescaper capture recovery presence inventory is invalid.');
	}
	if ((await manifests.listCreations()).length > 0) return true;
	const projectIds: string[] = [];
	for (const candidate of currentProjectId === null ? projectInventory : [currentProjectId, ...projectInventory]) {
		if (typeof candidate !== 'string' || !candidate) {
			throw new TypeError('Framescaper capture recovery presence project ID is invalid.');
		}
		if (!projectIds.includes(candidate)) projectIds.push(candidate);
	}
	for (const projectId of projectIds) {
		if ((await manifests.listProject(projectId)).length > 0) return true;
	}
	return false;
}
