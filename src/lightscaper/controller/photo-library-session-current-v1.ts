/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibrarySessionPortCurrentV1 } from '../../common/editor/photo-library-session-port-current-v1.ts';
import { PhotoLibrarySessionKernelV2 } from './photo-library-session-kernel-v2.ts';
import type { PhotoLibrarySessionPortsCurrentV1 } from './photo-library-session-ports-current-v1.ts';
import type { PhotoLibraryPreviewReadOptionsCurrentV1 } from '../../common/editor/photo-library-session-port-current-v1.ts';
import type { PhotoLibraryPreviewTierV1 } from '../../common/editor/photo-library-session-port-v1.ts';

/** Named Current admission shares the selected writer, custody and lifetime. */
export class PhotoLibrarySessionCurrentV1 extends PhotoLibrarySessionKernelV2 implements PhotoLibrarySessionPortCurrentV1 {
	declare readonly develop: PhotoLibrarySessionPortCurrentV1['develop'];
	constructor(ports: PhotoLibrarySessionPortsCurrentV1) { super('current3', ports); }
	override readPreview(photoId: string, tier: PhotoLibraryPreviewTierV1, options: Readonly<PhotoLibraryPreviewReadOptionsCurrentV1> = {}) {
		return super.readPreview(photoId, tier, options);
	}
}
