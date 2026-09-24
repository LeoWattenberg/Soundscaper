/* SPDX-License-Identifier: AGPL-3.0-only */

/** The settings row shared by project CAS and exact rollback. */
export function projectWriteFenceKey(projectId: string): string {
	if (typeof projectId !== 'string' || !projectId) throw new TypeError('A project ID is required for a write fence.');
	return `project-write-fence:${projectId}`;
}
