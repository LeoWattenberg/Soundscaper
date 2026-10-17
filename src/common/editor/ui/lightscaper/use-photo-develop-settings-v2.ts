/* SPDX-License-Identifier: AGPL-3.0-only */

import { usePhotoDevelopSettingsForProfileV1 } from './use-photo-develop-settings-kernel-v1.ts';
import type { ExecutePhotoDevelopV2 } from '../../controller/shared/photo-library-develop-workflow-v2.ts';
export function usePhotoDevelopSettingsV2(options: Readonly<{ generation: unknown; execute: ExecutePhotoDevelopV2 }>) {
	return usePhotoDevelopSettingsForProfileV1('legacy2', options);
}
