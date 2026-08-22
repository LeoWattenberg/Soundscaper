/* SPDX-License-Identifier: AGPL-3.0-only */

/** Optional, pathless renderer view of the main-owned OpenFX registry. */

import type {
	FramescaperOpenFxPluginControlRequestV1,
	FramescaperOpenFxPluginProjectionV1,
} from '../native-ofx-service-contract.ts';

export interface FramescaperNativeOpenFxBridge {
	scanOpenFxPlugin?(): Promise<FramescaperOpenFxPluginProjectionV1 | null>;
	listOpenFxPlugins?(): Promise<readonly FramescaperOpenFxPluginProjectionV1[]>;
	controlOpenFxPlugin?(
		request: FramescaperOpenFxPluginControlRequestV1,
	): Promise<FramescaperOpenFxPluginProjectionV1>;
}

export type { FramescaperOpenFxPluginProjectionV1 } from '../native-ofx-service-contract.ts';
