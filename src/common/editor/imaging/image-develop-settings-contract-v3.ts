/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ImageDevelopSelectionV1 } from './image-develop-settings-contract-v1.ts';
import type { ImageDevelopStateThroughV3 } from './image-develop-state-through-v3.ts';

export interface ImageDevelopSelectionV3 extends ImageDevelopSelectionV1 {
	/** Replaces the complete ordered repair list; false retains target repairs. */
	readonly repairs: boolean;
}

/** Scalar recipes and references are metadata, never body authentication. */
export interface ImageDevelopSettingsPacketV3 {
	readonly schemaVersion: 3;
	readonly kind: 'photo-develop-settings';
	readonly selection: Readonly<ImageDevelopSelectionV3>;
	readonly develop: Readonly<ImageDevelopStateThroughV3>;
}
