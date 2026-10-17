/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibrarySessionPortV2 } from '../../common/editor/photo-library-session-port-v2.ts';
import { PhotoLibrarySessionKernelV2 } from './photo-library-session-kernel-v2.ts';
import type { PhotoLibrarySessionPortsV2 } from './photo-library-session-ports-v2.ts';

/** Fixed strict Photo1/2 Session; no read silently promotes a document. */
export class PhotoLibrarySessionV2 extends PhotoLibrarySessionKernelV2 implements PhotoLibrarySessionPortV2 {
	declare readonly develop: PhotoLibrarySessionPortV2['develop'];
	constructor(ports: PhotoLibrarySessionPortsV2) { super('legacy2', ports); }
}
