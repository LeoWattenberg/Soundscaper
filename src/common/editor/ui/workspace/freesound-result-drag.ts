/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	AUDIO_EDITOR_FREESOUND_RESULT_DRAG_TYPE,
	createFreesoundResultDragPayload,
	parseFreesoundResultDragPayload,
} from '../../project-bin-dnd.js';

export const FREESOUND_RESULT_DRAG_MIME_TYPE = AUDIO_EDITOR_FREESOUND_RESULT_DRAG_TYPE;

export interface FreesoundResultDragPayload {
	readonly schemaVersion: 1;
	readonly soundId: number;
}

export function encodeFreesoundResultDragPayload(soundId: number): string {
	return createFreesoundResultDragPayload(soundId);
}

export function decodeFreesoundResultDragPayload(value: string): FreesoundResultDragPayload | null {
	return parseFreesoundResultDragPayload(value) as FreesoundResultDragPayload | null;
}
