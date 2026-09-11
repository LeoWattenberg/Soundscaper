/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	AudioEditorCloseGapBehavior,
	AudioEditorDeleteBehavior,
} from './editing-preferences.ts';

export type ConfiguredAudioEditorDeleteBehavior = Exclude<AudioEditorDeleteBehavior, 'not-set'>;

export interface DeleteBehaviorConfirmationRequest {
	readonly title: string;
	readonly initialDeleteBehavior: 'leave-gap';
	readonly initialCloseGapBehavior: AudioEditorCloseGapBehavior;
	readonly signal?: AbortSignal;
}

export type DeleteBehaviorConfirmationDecision =
	| Readonly<{ readonly accepted: false }>
	| Readonly<{
		readonly accepted: true;
		readonly deleteBehavior: ConfiguredAudioEditorDeleteBehavior;
		readonly closeGapBehavior: AudioEditorCloseGapBehavior;
	}>;
