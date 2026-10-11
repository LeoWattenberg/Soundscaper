/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryWorkflowSlotV2 } from './photo-library-workflow-slot-v2.ts';
import type { CreatePhotoLibrarySessionCurrentV1, PhotoLibrarySessionPortCurrentV1 } from '../../photo-library-session-port-current-v1.ts';
import type { CreatePhotoLibraryDevelopProxyRuntimeV3, PhotoLibraryDevelopProxyRuntimeV3 } from '../../photo-library-develop-proxy-port-v3.ts';

import { acquirePhotoLibraryWorkflowSlotForProfileV1, loadPhotoLibraryDevelopProxyForProfileV1, retirePhotoLibraryWorkflowSlotForProfileV1 } from './internal/photo-library-workflow-slot-kernel-v1.ts';

export interface PhotoLibraryWorkflowSlotCurrentV1 extends Omit<PhotoLibraryWorkflowSlotV2, 'factory' | 'proxyFactory' | 'pending' | 'proxyPending'> {
	readonly factory: CreatePhotoLibrarySessionCurrentV1 | undefined;
	readonly proxyFactory: CreatePhotoLibraryDevelopProxyRuntimeV3 | undefined;
	pending: Promise<PhotoLibrarySessionPortCurrentV1> | null;
	proxyPending: Promise<Readonly<PhotoLibraryDevelopProxyRuntimeV3>> | null;
}
export function acquirePhotoLibraryWorkflowSlotCurrentV1(current: PhotoLibraryWorkflowSlotCurrentV1): Promise<PhotoLibrarySessionPortCurrentV1> {
	return acquirePhotoLibraryWorkflowSlotForProfileV1('current3', current);
}
export function loadPhotoLibraryDevelopProxyCurrentV1(current: PhotoLibraryWorkflowSlotCurrentV1): Promise<Readonly<PhotoLibraryDevelopProxyRuntimeV3>> {
	return loadPhotoLibraryDevelopProxyForProfileV1('current3', current);
}
export function retirePhotoLibraryWorkflowSlotCurrentV1(current: PhotoLibraryWorkflowSlotCurrentV1, cancelDestinations: () => Promise<void>): Promise<void> {
	return retirePhotoLibraryWorkflowSlotForProfileV1('current3', current, cancelDestinations);
}
