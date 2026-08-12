/* SPDX-License-Identifier: AGPL-3.0-only */

import { createAudioWarpApplicationMenuItems } from './audio-warp-application-menu.ts';

export interface PitchTempoApplicationMenuInput {
	readonly productId: string;
	readonly capabilities: Readonly<{ readonly audioWarp?: unknown }>;
	readonly project: unknown;
	readonly selectedClipId: string | null;
	readonly selectedAudioTrack: unknown;
	readonly editingBlocked: boolean;
	readonly copy: Readonly<Record<string, string>>;
	readonly effectLabels: ReadonlyMap<string, string>;
	readonly actions: Readonly<{
		openAudioWarp(): unknown;
		openSelectionEffect(type: string): unknown;
	}>;
}

/** Focused ownership for the near-limit Effect > Pitch and Tempo submenu. */
export function createPitchAndTempoApplicationMenuItems(input: PitchTempoApplicationMenuInput) {
	const effectDisabled = input.editingBlocked || !input.selectedAudioTrack;
	return Object.freeze([
		...createAudioWarpApplicationMenuItems({
			productId: input.productId,
			capability: Boolean(input.capabilities.audioWarp),
			project: input.project,
			selectedClipId: input.selectedClipId,
			editingBlocked: input.editingBlocked,
			copy: input.copy,
			open: input.actions.openAudioWarp,
		}),
		Object.freeze({ id: 'change-pitch', label: input.copy.changePitch, disabled: effectDisabled, onClick: () => input.actions.openSelectionEffect('audacity-change-pitch') }),
		Object.freeze({ id: 'change-tempo', label: input.copy.changeTempo, disabled: effectDisabled, onClick: () => input.actions.openSelectionEffect('audacity-change-tempo') }),
		Object.freeze({ id: 'effect://builtin/change-speed-pitch', label: input.copy.changeSpeedPitch, disabled: effectDisabled, onClick: () => input.actions.openSelectionEffect('audacity-change-speed-pitch') }),
		Object.freeze({ id: 'effect://builtin/sliding-stretch', label: input.copy.slidingStretch, disabled: effectDisabled, onClick: () => input.actions.openSelectionEffect('audacity-sliding-stretch') }),
		...(input.effectLabels.has('audacity-paulstretch') ? [Object.freeze({
			id: 'audacity-paulstretch',
			label: input.effectLabels.get('audacity-paulstretch') || 'Paulstretch',
			disabled: effectDisabled,
			onClick: () => input.actions.openSelectionEffect('audacity-paulstretch'),
		})] : []),
	]);
}
