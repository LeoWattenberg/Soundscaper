/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { build } from 'esbuild';
import {
	desktopProductRuntimeFiles,
	soundscaperAssistanceRegistrationSource,
	soundscaperConstantsSource,
	soundscaperDesktopCodecSource,
	soundscaperDesktopSmokeDeferredModuleSource,
	soundscaperDesktopSmokeSource,
	soundscaperMainSource,
	soundscaperNativeTierSource,
	soundscaperPreloadSource,
	soundscaperProductIsolationModuleSource,
	soundscaperProjectRuntimeSource,
	soundscaperProtocolSource,
} from './desktop-product-package-files.mjs';
import {
	soundscaperHelperContractSource,
	soundscaperHelperDataPlaneTransferSource,
	soundscaperHelperJobGrantSource,
	soundscaperHelperJobSubcontractSource,
	soundscaperHelperOutputGrantSource,
	soundscaperHelperResourcePolicySource,
	soundscaperHelperWireSource,
	soundscaperNativeTierControlsSource,
	soundscaperOwnedAudioCutTransformRegistrySource,
	soundscaperOwnedAudioCutTransformResultsSource,
	soundscaperOwnedAudioCutTransformTypesSource,
	soundscaperProjectCurrentRuntimeSource,
} from './desktop-soundscaper-runtime-transforms.mjs';

