/* SPDX-License-Identifier: AGPL-3.0-only */

import { AUDACITY_SHORTCUT_BINDINGS_BY_ACTION } from '../../audacity-shortcut-bindings.ts';
import { matchesAudioEditorShortcutBinding } from '../workspace-shortcuts.ts';

interface ClosestElement {
	closest(selector: string): ClosestElement | null;
	querySelectorAll(selector: string): ArrayLike<ClosestElement>;
}

interface RealtimeEffectShortcutEvent {
	readonly altKey: boolean;
	readonly code: string;
	readonly ctrlKey: boolean;
	readonly key: string;
	readonly metaKey: boolean;
	readonly shiftKey: boolean;
	readonly target: EventTarget | null;
	preventDefault(): void;
	stopPropagation(): void;
}

interface RealtimeEffectSection {
	readonly effects: readonly Readonly<{ id: string }>[];
	readonly scope: 'group' | 'send' | 'track';
	readonly targetId: string | null;
}

type ReorderRealtimeEffect = (
	scope: 'group' | 'master' | 'send' | 'track',
	targetId: string | null,
	effectId: string,
	toIndex: number,
) => unknown;

type ShortcutBindings = Readonly<Record<string, readonly string[]>>;

export function createAudacityRealtimeEffectShortcutHandler(
	reorder: ReorderRealtimeEffect,
	channel: RealtimeEffectSection | null,
	masterEffects: readonly Readonly<{ id: string }>[],
	shortcuts: ShortcutBindings = AUDACITY_SHORTCUT_BINDINGS_BY_ACTION,
	disabled = false,
) {
	return (event: RealtimeEffectShortcutEvent): boolean => {
		const direction = shortcutDirection(event, shortcuts);
		if (direction === null) return false;
		const target = closestCapable(event.target);
		const slot = target?.closest('.effect-slot');
		const stack = slot?.closest('.effects-panel__effect-stack');
		if (!slot || !stack) return false;
		const slots = Array.from(stack.querySelectorAll('.effect-slot'))
			.filter((candidate) => candidate.closest('.effects-panel__effect-stack') === stack);
		const index = slots.indexOf(slot);
		const master = Boolean(slot.closest('.effects-panel__master-section'));
		const section = master
			? { effects: masterEffects, scope: 'master' as const, targetId: null }
			: channel;
		const effect = index >= 0 ? section?.effects[index] : null;
		if (!section || !effect) return false;
		event.preventDefault();
		event.stopPropagation();
		const toIndex = index + direction;
		if (!disabled && toIndex >= 0 && toIndex < section.effects.length) {
			reorder(section.scope, section.targetId, effect.id, toIndex);
		}
		return true;
	};
}

function shortcutDirection(event: RealtimeEffectShortcutEvent, shortcuts: ShortcutBindings): -1 | 1 | null {
	for (const [actionId, direction] of [
		['realtime-effect-move-up', -1],
		['realtime-effect-move-down', 1],
	] as const) {
		const bindings = shortcuts[actionId] || [];
		if (bindings.some((binding) => matchesAudioEditorShortcutBinding(event, binding))) return direction;
	}
	return null;
}

function closestCapable(target: EventTarget | null): ClosestElement | null {
	if (!target || typeof (target as Partial<ClosestElement>).closest !== 'function') return null;
	return target as unknown as ClosestElement;
}
