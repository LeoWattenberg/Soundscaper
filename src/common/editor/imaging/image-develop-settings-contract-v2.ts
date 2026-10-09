/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ImageDevelopStateV1 } from './image-develop-contract-v1.ts';
import type { ImageDevelopStateV2 } from './image-develop-state-v2.ts';
import type { ImageDevelopSelectionV1 } from './image-develop-settings-contract-v1.ts';

/** Explicit settings-body successor. References are recipes, not body proofs. */
export interface ImageDevelopSettingsPacketV2 {
	readonly schemaVersion: 2;
	readonly kind: 'photo-develop-settings';
	readonly selection: Readonly<ImageDevelopSelectionV1>;
	readonly develop: Readonly<ImageDevelopStateV1 | ImageDevelopStateV2>;
}
