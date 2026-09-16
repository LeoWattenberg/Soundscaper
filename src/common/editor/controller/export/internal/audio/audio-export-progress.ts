/* SPDX-License-Identifier: AGPL-3.0-only */

import type { EditorTaskProgressHandle } from '../../../shared/task-progress.ts';

export interface AudioEncodingProgressRange {
	readonly start: number;
	readonly end: number;
}

export const NO_AUDIO_EXPORT_PROGRESS = Object.freeze({
	setPhase: () => false,
	setCancellation: () => false,
	update: () => false,
	finish: () => false,
});

/** Final destination writes retain the foreground task's cancellation and progress. */
export function audioExportPublicationProgress(
	task: Pick<EditorTaskProgressHandle, 'setPhase' | 'update'>,
	label: string,
	signal: AbortSignal, localization?: import('../../../../../i18n/presentation-message.ts').LocalizedPresentationMessage,
) {
	task.setPhase(label, { start: 0.95, end: 1, value: 0 }, localization);
	return { signal, onProgress: (value: number): void => { task.update(value); } };
}
