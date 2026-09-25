/* SPDX-License-Identifier: AGPL-3.0-only */

import { createDeferredModuleFacade } from '../shared/deferred-module-facade.ts';
import type { NativeProjectServiceRuntime } from '../document/native-project-types.ts';
import type { SesxServiceHelpers } from './internal/sesx/sesx-service.ts';

type SesxModule = typeof import('./internal/sesx/sesx-service.ts');
type SesxService = ReturnType<SesxModule['createSesxService']>;

export type SesxModuleLoader = () => Promise<SesxModule>;

const DEFAULT_LOADER: SesxModuleLoader = () => import('./internal/sesx/sesx-service.ts');
const DEFERRED_SESX_METHOD_NAMES = ['openSesx'] as const satisfies readonly (keyof SesxService)[];

/** Keep the XML reader and audio staging code outside the editor startup graph. */
export function createDeferredSesxService(
	runtime: NativeProjectServiceRuntime,
	helpers: SesxServiceHelpers,
	load: SesxModuleLoader = DEFAULT_LOADER,
) {
	return createDeferredModuleFacade(
		async (): Promise<SesxService> => (await load()).createSesxService(runtime, helpers),
		DEFERRED_SESX_METHOD_NAMES,
	);
}
