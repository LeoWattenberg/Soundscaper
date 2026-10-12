/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryImageReceivePortV1 } from '../../common/editor/photo-library-image-receive-port-v1.ts';
import type { OpenFramescaperBrowserNativeImageV1 } from '../../common/editor/timeline-image-native-decode-v1.ts';
import type { PhotoLibrarySessionPortsV2 } from './photo-library-session-ports-v2.ts';
import type { PhotoManagedImportPortsV2 } from '../import/managed-import-ports-v2.ts';
import { createPhotoLibraryImageReceiveSessionForProfileV1, type PhotoLibraryImageReceiveHostForProfileV1 } from './internal/photo-library-image-receive-kernel-v1.ts';
export interface PhotoLibraryImageReceiveHostV1 extends Omit<PhotoLibraryImageReceiveHostForProfileV1, 'ports' | 'managed'> { readonly ports: PhotoLibrarySessionPortsV2; readonly managed: PhotoManagedImportPortsV2 }
export function createPhotoLibraryImageReceiveSessionV1(host: PhotoLibraryImageReceiveHostV1, dependencies: Readonly<{ openImage?: OpenFramescaperBrowserNativeImageV1 }> = {}): Readonly<PhotoLibraryImageReceivePortV1> {
	return createPhotoLibraryImageReceiveSessionForProfileV1('legacy2', host, dependencies) as Readonly<PhotoLibraryImageReceivePortV1>;
}
