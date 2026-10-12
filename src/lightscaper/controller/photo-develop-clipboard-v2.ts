/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ImageDevelopStateV2 } from '../../common/editor/imaging/image-develop-state-v2.ts';
import type { PhotoDevelopV1 } from '../catalog/types.ts';
import { createPhotoDevelopClipboardForProfileV1, normalizePhotoDevelopClipboardForProfileV1,
	normalizePhotoDevelopClipboardCurrentForProfileV1, readPhotoDevelopClipboardJsonV1 } from './internal/photo-develop-clipboard-kernel-v1.ts';

export interface PhotoDevelopClipboardV2 {
	readonly schemaFamily: 'lightscaper';
	readonly schemaVersion: 2;
	readonly kind: 'photo-develop-clipboard';
	readonly develop: PhotoDevelopV1 | ImageDevelopStateV2;
}

/** Permanent strict legacy2 policy and unchanged deterministic wire bytes. */
export function createPhotoDevelopClipboardV2(value: unknown) { return createPhotoDevelopClipboardForProfileV1('legacy2', value); }
export function normalizePhotoDevelopClipboardV2(value: unknown) { return normalizePhotoDevelopClipboardForProfileV1('legacy2', value); }
export function serializePhotoDevelopClipboardV2(value: unknown): string { return JSON.stringify(normalizePhotoDevelopClipboardV2(value)); }
export function parsePhotoDevelopClipboardV2(value: string) { return normalizePhotoDevelopClipboardV2(readPhotoDevelopClipboardJsonV1(value)); }
export function normalizePhotoDevelopClipboardV1OrV2(value: unknown) { return normalizePhotoDevelopClipboardCurrentForProfileV1('legacy2', value); }
export function serializePhotoDevelopClipboardV1OrV2(value: unknown): string { return JSON.stringify(normalizePhotoDevelopClipboardV1OrV2(value)); }
export function parsePhotoDevelopClipboardV1OrV2(value: string) { return normalizePhotoDevelopClipboardV1OrV2(readPhotoDevelopClipboardJsonV1(value)); }
