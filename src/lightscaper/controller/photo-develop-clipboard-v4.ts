/* SPDX-License-Identifier: AGPL-3.0-only */
import type { ImageDevelopStateV4 } from '../../common/editor/imaging/image-develop-state-v4.ts';
import { createPhotoDevelopClipboardForProfileV1, normalizePhotoDevelopClipboardForProfileV1,
	readPhotoDevelopClipboardJsonV1 } from './internal/photo-develop-clipboard-kernel-v1.ts';

export interface PhotoDevelopClipboardV4 {
	readonly schemaFamily: 'lightscaper';
	readonly schemaVersion: 4;
	readonly kind: 'photo-develop-clipboard';
	readonly develop: Readonly<ImageDevelopStateV4>;
}
export function createPhotoDevelopClipboardV4(value: unknown) { return createPhotoDevelopClipboardForProfileV1('current4', value); }
export function normalizePhotoDevelopClipboardV4(value: unknown) { return normalizePhotoDevelopClipboardForProfileV1('current4', value); }
export function serializePhotoDevelopClipboardV4(value: unknown): string { return JSON.stringify(normalizePhotoDevelopClipboardV4(value)); }
export function parsePhotoDevelopClipboardV4(value: string) { return normalizePhotoDevelopClipboardV4(readPhotoDevelopClipboardJsonV1(value)); }
