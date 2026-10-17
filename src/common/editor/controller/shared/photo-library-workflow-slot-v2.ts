/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryWorkflowSlotV1 } from './photo-library-workflow-slot.ts';
import type { CreatePhotoLibrarySessionV3, PhotoLibrarySessionPortV2 } from '../../photo-library-session-port-v2.ts';
import type { CreatePhotoLibraryDevelopProxyRuntimeV2, PhotoLibraryDevelopProxyRuntimeV2 } from '../../photo-library-develop-proxy-port-v2.ts';
import { acquirePhotoLibraryWorkflowSlotForProfileV1, loadPhotoLibraryDevelopProxyForProfileV1, retirePhotoLibraryWorkflowSlotForProfileV1 } from './internal/photo-library-workflow-slot-kernel-v1.ts';

export interface PhotoLibraryWorkflowSlotV2 extends Omit<PhotoLibraryWorkflowSlotV1, 'factory' | 'pending'> {
	readonly factory: CreatePhotoLibrarySessionV3 | undefined;
	readonly proxyFactory: CreatePhotoLibraryDevelopProxyRuntimeV2 | undefined;
	pending: Promise<PhotoLibrarySessionPortV2> | null;
	proxyPending: Promise<Readonly<PhotoLibraryDevelopProxyRuntimeV2>> | null;
	closeOwner: (() => Promise<void>) | null;
}

export function acquirePhotoLibraryWorkflowSlotV2(current: PhotoLibraryWorkflowSlotV2): Promise<PhotoLibrarySessionPortV2> {
	return acquirePhotoLibraryWorkflowSlotForProfileV1('legacy2', current);
}
export function loadPhotoLibraryDevelopProxyV2(current: PhotoLibraryWorkflowSlotV2): Promise<Readonly<PhotoLibraryDevelopProxyRuntimeV2>> {
	return loadPhotoLibraryDevelopProxyForProfileV1('legacy2', current);
}
export function retirePhotoLibraryWorkflowSlotV2(current: PhotoLibraryWorkflowSlotV2, cancelDestinations: () => Promise<void>): Promise<void> {
	return retirePhotoLibraryWorkflowSlotForProfileV1('legacy2', current, cancelDestinations);
}
