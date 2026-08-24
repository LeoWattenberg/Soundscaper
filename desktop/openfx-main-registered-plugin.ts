/* SPDX-License-Identifier: AGPL-3.0-only */

import type { HelperExecutableGrant } from './helper-contract.ts';
import type { OfxConsentRecordV1 } from '../src/common/editor/native-ofx-consent.ts';
import type { OfxPluginDescriptorV1 } from '../src/common/editor/native-ofx-descriptor.ts';
import type { FramescaperOpenFxPluginSnapshot } from './openfx-plugin-bundle-custody.ts';

export interface RegisteredOpenFxPluginV1 {
	readonly handle: string;
	readonly descriptor: OfxPluginDescriptorV1;
	readonly executable: HelperExecutableGrant;
	readonly custody: FramescaperOpenFxPluginSnapshot;
	consent: OfxConsentRecordV1;
	identityChanged: boolean;
	epoch: number;
	readonly activeExecutions: Set<AbortController>;
}
