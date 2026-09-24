/* SPDX-License-Identifier: AGPL-3.0-only */

/** Keep the canonical storage result; project publication can compact source metadata. */
export async function saveFencedProjectSnapshot<Project extends Readonly<{ id: string }>, Options>(
	save: (expected: Project, snapshot: Project, writeFence: string, options: Options) => Promise<unknown>,
	expected: Project,
	snapshot: Project,
	writeFence: string,
	options: Options,
): Promise<Project | null> {
	const saved = await save(expected, snapshot, writeFence, options);
	if (saved === null) return null;
	if (!saved || typeof saved !== 'object' || (saved as { id?: unknown }).id !== snapshot.id) {
		throw new Error('Project storage returned an invalid saved snapshot.');
	}
	return saved as Project;
}
