/* SPDX-License-Identifier: AGPL-3.0-only */

import type { HelperExecutableGrant } from './helper-contract.ts';
import type { OfxConsentRecordV1 } from '../src/common/editor/native-ofx-consent.ts';
import type { OfxPluginDescriptorV1 } from '../src/common/editor/native-ofx-descriptor.ts';

export interface RegisteredOpenFxPluginV1 {
	readonly handle: string;
	readonly descriptor: OfxPluginDescriptorV1;
	readonly path: string;
	executable: HelperExecutableGrant;
	consent: OfxConsentRecordV1;
	identityChanged: boolean;
	epoch: number;
	readonly activeExecutions: Set<AbortController>;
}
