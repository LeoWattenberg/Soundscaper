/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	DawprojectOpenResult,
	DawprojectServiceHelpers,
	SaveDawprojectOptions,
} from './dawproject-service.ts';
import type {
	NativeProjectFile,
	NativeProjectServiceRuntime,
	NativeSavedFile,
} from './native-project-types.ts';

type DawprojectModule = typeof import('./dawproject-service.ts');

export type DawprojectModuleLoader = () => Promise<DawprojectModule>;

const DEFAULT_LOADER: DawprojectModuleLoader = () => import('./dawproject-service.ts');

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
	let pending: Promise<ReturnType<DawprojectModule['createDawprojectService']>> | null = null;
	const service = (): Promise<ReturnType<DawprojectModule['createDawprojectService']>> => {
		pending ??= Promise.resolve()
			.then(load)
			.then((module) => module.createDawprojectService(runtime, helpers));
		return pending;
	};

	return Object.freeze({
		openDawproject: async (file: NativeProjectFile): Promise<DawprojectOpenResult | undefined> => (
			(await service()).openDawproject(file)
		),
		saveDawproject: async (options: SaveDawprojectOptions = {}): Promise<NativeSavedFile & Readonly<{
			fileName: string;
			report: unknown;
		}>> => (
			(await service()).saveDawproject(options)
		),
	});
}
