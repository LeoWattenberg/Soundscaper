/* SPDX-License-Identifier: AGPL-3.0-only */
import type { ImageDevelopSelectionV3 } from './image-develop-settings-contract-v3.ts';
import type { ImageDevelopStateThroughV4 } from './image-develop-state-v4.ts';

export interface ImageDevelopSelectionV4 extends ImageDevelopSelectionV3 {
	/** Replaces the fixed source-processing setting independently of repairs. */
	readonly rawDevelopment: boolean;
}
export interface ImageDevelopSettingsPacketV4 {
	readonly schemaVersion: 4;
	readonly kind: 'photo-develop-settings';
	readonly selection: Readonly<ImageDevelopSelectionV4>;
	readonly develop: Readonly<ImageDevelopStateThroughV4>;
}
