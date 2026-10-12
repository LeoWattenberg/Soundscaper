/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryImageHandoffViewV2 } from '../../common/editor/photo-library-image-handoff-port-v2.ts';
import type { OpenFramescaperBrowserNativeImageV1 } from '../../common/editor/timeline-image-native-decode-v1.ts';
import type { PhotoImageHandoffSourceCurrentV1 } from './photo-image-handoff-source-current-v1.ts';
import { decodePhotoImageHandoffSourceForProfileV1 } from './internal/photo-image-handoff-decode-kernel-v1.ts';
export function decodePhotoImageHandoffSourceCurrentV1(capture: Pick<PhotoLibraryImageHandoffViewV2, 'factsJson' | 'original' | 'originalBlob' | 'signal'>, sourceId: string, dependencies: Readonly<{ openImage?: OpenFramescaperBrowserNativeImageV1 }> = {}): Promise<Readonly<PhotoImageHandoffSourceCurrentV1>> {
	return decodePhotoImageHandoffSourceForProfileV1('current3', capture, sourceId, dependencies);
}
