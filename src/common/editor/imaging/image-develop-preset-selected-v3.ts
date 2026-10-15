/* SPDX-License-Identifier: AGPL-3.0-only */

import { createImageDevelopPresetForProfileV1, normalizeImageDevelopPresetForProfileV1,
	normalizeImageDevelopPresetCurrentForProfileV1 } from './internal/image-develop-preset-kernel-v1.ts';

/** Inert values only: retained brush declarations and exact Packet3 hashes
 * authenticate no bytes, install no body, and enroll no settings packet.
 * The actual selected native row owner must separately verify its closure. */
export function createImageDevelopSelectedPresetV3(value: unknown) { return createImageDevelopPresetForProfileV1('current3', value, 'selected'); }
export function normalizeImageDevelopSelectedPresetV3(value: unknown) { return normalizeImageDevelopPresetForProfileV1('current3', value, 'selected'); }
export function normalizeImageDevelopSelectedPresetCurrentV1(value: unknown) { return normalizeImageDevelopPresetCurrentForProfileV1('current4', value, 'selected'); }
