/* SPDX-License-Identifier: AGPL-3.0-only */

interface BinMoveClip { readonly id: string; readonly kind?: unknown; readonly avLinkId?: unknown }

/** Resolve each moved A/V item once, retaining project order and its first video ID. */
export function movedBinItemIds<Clip extends BinMoveClip>(clips: readonly Clip[]): Map<string, string> {
	const ids = new Set<string>();
	const linked = new Map<unknown, Clip[]>();
	let duplicates = false;
	for (const clip of clips) {
		if (ids.has(clip.id)) duplicates = true;
		ids.add(clip.id);
		if (!clip.avLinkId) continue;
		const members = linked.get(clip.avLinkId);
		if (members) members.push(clip);
		else linked.set(clip.avLinkId, [clip]);
	}
	const items = new Map<string, string>();
	const seen = new Set<unknown>();
	for (const clip of clips) {
		if (!duplicates && clip.avLinkId && seen.has(clip.avLinkId)) continue;
		const members = clip.avLinkId ? linked.get(clip.avLinkId)! : [clip];
		const id = members.find(member => member.kind === 'video')?.id || members[0]?.id || clip.id;
		for (const member of members) items.set(member.id, id);
		seen.add(clip.avLinkId);
	}
	return items;
}
