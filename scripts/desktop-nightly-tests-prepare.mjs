#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { generateDesktopIcon } from './desktop-icons.mjs';
import { stageDesktopNightlyTests } from './lib/desktop-nightly-tests-staging.mjs';

const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export async function prepareDesktopNightlyTests({
	repositoryRoot = DEFAULT_ROOT,
	outputRoot,
	browserSourceRoot,
	sourceRevision = null,
	target = {},
} = {}) {
	const root = resolve(repositoryRoot);
	const output = resolve(outputRoot ?? resolve(root, '.desktop-build/nightly-tests'));
	const browsers = resolve(browserSourceRoot ?? resolve(root, 'node_modules/playwright-core/.local-browsers'));
	await generateDesktopIcon({
		sourcePath: resolve(root, 'public/logo/logo-klein-schwarz.svg'),
		outputPath: resolve(root, '.desktop-build/icons/icon.png'),
	});
	return stageDesktopNightlyTests({
		repositoryRoot: root,
		outputRoot: output,
		browserSourceRoot: browsers,
		sourceRevision,
		target,
	});
}

function isMainModule() {
	return process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
}

if (isMainModule()) {
	prepareDesktopNightlyTests({
		browserSourceRoot: process.env.SOUNDSCAPER_NIGHTLY_TESTS_BROWSERS_PATH,
		sourceRevision: process.env.GITHUB_SHA || null,
		target: {
			platform: process.env.SOUNDSCAPER_DESKTOP_TARGET_PLATFORM || null,
			arch: process.env.SOUNDSCAPER_DESKTOP_TARGET_ARCH || null,
		},
	}).then(({ outputRoot, manifest }) => {
		console.log(`Prepared Soundscaper nightly tests ${manifest.applicationVersion} in ${outputRoot}`);
	}).catch((error) => {
		console.error(`Desktop nightly test preparation failed: ${error.message}`);
		process.exitCode = 1;
	});
}
