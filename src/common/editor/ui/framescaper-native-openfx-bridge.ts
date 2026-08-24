/* SPDX-License-Identifier: AGPL-3.0-only */

/** Optional, pathless renderer view of the main-owned OpenFX registry. */

import type {
	FramescaperOpenFxPluginControlRequestV1,
	FramescaperOpenFxPluginProjectionV1,
} from '../native-ofx-service-contract.ts';
import type {
	FramescaperOpenFxInteractRequestV1,
	FramescaperOpenFxInteractResultV1,
} from '../native-ofx-interact-contract.ts';

export interface FramescaperNativeOpenFxBridge {
	scanOpenFxPlugin?(): Promise<FramescaperOpenFxPluginProjectionV1 | null>;
	listOpenFxPlugins?(): Promise<readonly FramescaperOpenFxPluginProjectionV1[]>;
	controlOpenFxPlugin?(
		request: FramescaperOpenFxPluginControlRequestV1,
	): Promise<FramescaperOpenFxPluginProjectionV1>;
	runOpenFxInteract?(
		request: FramescaperOpenFxInteractRequestV1,
	): Promise<FramescaperOpenFxInteractResultV1>;
	openOpenFxFrameSession?(request: unknown): Promise<Readonly<{
		readonly protocolVersion: 1;
		readonly sessionId: string;
		readonly requestNonce: string;
	}>>;
}

export type { FramescaperOpenFxPluginProjectionV1 } from '../native-ofx-service-contract.ts';
