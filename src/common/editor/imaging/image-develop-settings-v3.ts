/* SPDX-License-Identifier: AGPL-3.0-only */

import { copyImageDevelopSettingsForProfileV1, normalizeImageDevelopSettingsPacketForProfileV1,
	normalizeImageDevelopSelectionForProfileV1, mergeImageDevelopSettingsForProfileV1,
	adjustImageDevelopSettingsForProfileV1 } from './internal/image-develop-settings-kernel-v1.ts';

/** Explicit Current requests; external inputs still require a selected owner. */
export function copyImageDevelopSettingsV3(value: unknown) { return copyImageDevelopSettingsForProfileV1('current3', value); }
export function normalizeImageDevelopSettingsPacketV3(value: unknown) { return normalizeImageDevelopSettingsPacketForProfileV1('current3', value); }
export function normalizeImageDevelopSelectionV3(value: unknown) { return normalizeImageDevelopSelectionForProfileV1('current3', value); }
export function mergeImageDevelopSettingsV3(value: unknown) { return mergeImageDevelopSettingsForProfileV1('current3', value); }
export function adjustImageDevelopSettingsV3(value: unknown) { return adjustImageDevelopSettingsForProfileV1('current3', value); }
