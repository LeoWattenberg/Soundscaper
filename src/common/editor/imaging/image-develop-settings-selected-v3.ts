/* SPDX-License-Identifier: AGPL-3.0-only */

import { copyImageDevelopSettingsForProfileV1, normalizeImageDevelopSettingsPacketForProfileV1,
	mergeImageDevelopSettingsForProfileV1 } from './internal/image-develop-settings-kernel-v1.ts';

/** These functions retain inert input declarations. They do not authenticate
 * bodies, install resources or admit a packet to a selected Session. The
 * selected owner must prove and enroll the exact value before publication. */
export function copyImageDevelopSelectedSettingsV3(value: unknown) { return copyImageDevelopSettingsForProfileV1('current3', value, 'selected'); }
export function normalizeImageDevelopSelectedSettingsPacketV3(value: unknown) { return normalizeImageDevelopSettingsPacketForProfileV1('current3', value, 'selected'); }
export function mergeImageDevelopSelectedSettingsV3(value: unknown) { return mergeImageDevelopSettingsForProfileV1('current3', value, 'selected'); }
