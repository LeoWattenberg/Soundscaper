/* SPDX-License-Identifier: AGPL-3.0-only */
import { AUDIO_EDITOR_RESERVED_SHORTCUTS, findAudioEditorShortcutConflicts } from '../../preferences.js';
import { audioEditorShortcutConflictKey, normalizeAudioEditorShortcut } from '../../audio-editor-shortcut-normalization.ts';
import { resolveAudacityActionId } from '../../audacity-action-parity.js';

type ShortcutMap = Readonly<Record<string, readonly string[]>>;
interface Owner { readonly id: string; readonly order: number; readonly position: number; readonly binding: string }
export interface DraftConflict { readonly binding: string; readonly actionIds: readonly string[] }

/** Invocation-local index of the canonical preference snapshot, shared by its mounted rows. */
export function createShortcutDraftConflictIndex(shortcuts: ShortcutMap): (id: string, bindings: readonly string[]) => DraftConflict | null {
	const reserved = AUDIO_EDITOR_RESERVED_SHORTCUTS as ShortcutMap;
	const ids = Object.keys(shortcuts); const order = new Map(ids.map((id, index) => [id, index]));
	const canonicalId = (id: string) => id !== 'play' && id !== 'quick-help' && resolveAudacityActionId(id) === id;
	if (ids.some(id => !canonicalId(id))) return (id, bindings) => findAudioEditorShortcutConflicts({ ...shortcuts, [id]: bindings }).find(entry => entry.actionIds.includes(id)) ?? null;
	for (const id of Object.keys(reserved)) if (!order.has(id)) order.set(id, order.size);
	const byBinding = new Map<string, Owner[]>();
	for (const [id, bindings] of Object.entries({ ...shortcuts, ...reserved })) {
		for (const [position, binding] of bindings.entries()) {
			const key = audioEditorShortcutConflictKey(binding); const owners = byBinding.get(key) ?? [];
			if (!owners.some(owner => owner.id === id)) owners.push({ id, order: order.get(id)!, position, binding: normalizeAudioEditorShortcut(binding) });
			byBinding.set(key, owners);
		}
	}
	return (id, bindings) => {
		// The reserved entry overwrites this row in the ordinary validator too.
		if (Object.hasOwn(reserved, id) || !canonicalId(id)) return findAudioEditorShortcutConflicts({ ...shortcuts, [id]: bindings }).find(entry => entry.actionIds.includes(id)) ?? null;
		const targetOrder = order.get(id) ?? ids.length;
		let first: { order: number; position: number; conflict: DraftConflict } | null = null;
		for (const [position, binding] of bindings.entries()) {
			const owners = (byBinding.get(audioEditorShortcutConflictKey(binding)) ?? []).filter(owner => owner.id !== id);
			if (!owners.length) continue;
			const target = { id, order: targetOrder, position, binding: normalizeAudioEditorShortcut(binding) };
			const entries = [...owners.map(owner => !order.has(id) && owner.order >= ids.length ? { ...owner, order: owner.order + 1 } : owner), target].sort((a, b) => a.order - b.order);
			const earliest = entries[0]!;
			if (!first || earliest.order < first.order || (earliest.order === first.order && earliest.position < first.position)) {
				first = { order: earliest.order, position: earliest.position, conflict: { binding: earliest.binding, actionIds: entries.map(entry => entry.id) } };
			}
		}
		return first?.conflict ?? null;
	};
}
