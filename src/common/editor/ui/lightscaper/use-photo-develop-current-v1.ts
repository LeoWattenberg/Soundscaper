/* SPDX-License-Identifier: AGPL-3.0-only */

import { usePhotoDevelopForProfileV1 } from './use-photo-develop-kernel-v1.ts';
import type { ExecutePhotoDevelopCurrentV1 } from '../../controller/shared/photo-library-develop-workflow-current-v1.ts';
export function usePhotoDevelopCurrentV1(options: Readonly<{ generation: unknown; execute: ExecutePhotoDevelopCurrentV1 }>) {
	return usePhotoDevelopForProfileV1('current3', options);
}
