/* SPDX-License-Identifier: AGPL-3.0-only */

import { usePhotoDevelopForProfileV1 } from './use-photo-develop-kernel-v1.ts';
import type { ExecutePhotoDevelopV2 } from '../../controller/shared/photo-library-develop-workflow-v2.ts';
export function usePhotoDevelopV2(options: Readonly<{ generation: unknown; execute: ExecutePhotoDevelopV2 }>) {
	return usePhotoDevelopForProfileV1('legacy2', options);
}
