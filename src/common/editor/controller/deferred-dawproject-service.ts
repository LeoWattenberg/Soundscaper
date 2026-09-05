/* SPDX-License-Identifier: AGPL-3.0-only */

import type { DawprojectServiceHelpers } from './dawproject-service.ts';
import { createDeferredModuleFacade } from './deferred-module-facade.ts';
import type { NativeProjectServiceRuntime } from './native-project-types.ts';

type DawprojectModule = typeof import('./dawproject-service.ts');
type DawprojectService = ReturnType<DawprojectModule['createDawprojectService']>;

export type DawprojectModuleLoader = () => Promise<DawprojectModule>;

const DEFAULT_LOADER: DawprojectModuleLoader = () => import('./dawproject-service.ts');

const DEFERRED_DAWPROJECT_METHOD_NAMES = [
	'openDawproject',
	'saveDawproject',
] as const satisfies readonly (keyof DawprojectService)[];

/**
 * The DAWproject open and export actions, loaded when one of them is invoked.
 *
 * The implementation behind them is the whole exchange format: an XML reader
 * and writer, the arrangement and structure mappings, and the ZIP container
 * they travel in. Reached statically that is a quarter of a megabyte of
 * compressed startup cost for a File-menu entry most sessions never use, and it
 * carries `@zip.js/zip.js` into the product-ready graph with it - which is what
 * pushed the Framescaper graph past both its request and its byte budget.
 *
 * The facade stays synchronous so the native project service can compose it at
 * construction, exactly as `deferred-archive-runtime.ts` does for the Audacity
 * and Scape archives beside it.
 */
export function createDeferredDawprojectService(
	runtime: NativeProjectServiceRuntime,
	helpers: DawprojectServiceHelpers,
	load: DawprojectModuleLoader = DEFAULT_LOADER,
) {
	return createDeferredModuleFacade(
		async (): Promise<DawprojectService> => (
			(await load()).createDawprojectService(runtime, helpers)
		),
		DEFERRED_DAWPROJECT_METHOD_NAMES,
	);
}
