/* SPDX-License-Identifier: AGPL-3.0-only */

import { resolveSelectedVideoCompositionClip } from './video-composition-dialog-model.ts';

export interface VideoCompositionApplicationMenuInput {
	readonly productId: string;
	readonly capability: boolean;
	readonly project: unknown;
	readonly selectedClipId: string | null;
	readonly editingBlocked: boolean;
	readonly copy: Readonly<Record<string, string>>;
	open(): unknown;
}

/** Menu-only selected-video entry point; unsupported product profiles receive no item. */
export function createVideoCompositionApplicationMenuItems(
	input: VideoCompositionApplicationMenuInput,
) {
	if (input.productId !== 'framescaper' || !input.capability) return Object.freeze([]);
	const selected = resolveSelectedVideoCompositionClip(input.project, input.selectedClipId);
	return Object.freeze([Object.freeze({
		id: 'video-composition-editor',
		label: input.copy.videoCompositionMenu || 'Transform and compositing…',
		disabled: !selected || selected.locked || input.editingBlocked,
		onClick: input.open,
	})]);
}
