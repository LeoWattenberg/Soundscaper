/* SPDX-License-Identifier: AGPL-3.0-only */

import { resolveSelectedAudioWarpAuthority } from '../selected-audio-warp-authority.ts';

export interface AudioWarpApplicationMenuInput {
	readonly productId: string;
	readonly capability: boolean;
	readonly project: unknown;
	readonly selectedClipId: string | null;
	readonly editingBlocked: boolean;
	readonly copy: Readonly<Record<string, string>>;
	open(): unknown;
}

/** Menu-only selected-audio entry point; Framescaper receives no item. */
export function createAudioWarpApplicationMenuItems(input: AudioWarpApplicationMenuInput) {
	if (input.productId !== 'soundscaper' || !input.capability) return Object.freeze([]);
	const target = resolveSelectedAudioWarpAuthority(input.project, input.selectedClipId)?.target ?? null;
	return Object.freeze([Object.freeze({
		id: 'audio-warp-editor',
		label: input.copy.audioWarpMenu,
		disabled: target === null || input.editingBlocked || target.track.locked === true,
		onClick: input.open,
	})]);
}