export async function collectDesktopProductRuntimeClosure({
	compiledRoot,
	completeFiles,
	rootFiles,
	productId,
}) {
	const complete = new Set(completeFiles);
	const selected = new Set(desktopProductRuntimeFiles(productId, [...new Set(rootFiles)]));
	if ([...selected].some((name) => !complete.has(name))) {
		throw new Error('Desktop product runtime root is absent from the compiled closure.');
	}
	const relativeSpecifier = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)['"](\.[^'"]*)['"]/gu;
	const queue = [...selected];
	for (let index = 0; index < queue.length; index += 1) {
		const name = queue[index];
		if (!/\.[cm]?js$/u.test(name)) continue;
		const compiledSource = await readFile(join(compiledRoot, name), 'utf8');
		const transform = desktopProductRuntimeTransform(productId, name);
		const source = transform ? transform(compiledSource) : compiledSource;
		for (const [, specifier] of source.matchAll(relativeSpecifier)) {
			const path = specifier.replace(/[?#].*$/u, '');
			const target = relative(compiledRoot,
				resolve(compiledRoot, dirname(name), path)).split(sep).join('/');
			if (!complete.has(target) || selected.has(target)) continue;
			if (desktopProductRuntimeFiles(productId, [target]).length === 0) {
				throw new Error('Desktop ' + productId + ' runtime ' + name
					+ ' imports deferred product member ' + target + '.');
			}
			selected.add(target);
			queue.push(target);
		}
	}
	return Object.freeze([...selected].sort());
}

export function desktopProductRuntimeTransform(productId, name) {
	if (productId !== 'soundscaper') return undefined;
	return new Map([
		['desktop/helper-contract.js', soundscaperHelperContractSource],
		['desktop/helper-data-plane-transfer.js', soundscaperHelperDataPlaneTransferSource],
		['desktop/helper-job-grant.js', soundscaperHelperJobGrantSource],
		['desktop/helper-job-subcontract.js', soundscaperHelperJobSubcontractSource],
		['desktop/helper-native-output-grant.js', soundscaperHelperOutputGrantSource],
		['desktop/helper-resource-policy.js', soundscaperHelperResourcePolicySource],
		['desktop/helper-wire-admission.js', soundscaperHelperWireSource],
		['desktop/native-tier-controls.js', soundscaperNativeTierControlsSource],
		['src/common/editor/assistance/owned-audio-cut-transform-registry-v1.js',
			soundscaperOwnedAudioCutTransformRegistrySource],
		['src/common/editor/assistance/owned-audio-cut-transform-results-v1.js',
			soundscaperOwnedAudioCutTransformResultsSource],
		['src/common/editor/assistance/owned-audio-cut-transform-types-v1.js',
			soundscaperOwnedAudioCutTransformTypesSource],
		['src/common/editor/project-current-runtime.js', soundscaperProjectCurrentRuntimeSource],
	]).get(name);
}

export async function collectApplicationDesktopRuntimeReferences({
	applicationRoot,
	applicationFiles,
	completeFiles,
}) {
	const complete = new Set(completeFiles);
	const references = new Set();
	const pattern = /['"](?:\.\/)?project-library-runtime\/([^'"?#]+)['"]/gu;
	for (const name of applicationFiles) {
		if (!/\.[cm]?js$/u.test(name)) continue;
		const source = await readFile(join(applicationRoot, name), 'utf8');
		for (const [, target] of source.matchAll(pattern)) if (complete.has(target)) references.add(target);
	}
	return Object.freeze([...references].sort());
}

export async function stageSoundscaperDesktopEntrySources(sourceRoot, applicationRoot) {
	await writeFile(join(applicationRoot, 'assistance-registration.mjs'),
		soundscaperAssistanceRegistrationSource(await readFile(
			join(sourceRoot, 'assistance-registration.mjs'), 'utf8',
		)));
	await writeFile(join(applicationRoot, 'main.mjs'),
		soundscaperMainSource(await readFile(join(sourceRoot, 'main.mjs'), 'utf8')));
	await writeFile(join(applicationRoot, 'native-tier-registration.mjs'),
		soundscaperNativeTierSource(await readFile(
			join(sourceRoot, 'native-tier-registration.mjs'), 'utf8',
		)));
	await writeFile(join(applicationRoot, 'constants.js'),
		soundscaperConstantsSource(await readFile(join(sourceRoot, 'constants.js'), 'utf8')));
	await writeFile(join(applicationRoot, 'desktop-codec-main-integration.mjs'),
		soundscaperDesktopCodecSource(await readFile(
			join(sourceRoot, 'desktop-codec-main-integration.mjs'), 'utf8',
		)));
	await writeFile(join(applicationRoot, 'project-library-product-runtime.js'),
		soundscaperProjectRuntimeSource(await readFile(
			join(sourceRoot, 'project-library-product-runtime.js'), 'utf8',
		)));
	await writeFile(join(applicationRoot, 'protocol.js'),
		soundscaperProtocolSource(await readFile(join(sourceRoot, 'protocol.js'), 'utf8')));
	await writeFile(join(applicationRoot, 'soundscaper-product-isolation.mjs'),
		soundscaperProductIsolationModuleSource(), { flag: 'wx' });
	await bundleSoundscaperDesktopSmoke(sourceRoot, applicationRoot);
	await bundleSoundscaperPreload(sourceRoot, applicationRoot);
}

async function bundleSoundscaperDesktopSmoke(sourceRoot, applicationRoot) {
	await build({
		stdin: {
			contents: soundscaperDesktopSmokeSource(await readFile(
				join(sourceRoot, 'desktop-smoke.js'), 'utf8',
			)),
			loader: 'js', resolveDir: sourceRoot, sourcefile: 'desktop-smoke.js',
		},
		outfile: join(applicationRoot, 'desktop-smoke.js'),
		bundle: true,
		platform: 'node',
		format: 'esm',
		target: 'node26',
		plugins: [{
			name: 'deferred-product-smoke',
			setup(pluginBuild) {
				pluginBuild.onLoad({ filter: /\.m?js$/ }, async (args) => ({
					contents: (await readFile(args.path, 'utf8'))
						.replaceAll('scope?.framescaperDesktop?.v1?.projectLibrary', 'undefined')
						.replaceAll('globalScope.framescaperDesktop?.v1?.projectLibrary', 'undefined')
						.replaceAll("new Set(['soundscaper', 'framescaper'])", "new Set(['soundscaper'])")
						.replaceAll("['soundscaper', 'framescaper'].includes(plan.productId)",
							"plan.productId === 'soundscaper'"),
					loader: 'js',
				}));
				pluginBuild.onResolve({ filter: /^\.\/project-library-runtime\// }, (args) => ({
					path: args.path, external: true,
				}));
				pluginBuild.onResolve({ filter: /(^|\/)framescaper-/ }, () => ({
					path: 'deferred-product-smoke', namespace: 'deferred-product-smoke',
				}));
				pluginBuild.onLoad({ filter: /.*/, namespace: 'deferred-product-smoke' }, () => ({
					contents: soundscaperDesktopSmokeDeferredModuleSource(), loader: 'js',
				}));
			},
		}],
		minifyIdentifiers: true,
		minifySyntax: true,
		minifyWhitespace: true,
		logLevel: 'silent',
		allowOverwrite: true,
	});
}

async function bundleSoundscaperPreload(sourceRoot, applicationRoot) {
	await build({
		stdin: {
			contents: soundscaperPreloadSource(await readFile(join(sourceRoot, 'preload.mjs'), 'utf8')),
			loader: 'js', resolveDir: sourceRoot, sourcefile: 'preload.mjs',
		},
		outfile: join(applicationRoot, 'preload.mjs'),
		bundle: true,
		platform: 'node',
		format: 'cjs',
		target: 'node26',
		external: ['electron'],
		minifyIdentifiers: true,
		minifySyntax: true,
		minifyWhitespace: true,
		logLevel: 'silent',
		allowOverwrite: true,
	});
}
