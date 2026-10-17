/* SPDX-License-Identifier: AGPL-3.0-only */

import { usePhotoDevelopSettingsForProfileV1 } from './use-photo-develop-settings-kernel-v1.ts';
import type { ExecutePhotoDevelopCurrentV1 } from '../../controller/shared/photo-library-develop-workflow-current-v1.ts';
export function usePhotoDevelopSettingsCurrentV1(options: Readonly<{ generation: unknown; execute: ExecutePhotoDevelopCurrentV1 }>) {
	return usePhotoDevelopSettingsForProfileV1('current3', options);
}
