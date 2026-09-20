/* SPDX-License-Identifier: AGPL-3.0-only */

import { randomUUID } from 'node:crypto';
import { cp, mkdir, rename, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';

export const PACKAGED_COVERAGE_ARTIFACT_PATHS = Object.freeze({
	e2eBuildEvidence: 'coverage/build-evidence',
	packagedCoverageConsoleLog: 'e2e-coverage/packaged-runtime/console.log',
	packagedCoverageHtmlReport: 'e2e-coverage/packaged-runtime/playwright-report/index.html',
	packagedCoverageJsonReport: 'e2e-coverage/packaged-runtime/results.json',
	packagedCoverageJunitReport: 'e2e-coverage/packaged-runtime/junit.xml',
	packagedCoverageRaw: 'coverage/v8-packaged',
	packagedCoverageTestResults: 'e2e-coverage/packaged-runtime/test-results',
});

const PRODUCTS = Object.freeze(['soundscaper', 'framescaper']);

export function createDesktopNightlyTestsPackagedCoveragePlan({
	executablePath,
	payloadRoot,
	runRoot,
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
	if (esbuildBinaryPath !== null) {
		assertAbsolute(esbuildBinaryPath, 'Desktop nightly tests esbuild binary path');
	}
	if (!['linux', 'win32', 'darwin'].includes(platform)) {
		throw new TypeError('Packaged coverage platform is invalid.');
	}
	if (!['x64', 'arm64'].includes(arch)) {
		throw new TypeError('Packaged coverage architecture is invalid.');
	}
	return Object.freeze({
		command: executablePath,
		args: Object.freeze([
			join(payloadRoot, 'node_modules/@playwright/test/cli.js'),
			'test',
			'--config',
			join(payloadRoot, 'playwright.nightly-packaged-coverage.config.mjs'),
		]),
		cwd: payloadRoot,
		env: Object.freeze({
			...environment,
			ELECTRON_RUN_AS_NODE: '1',
			PLAYWRIGHT_BROWSERS_PATH: join(payloadRoot, '.local-browsers'),
			PLAYWRIGHT_HTML_OPEN: 'never',
			SCAPE_BROWSER_COVERAGE: '1',
			...(esbuildBinaryPath === null ? {} : { ESBUILD_BINARY_PATH: esbuildBinaryPath }),
			SOUNDSCAPER_NIGHTLY_TESTS_PAYLOAD_ROOT: payloadRoot,
			SOUNDSCAPER_NIGHTLY_TESTS_RUN_ROOT: runRoot,
			SOUNDSCAPER_PACKAGED_PRODUCT_ROOT: join(payloadRoot, 'products'),
			SOUNDSCAPER_PACKAGED_RUNTIME_METRICS: '1',
			SOUNDSCAPER_PACKAGED_RUNTIME_PLATFORM: platform,
			SOUNDSCAPER_PACKAGED_RUNTIME_ARCH: arch,
			AUDIO_EDITOR_FFMPEG_BROWSER: '1',
			GITHUB_ACTIONS: 'false',
		}),
		logFile: join(runRoot, PACKAGED_COVERAGE_ARTIFACT_PATHS.packagedCoverageConsoleLog),
	});
}

export async function preserveDesktopNightlyTestsCoverageEvidence({ payloadRoot, runRoot }) {
	assertAbsolute(payloadRoot, 'Desktop nightly tests payload root');
	assertAbsolute(runRoot, 'Desktop nightly tests run root');
	const coverageRoot = join(runRoot, 'coverage');
	const destination = join(coverageRoot, 'build-evidence');
	const temporary = join(coverageRoot, `.build-evidence-${randomUUID()}`);
	await mkdir(temporary, { recursive: true });
	try {
		for (const productId of PRODUCTS) {
			await Promise.all([
				copyDirectory(
					join(payloadRoot, 'sites', productId),
					join(temporary, 'browser', productId, 'site'),
				),
				copyDirectory(
					join(payloadRoot, 'sites', `${productId}-source-maps`),
					join(temporary, 'browser', productId, 'source-maps'),
				),
				copyDirectory(
					join(payloadRoot, 'products', productId, 'e2e-coverage'),
					join(temporary, 'electron', productId),
				),
			]);
		}
		await rm(destination, { recursive: true, force: true });
		await rename(temporary, destination);
		return destination;
	} catch (error) {
		await rm(temporary, { recursive: true, force: true });
		throw error;
	}
}

export async function runDesktopNightlyTestsPackagedCoveragePhase(options, dependencies = {}) {
	const artifactRoot = join(options.runRoot, 'e2e-coverage/packaged-runtime');
	await mkdir(artifactRoot, { recursive: true });
	const preserveEvidence = dependencies.preserveEvidence
		?? preserveDesktopNightlyTestsCoverageEvidence;
	await preserveEvidence({ payloadRoot: options.payloadRoot, runRoot: options.runRoot });
	const plan = createDesktopNightlyTestsPackagedCoveragePlan(options);
	const child = await dependencies.runPlaywright(plan);
	return Object.freeze({
		child,
		diagnostics: Object.freeze({ passed: child.code === 0 && child.signal == null }),
	});
}

async function copyDirectory(source, destination) {
	await mkdir(dirname(destination), { recursive: true });
	await cp(source, destination, { recursive: true, force: false, errorOnExist: true });
}

function assertAbsolute(value, label) {
	if (typeof value !== 'string' || !isAbsolute(value)) {
		throw new TypeError(`${label} must be absolute.`);
	}
}
