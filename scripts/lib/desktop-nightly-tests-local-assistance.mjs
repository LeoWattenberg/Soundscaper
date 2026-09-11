/* SPDX-License-Identifier: AGPL-3.0-only */

import { mkdir } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

export const LOCAL_ASSISTANCE_ARTIFACT_PATHS = Object.freeze({
	localAssistanceConsoleLog: 'local-assistance/console.log',
	localAssistanceHtmlReport: 'local-assistance/playwright-report/index.html',
	localAssistanceJsonReport: 'local-assistance/results.json',
	localAssistanceJunitReport: 'local-assistance/junit.xml',
	localAssistanceTestResults: 'local-assistance/test-results',
});

export function createDesktopNightlyTestsLocalAssistancePlan({
	executablePath, payloadRoot, runRoot, platform, arch,
	esbuildBinaryPath = null, environment = process.env,
}) {
	for (const [value, label] of [
		[executablePath, 'Nightly tests executable'], [payloadRoot, 'Nightly tests payload'],
		[runRoot, 'Nightly tests run'],
	]) assertAbsolute(value, label);
	if (!['linux', 'darwin', 'win32'].includes(platform)) throw new TypeError('Local assistance platform is invalid.');
	if (!['x64', 'arm64'].includes(arch)) throw new TypeError('Local assistance architecture is invalid.');
	if (esbuildBinaryPath !== null) assertAbsolute(esbuildBinaryPath, 'Nightly tests esbuild binary');
	const modelCache = environment.SOUNDSCAPER_LOCAL_ASSISTANCE_MODEL_CACHE
		?? join(runRoot, 'local-assistance/models');
	assertAbsolute(modelCache, 'Local assistance model cache');
	return Object.freeze({
		command: executablePath,
		args: Object.freeze([
			join(payloadRoot, 'node_modules/@playwright/test/cli.js'), 'test', '--config',
			join(payloadRoot, 'playwright.nightly-local-assistance.config.mjs'),
		]),
		cwd: payloadRoot,
		env: Object.freeze({
			...environment,
			ELECTRON_RUN_AS_NODE: '1', PLAYWRIGHT_HTML_OPEN: 'never',
			...(esbuildBinaryPath === null ? {} : { ESBUILD_BINARY_PATH: esbuildBinaryPath }),
			SOUNDSCAPER_NIGHTLY_TESTS_PAYLOAD_ROOT: payloadRoot,
			SOUNDSCAPER_NIGHTLY_TESTS_EXECUTABLE: executablePath,
			SOUNDSCAPER_NIGHTLY_TESTS_RUN_ROOT: runRoot,
			SOUNDSCAPER_PACKAGED_PRODUCT_ROOT: join(payloadRoot, 'products'),
			SOUNDSCAPER_PACKAGED_RUNTIME_PLATFORM: platform,
			SOUNDSCAPER_PACKAGED_RUNTIME_ARCH: arch,
			SOUNDSCAPER_LOCAL_ASSISTANCE_REAL_MODELS: '1',
			SOUNDSCAPER_LOCAL_ASSISTANCE_MODEL_CACHE: modelCache,
		}),
		logFile: join(runRoot, LOCAL_ASSISTANCE_ARTIFACT_PATHS.localAssistanceConsoleLog),
	});
}

export async function runDesktopNightlyTestsLocalAssistancePhase(options, { runPlaywright }) {
	const plan = createDesktopNightlyTestsLocalAssistancePlan(options);
	await mkdir(join(options.runRoot, 'local-assistance'), { recursive: false });
	const child = await runPlaywright(plan);
	return Object.freeze({ child, diagnostics: Object.freeze({ passed: child.code === 0 && !child.signal }) });
}

function assertAbsolute(value, label) {
	if (typeof value !== 'string' || !isAbsolute(value)) throw new TypeError(`${label} path must be absolute.`);
}
