/* SPDX-License-Identifier: AGPL-3.0-only */
import { copyImageDevelopSettingsForProfileV1, normalizeImageDevelopSettingsPacketForProfileV1,
	normalizeImageDevelopSelectionForProfileV1, mergeImageDevelopSettingsForProfileV1,
	adjustImageDevelopSettingsForProfileV1 } from './internal/image-develop-settings-kernel-v1.ts';

export function copyImageDevelopSettingsV4(value: unknown) { return copyImageDevelopSettingsForProfileV1('current4', value); }
export function normalizeImageDevelopSettingsPacketV4(value: unknown) { return normalizeImageDevelopSettingsPacketForProfileV1('current4', value); }
export function normalizeImageDevelopSelectionV4(value: unknown) { return normalizeImageDevelopSelectionForProfileV1('current4', value); }
export function mergeImageDevelopSettingsV4(value: unknown) { return mergeImageDevelopSettingsForProfileV1('current4', value); }
export function adjustImageDevelopSettingsV4(value: unknown) { return adjustImageDevelopSettingsForProfileV1('current4', value); }
