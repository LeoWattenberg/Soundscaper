/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	LINKED_ORIGINAL_PROJECT_INDEX_NAME,
	LINKED_ORIGINAL_STORE_NAME,
	linkedOriginalBindingKey,
} from './linked-original-schema.ts';

export const LINKED_VIDEO_ORIGINAL_STORE_NAME = LINKED_ORIGINAL_STORE_NAME;
export const LINKED_VIDEO_ORIGINAL_PROJECT_INDEX_NAME = LINKED_ORIGINAL_PROJECT_INDEX_NAME;

/** Compatibility key for the maintained linked-video API. */
export function linkedVideoOriginalBindingKey(projectId: unknown, sourceId: unknown): string {
	return linkedOriginalBindingKey(projectId, sourceId);
}
