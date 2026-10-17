/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ImageDevelopSettingsPacketV1 } from './image-develop-settings-contract-v1.ts';
import type { ImageDevelopSettingsPacketV2 } from './image-develop-settings-contract-v2.ts';
import type { ImageDevelopSettingsPacketV3 } from './image-develop-settings-contract-v3.ts';
import type { ImageDevelopSettingsPacketV4 } from './image-develop-settings-contract-v4.ts';
import { normalizeImageDevelopSettingsPacketCurrentForProfileV1 } from './internal/image-develop-settings-kernel-v1.ts';

export type ImageDevelopSettingsPacketThroughV3 = ImageDevelopSettingsPacketV1 | ImageDevelopSettingsPacketV2 | ImageDevelopSettingsPacketV3;
export type ImageDevelopSettingsPacketCurrentV1 = ImageDevelopSettingsPacketThroughV3 | ImageDevelopSettingsPacketV4;

/** Dispatches unchanged strict legacy packets and explicit Current packets. */
export function normalizeImageDevelopSettingsPacketCurrentV1(value: unknown): ImageDevelopSettingsPacketCurrentV1 {
	return normalizeImageDevelopSettingsPacketCurrentForProfileV1('current4', value);
}
