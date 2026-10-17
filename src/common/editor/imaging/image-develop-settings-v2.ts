/* SPDX-License-Identifier: AGPL-3.0-only */

import { copyImageDevelopSettingsForProfileV1, normalizeImageDevelopSettingsPacketForProfileV1,
	normalizeImageDevelopSettingsPacketCurrentForProfileV1, normalizeImageDevelopSelectionForProfileV1,
	mergeImageDevelopSettingsForProfileV1, adjustImageDevelopSettingsForProfileV1 } from './internal/image-develop-settings-kernel-v1.ts';

/** Permanent legacy2 policy; no process3 or repair selection is admitted. */
export function copyImageDevelopSettingsV2(value: unknown) { return copyImageDevelopSettingsForProfileV1('legacy2', value); }
export function normalizeImageDevelopSettingsPacketV2(value: unknown) { return normalizeImageDevelopSettingsPacketForProfileV1('legacy2', value); }
export function normalizeImageDevelopSettingsPacketV1OrV2(value: unknown) { return normalizeImageDevelopSettingsPacketCurrentForProfileV1('legacy2', value); }
export function normalizeImageDevelopSelectionV2(value: unknown) { return normalizeImageDevelopSelectionForProfileV1('legacy2', value); }
export function mergeImageDevelopSettingsV2(value: unknown) { return mergeImageDevelopSettingsForProfileV1('legacy2', value); }
export function adjustImageDevelopSettingsV2(value: unknown) { return adjustImageDevelopSettingsForProfileV1('legacy2', value); }
