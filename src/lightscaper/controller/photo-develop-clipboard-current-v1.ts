/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoDevelopClipboardV1 } from './photo-develop-clipboard.ts';
import type { PhotoDevelopClipboardV2 } from './photo-develop-clipboard-v2.ts';
import type { PhotoDevelopClipboardV3 } from './photo-develop-clipboard-v3.ts';
import { createPhotoDevelopClipboardCurrentForProfileV1, normalizePhotoDevelopClipboardCurrentForProfileV1,
	readPhotoDevelopClipboardJsonV1 } from './internal/photo-develop-clipboard-kernel-v1.ts';

export type PhotoDevelopClipboardCurrentV1 = PhotoDevelopClipboardV1 | PhotoDevelopClipboardV2 | PhotoDevelopClipboardV3;

export function createPhotoDevelopClipboardCurrentV1(value: unknown) { return createPhotoDevelopClipboardCurrentForProfileV1(value); }
export function normalizePhotoDevelopClipboardCurrentV1(value: unknown): PhotoDevelopClipboardCurrentV1 {
	return normalizePhotoDevelopClipboardCurrentForProfileV1('current3', value);
}
export function serializePhotoDevelopClipboardCurrentV1(value: unknown): string { return JSON.stringify(normalizePhotoDevelopClipboardCurrentV1(value)); }
export function parsePhotoDevelopClipboardCurrentV1(value: string): PhotoDevelopClipboardCurrentV1 {
	return normalizePhotoDevelopClipboardCurrentV1(readPhotoDevelopClipboardJsonV1(value));
}
