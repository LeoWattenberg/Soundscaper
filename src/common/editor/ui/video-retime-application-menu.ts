/* SPDX-License-Identifier: AGPL-3.0-only */

import { createVideoRetimeDialogModel } from './video-retime-dialog-model.ts';

export interface VideoRetimeApplicationMenuInput {
	readonly productId: string;
	readonly capability: boolean;
	readonly project: unknown;
	readonly selectedClipId: string | null;
	readonly editingBlocked: boolean;
	readonly copy: Readonly<Record<string, string | undefined>>;
	open(): unknown;
}

/** A single Framescaper-v1 entry; the editor itself is loaded only after activation. */
export function createVideoRetimeApplicationMenuItems(input: VideoRetimeApplicationMenuInput) {
	if (input.productId !== 'framescaper' || !input.capability) return Object.freeze([]);
	const model = createVideoRetimeDialogModel(input);
	if (model.blockReason === 'unsupported') return Object.freeze([]);
	return Object.freeze([Object.freeze({
		id: 'video-retime-editor',
		label: input.copy.videoRetimeMenu ?? 'Video retime…',
		disabled: model.blockReason !== null,
		onClick: input.open,
	})]);
}
