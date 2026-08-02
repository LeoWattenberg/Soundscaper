/* SPDX-License-Identifier: AGPL-3.0-only */

import type { DesktopReadFetch } from '../desktop-read-materialization.ts';
import {
	DESKTOP_LINKED_ORIGINAL_RANGE_MAXIMUM_BYTES,
	readDesktopLinkedOriginalRange,
	type DesktopLinkedOriginalRangeDescriptor,
	type DesktopLinkedOriginalRangeRequest,
} from './desktop-linked-original-range-reader.ts';

export const DESKTOP_LINKED_VIDEO_RANGE_MAXIMUM_BYTES = DESKTOP_LINKED_ORIGINAL_RANGE_MAXIMUM_BYTES;

export type DesktopLinkedVideoRangeDescriptor = DesktopLinkedOriginalRangeDescriptor;
export type DesktopLinkedVideoRangeRequest = DesktopLinkedOriginalRangeRequest;

/** Preserve the existing linked-video transport contract through the shared reader. */
export function readDesktopLinkedVideoRange(
	descriptor: DesktopLinkedVideoRangeDescriptor,
	request: DesktopLinkedVideoRangeRequest,
	fetchRange: DesktopReadFetch,
): Promise<Uint8Array> {
	return readDesktopLinkedOriginalRange(descriptor, request, fetchRange, 'video');
}
