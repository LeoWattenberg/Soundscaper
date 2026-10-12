/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryImageHandoffViewV1 } from '../../common/editor/photo-library-image-handoff-port-v1.ts';
import type { OpenFramescaperBrowserNativeImageV1 } from '../../common/editor/timeline-image-native-decode-v1.ts';
import type { PhotoImageHandoffSourceV1 } from './photo-image-handoff-source-v1.ts';
import { decodePhotoImageHandoffSourceForProfileV1 } from './internal/photo-image-handoff-decode-kernel-v1.ts';
export function decodePhotoImageHandoffSourceV1(capture: Pick<PhotoLibraryImageHandoffViewV1, 'factsJson' | 'original' | 'originalBlob' | 'signal'>, sourceId: string, dependencies: Readonly<{ openImage?: OpenFramescaperBrowserNativeImageV1 }> = {}): Promise<Readonly<PhotoImageHandoffSourceV1>> {
	return decodePhotoImageHandoffSourceForProfileV1('legacy2', capture, sourceId, dependencies) as Promise<Readonly<PhotoImageHandoffSourceV1>>;
}
