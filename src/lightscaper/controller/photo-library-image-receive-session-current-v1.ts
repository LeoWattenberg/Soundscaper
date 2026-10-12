/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryImageReceivePortV2 } from '../../common/editor/photo-library-image-receive-port-v2.ts';
import type { OpenFramescaperBrowserNativeImageV1 } from '../../common/editor/timeline-image-native-decode-v1.ts';
import type { PhotoLibrarySessionPortsCurrentV1 } from './photo-library-session-ports-current-v1.ts';
import type { PhotoManagedImportPortsCurrentV1 } from '../import/managed-import-ports-current-v1.ts';
import { createPhotoLibraryImageReceiveSessionForProfileV1, type PhotoLibraryImageReceiveHostForProfileV1 } from './internal/photo-library-image-receive-kernel-v1.ts';
export interface PhotoLibraryImageReceiveHostCurrentV1 extends Omit<PhotoLibraryImageReceiveHostForProfileV1, 'ports' | 'managed'> { readonly ports: PhotoLibrarySessionPortsCurrentV1; readonly managed: PhotoManagedImportPortsCurrentV1 }
export function createPhotoLibraryImageReceiveSessionCurrentV1(host: PhotoLibraryImageReceiveHostCurrentV1, dependencies: Readonly<{ openImage?: OpenFramescaperBrowserNativeImageV1 }> = {}): Readonly<PhotoLibraryImageReceivePortV2> {
	return createPhotoLibraryImageReceiveSessionForProfileV1('current3', host, dependencies) as Readonly<PhotoLibraryImageReceivePortV2>;
}
