/* SPDX-License-Identifier: AGPL-3.0-only */

import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

import { build } from 'esbuild';

import {
	absoluteSourceMapSources,
	sourceMapDirectoryFor,
} from './build-source-map-relocation.mjs';

export const DESKTOP_RENDERER_SMOKE_BUNDLE = 'desktop-renderer-smoke.js';

/** Build the packaged-only renderer smoke as one inventoried static module. */
export async function buildDesktopRendererSmokeBundle({
	repositoryRoot,
	rendererRoot,
	productId,
	sourceMaps = false,
}) {
	const root = resolve(repositoryRoot);
	const outputRoot = resolve(rendererRoot);
	if (!['soundscaper', 'framescaper'].includes(productId)) {
		throw new TypeError('Desktop renderer smoke bundle product is invalid.');
	}
	const entryPoint = resolve(root, 'desktop', `renderer-smoke-runtime-${productId}.js`);
	const outputPath = resolve(outputRoot, DESKTOP_RENDERER_SMOKE_BUNDLE);
	await build({
		absWorkingDir: root,
		entryPoints: [entryPoint],
		outfile: outputPath,
		bundle: true,
		platform: 'browser',
		format: 'esm',
		target: 'chrome128',
		sourcemap: sourceMaps ? 'external' : false,
		sourcesContent: sourceMaps,
		legalComments: 'inline',
		logLevel: 'silent',
		plugins: productId === 'soundscaper' ? [soundscaperRendererIsolation()] : [],
	});
	let sourceMapPath = null;
	if (sourceMaps) {
		const emittedMap = `${outputPath}.map`;
		const parsed = JSON.parse(await readFile(emittedMap, 'utf8'));
		const normalized = absoluteSourceMapSources(parsed, dirname(emittedMap), root);
		const mapRoot = sourceMapDirectoryFor(outputRoot);
		await mkdir(mapRoot, { recursive: true });
		sourceMapPath = join(mapRoot, basename(emittedMap));
		await writeFile(sourceMapPath, JSON.stringify(normalized));
		await unlink(emittedMap);
	}
	return Object.freeze({ entryPoint, outputPath, sourceMapPath });
}

function soundscaperRendererIsolation() {
	return {
		name: 'soundscaper-renderer-smoke-isolation',
		setup(builder) {
			builder.onLoad({
				filter: /(?:project-library-lease|video-timing-probe)-renderer-smoke\.js$/,
			}, async ({ path }) => ({
				contents: (await readFile(path, 'utf8'))
					.replaceAll('scope?.framescaperDesktop?.v1?.projectLibrary', 'undefined')
					.replaceAll('globalScope.framescaperDesktop?.v1?.projectLibrary', 'undefined'),
				loader: 'js',
			}));
		},
	};
}
