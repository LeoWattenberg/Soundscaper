/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ImageDevelopStateV3 } from '../../common/editor/imaging/image-develop-state-v3.ts';
import { createPhotoDevelopClipboardForProfileV1, normalizePhotoDevelopClipboardForProfileV1,
	readPhotoDevelopClipboardJsonV1 } from './internal/photo-develop-clipboard-kernel-v1.ts';

export interface PhotoDevelopClipboardV3 {
	readonly schemaFamily: 'lightscaper';
	readonly schemaVersion: 3;
	readonly kind: 'photo-develop-clipboard';
	readonly develop: Readonly<ImageDevelopStateV3>;
}

/** Whole external JSON retains repairs but never authenticates mask bodies. */
export function createPhotoDevelopClipboardV3(value: unknown) { return createPhotoDevelopClipboardForProfileV1('current3', value); }
export function normalizePhotoDevelopClipboardV3(value: unknown) { return normalizePhotoDevelopClipboardForProfileV1('current3', value); }
export function serializePhotoDevelopClipboardV3(value: unknown): string { return JSON.stringify(normalizePhotoDevelopClipboardV3(value)); }
export function parsePhotoDevelopClipboardV3(value: string) { return normalizePhotoDevelopClipboardV3(readPhotoDevelopClipboardJsonV1(value)); }
