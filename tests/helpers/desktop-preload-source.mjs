/* SPDX-License-Identifier: AGPL-3.0-only */

import { build } from 'esbuild';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

let bundle = null;
const preloadPath = fileURLToPath(new URL('../../desktop/preload.mjs', import.meta.url));

/** Evaluate the same bundled sandbox entry that the packaged desktop executes. */
export async function readDesktopPreloadSource(transformedSource = null) {
	const options = {
		...(typeof transformedSource === 'string'
			? { stdin: { contents: transformedSource, resolveDir: dirname(preloadPath), sourcefile: preloadPath } }
			: { entryPoints: [preloadPath] }),
		bundle: true, write: false, format: 'cjs', platform: 'node', external: ['electron'],
		plugins: [{
			name: 'desktop-preload-runtime-source',
			setup(builder) {
				builder.onResolve({ filter: /\/project-library-runtime\/desktop\/ara-preload\.js$/ }, () => ({
					path: fileURLToPath(new URL('../../desktop/ara-preload.ts', import.meta.url)),
				}));
			},
		}],
	};
	if (typeof transformedSource === 'string') return build(options).then(result => result.outputFiles[0].text);
	bundle ??= build(options).then(result => result.outputFiles[0].text);
	return bundle;
}
