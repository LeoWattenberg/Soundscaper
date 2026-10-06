/* SPDX-License-Identifier: AGPL-3.0-only */

import { registerHooks } from 'node:module';

/** Resolve fixture module URLs without adding an asynchronous loader hop to every import. */
export function registerMockModuleUrls(urls: Readonly<Record<string, string>>): ReturnType<typeof registerHooks> {
	return registerHooks({
		resolve(specifier, context, nextResolve) {
			if (Object.hasOwn(urls, specifier)) return { url: urls[specifier]!, shortCircuit: true };
			return nextResolve(specifier, context);
		},
	});
}
