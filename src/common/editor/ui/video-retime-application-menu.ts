/* SPDX-License-Identifier: AGPL-3.0-only */

import { VIDEO_RETIME_ADDITIONAL_COPY } from '../../i18n/editor-video-retime-additional-copy.ts';

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
		label: `${input.copy['ui.videoRetime.videoRetimeMenu'] ?? input.copy.videoRetimeMenu ?? VIDEO_RETIME_ADDITIONAL_COPY.videoRetimeMenu}…`,
		disabled: model.blockReason !== null,
		onClick: input.open,
	})]);
}
