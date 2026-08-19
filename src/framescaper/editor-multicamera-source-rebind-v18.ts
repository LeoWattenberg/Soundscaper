/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Follow a source identity change into the groups that name it.
 *
 * A .scape import reassigns a source id when it collides with one the recipient
 * already holds, and the generic remapper rewrites the references the shared
 * schema owns — clips, bin clips, freeze roots, take groups. A multicamera
 * member's `sourceId` is Framescaper's own, so it has to be rebound here, or the
 * group is left naming a source the imported document no longer contains: every
 * angle but the active one is unresolvable, and switching to one refuses.
 */
export function rebindFramescaperMulticameraSourceIdentitiesV18(
	projectValue: Record<string, unknown>,
	sourceIdMap: ReadonlyMap<string, string>,
): void {
	if (![...sourceIdMap].some(([sourceId, replacement]) => sourceId !== replacement)) return;
	const groups = projectValue?.multicameraGroups;
	if (!Array.isArray(groups)) return;
	for (const group of groups as Record<string, unknown>[]) {
		const members = group?.members;
		if (!Array.isArray(members)) continue;
		group.members = (members as Record<string, unknown>[]).map((member) => {
			const replacement = sourceIdMap.get(String(member?.sourceId));
			return replacement === undefined || replacement === member.sourceId
				? member
				: { ...member, sourceId: replacement };
		});
	}
}
