/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ImageDevelopStateV1 } from './image-develop-contract-v1.ts';

export interface ImageDevelopSelectionV1 {
	readonly effectTypes: 'all' | readonly string[];
	readonly geometry: boolean;
	/** Includes mask-bound instances; false selects only global instances. */
	readonly localAdjustments: boolean;
}
/** The existing settings packet is shared without changing its serialized kind or process. */
export interface ImageDevelopSettingsPacketV1 {
	readonly schemaVersion: 1;
	readonly kind: 'photo-develop-settings';
	readonly selection: Readonly<ImageDevelopSelectionV1>;
	readonly develop: Readonly<ImageDevelopStateV1>;
}
