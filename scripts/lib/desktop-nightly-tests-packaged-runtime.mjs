/* SPDX-License-Identifier: AGPL-3.0-only */

import { mkdir } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

import { writeDesktopNightlyTestsMetricsEvidence } from './desktop-nightly-tests-metrics.mjs';

const PRODUCTS = Object.freeze({
	soundscaper: Object.freeze({ executable: 'Soundscaper', linuxExecutable: 'soundscaper' }),
	framescaper: Object.freeze({ executable: 'Framescaper', linuxExecutable: 'framescaper' }),
});

export const PACKAGED_RUNTIME_ARTIFACT_PATHS = Object.freeze({
	packagedRuntimeConsoleLog: 'packaged-runtime/console.log',
	packagedRuntimeHtmlReport: 'packaged-runtime/playwright-report/index.html',
	packagedRuntimeJsonReport: 'packaged-runtime/results.json',
	packagedRuntimeJunitReport: 'packaged-runtime/junit.xml',
	packagedRuntimeRaw: 'packaged-runtime/raw.json',
	packagedRuntimeSummary: 'packaged-runtime/summary.json',
	packagedRuntimeTestResults: 'packaged-runtime/test-results',
});

export function packagedRuntimeChromiumArguments(platform) {
	if (!['linux', 'win32', 'darwin'].includes(platform)) throw new TypeError('Packaged runtime platform is invalid.');
	return Object.freeze([
		'--enable-gpu',
		'--enable-webgl',
		'--ignore-gpu-blocklist',
		...(platform === 'linux' ? ['--enable-unsafe-swiftshader'] : []),
	]);
}

export function resolvePackagedProductExecutable({ productRoot, productId, platform, arch }) {
	assertAbsolute(productRoot, 'Packaged product root');
	const product = PRODUCTS[productId];
	if (!product) throw new TypeError('Packaged product ID is invalid.');
	if (!['x64', 'arm64'].includes(arch)) throw new TypeError('Packaged product architecture is invalid.');
	const root = join(productRoot, productId);
	if (platform === 'win32') {
		return join(root, `win${arch === 'x64' ? '' : `-${arch}`}-unpacked`, `${product.executable}.exe`);
	}
	if (platform === 'darwin') {
		return join(root, `mac${arch === 'x64' ? '' : `-${arch}`}`, `${product.executable}.app`, 'Contents', 'MacOS', product.executable);
	}
	if (platform === 'linux') {
		return join(root, `linux${arch === 'x64' ? '' : `-${arch}`}-unpacked`, product.linuxExecutable);
	}
	throw new TypeError('Packaged product platform is invalid.');
}

export function createDesktopNightlyTestsPackagedMetricsPlan({
	executablePath,
	payloadRoot,
	runRoot,
	baseURL,
	esbuildBinaryPath = null,
	platform,
	arch,
	environment = process.env,
}) {
	for (const [value, label] of [
		[executablePath, 'Desktop nightly tests executable path'],
		[payloadRoot, 'Desktop nightly tests payload root'],
		[runRoot, 'Desktop nightly tests run root'],
	]) assertAbsolute(value, label);
	if (esbuildBinaryPath !== null) assertAbsolute(esbuildBinaryPath, 'Desktop nightly tests esbuild binary path');
	assertLoopback(baseURL);
	if (!['linux', 'win32', 'darwin'].includes(platform)) throw new TypeError('Packaged runtime platform is invalid.');
	if (!['x64', 'arm64'].includes(arch)) throw new TypeError('Packaged runtime architecture is invalid.');
	return Object.freeze({
		command: executablePath,
		args: Object.freeze([
			join(payloadRoot, 'node_modules/@playwright/test/cli.js'),
			'test',
			'--config',
			join(payloadRoot, 'playwright.nightly-packaged-metrics.config.mjs'),
		]),
		cwd: payloadRoot,
		env: Object.freeze({
			...environment,
			ELECTRON_RUN_AS_NODE: '1',
			PLAYWRIGHT_BROWSERS_PATH: join(payloadRoot, '.local-browsers'),
			PLAYWRIGHT_HTML_OPEN: 'never',
			...(esbuildBinaryPath === null ? {} : { ESBUILD_BINARY_PATH: esbuildBinaryPath }),
			SOUNDSCAPER_NIGHTLY_TESTS_BASE_URL: baseURL,
			SOUNDSCAPER_NIGHTLY_TESTS_PAYLOAD_ROOT: payloadRoot,
			SOUNDSCAPER_NIGHTLY_TESTS_RUN_ROOT: runRoot,
			SOUNDSCAPER_PACKAGED_PRODUCT_ROOT: join(payloadRoot, 'products'),
			SOUNDSCAPER_PACKAGED_RUNTIME_METRICS: '1',
			SOUNDSCAPER_PACKAGED_RUNTIME_PLATFORM: platform,
			SOUNDSCAPER_PACKAGED_RUNTIME_ARCH: arch,
			AUDIO_EDITOR_FFMPEG_BROWSER: '1',
			GITHUB_ACTIONS: 'false',
			SOUNDSCAPER_M4B2_KEYFRAME_PARITY: '1',
			SOUNDSCAPER_M4_OBSERVED_ENVIRONMENT_ID: `packaged-runtime-${platform}-${arch}`,
			SOUNDSCAPER_M4_PRODUCTION_PARITY: '1',
			SOUNDSCAPER_VIDEO_PREVIEW_BENCHMARK: '1',
		}),
		logFile: join(runRoot, 'packaged-runtime/console.log'),
	});
}

export async function runDesktopNightlyTestsPackagedMetricsPhase(options, dependencies = {}) {
	const artifactRoot = join(options.runRoot, 'packaged-runtime');
	await mkdir(artifactRoot, { recursive: false });
	const plan = createDesktopNightlyTestsPackagedMetricsPlan(options);
	const child = await dependencies.runPlaywright(plan);
	const writeEvidence = dependencies.writeEvidence ?? writeDesktopNightlyTestsMetricsEvidence;
	const evidence = await writeEvidence({
		payloadRoot: options.payloadRoot,
		runRoot: options.runRoot,
		sourceRevision: options.sourceRevision,
		playwrightExit: child,
		consoleLogPath: plan.logFile,
		artifactDirectory: 'packaged-runtime',
		evidenceKind: 'packaged-runtime',
	});
	return Object.freeze({ child, evidence });
}

function assertAbsolute(value, label) {
	if (typeof value !== 'string' || !value || !isAbsolute(value)) throw new TypeError(`${label} must be absolute.`);
}

function assertLoopback(value) {
	let url;
	try { url = new URL(value); } catch { throw new TypeError('Packaged metrics base URL is invalid.'); }
	if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port
		|| url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
		throw new TypeError('Packaged metrics base URL must be an HTTP 127.0.0.1 origin.');
	}
}
