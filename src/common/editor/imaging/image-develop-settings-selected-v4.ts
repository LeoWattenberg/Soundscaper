/* SPDX-License-Identifier: AGPL-3.0-only */
import { copyImageDevelopSettingsForProfileV1, normalizeImageDevelopSettingsPacketForProfileV1,
	mergeImageDevelopSettingsForProfileV1 } from './internal/image-develop-settings-kernel-v1.ts';

/** Inert metadata only; a selected owner authenticates the full saved closure. */
export function copyImageDevelopSelectedSettingsV4(value: unknown) { return copyImageDevelopSettingsForProfileV1('current4', value, 'selected'); }
export function normalizeImageDevelopSelectedSettingsPacketV4(value: unknown) { return normalizeImageDevelopSettingsPacketForProfileV1('current4', value, 'selected'); }
export function mergeImageDevelopSelectedSettingsV4(value: unknown) { return mergeImageDevelopSettingsForProfileV1('current4', value, 'selected'); }
