#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { spawn } from 'node:child_process';
import { access, copyFile, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { packagedExecutableCandidates } from './lib/desktop-smoke.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT_ROOT = resolve(ROOT, 'release/desktop-nightly-products');
const PLATFORM = process.env.SOUNDSCAPER_DESKTOP_TARGET_PLATFORM || platformArgument(process.platform);
const ARCH = process.env.SOUNDSCAPER_DESKTOP_TARGET_ARCH || process.arch;

export async function packageDesktopNightlyTestProducts({
	repositoryRoot = ROOT,
	outputRoot = OUTPUT_ROOT,
	platform = PLATFORM,
	arch = ARCH,
	run = runCommand,
} = {}) {
	if (!['win', 'mac', 'linux'].includes(platform)) throw new TypeError('Nightly product platform is invalid.');
	if (!['x64', 'arm64'].includes(arch)) throw new TypeError('Nightly product architecture is invalid.');
	await rm(outputRoot, { recursive: true, force: true });
	await mkdir(outputRoot, { recursive: true });
	for (const productId of ['soundscaper', 'framescaper']) {
		const productOutput = resolve(outputRoot, productId);
		const environment = {
			...process.env,
			SCAPE_PRODUCT: productId,
			SOUNDSCAPER_DESKTOP_TARGET_PLATFORM: platform,
			SOUNDSCAPER_DESKTOP_TARGET_ARCH: arch,
			CSC_IDENTITY_AUTO_DISCOVERY: 'false',
		};
		await run(process.execPath, [resolve(repositoryRoot, 'scripts/desktop-prepare.mjs')], { cwd: repositoryRoot, environment });
		await run(process.execPath, [
			resolve(repositoryRoot, 'node_modules/electron-builder/out/cli/cli.js'),
			'--config', resolve(repositoryRoot, 'electron-builder.config.cjs'),
			`--${platform}`, `--${arch}`, '--dir', '--publish', 'never',
			`--config.directories.output=${productOutput}`,
		], { cwd: repositoryRoot, environment });
		await copyFile(resolve(repositoryRoot, '.desktop-build/stage-manifest.json'), resolve(productOutput, 'stage-manifest.json'));
		await assertProductExecutable({ productOutput, productId, platform, arch });
	}
	return Object.freeze({ outputRoot, platform, arch });
}

async function assertProductExecutable({ productOutput, productId, platform, arch }) {
	const productName = productId === 'framescaper' ? 'Framescaper' : 'Soundscaper';
	const hostPlatform = Object.freeze({ win: 'win32', mac: 'darwin', linux: 'linux' })[platform];
	const candidates = packagedExecutableCandidates({
		arch,
		outputRoot: productOutput,
		platform: hostPlatform,
		productId,
		productName,
	});
	for (const candidate of candidates) {
		try { await access(candidate); return; } catch { /* Try the next builder convention. */ }
	}
	throw new Error(`Packaged ${productName} executable was not produced for ${platform}/${arch}.`);
}

function runCommand(command, args, { cwd, environment }) {
	return new Promise((resolvePromise, reject) => {
		const child = spawn(command, args, { cwd, env: environment, stdio: 'inherit', windowsHide: true });
		child.once('error', reject);
		child.once('exit', (code, signal) => {
			if (code === 0 && signal === null) resolvePromise();
			else reject(new Error(`Desktop product packaging exited with code ${String(code)} and signal ${String(signal)}.`));
		});
	});
}

function platformArgument(platform) {
	if (platform === 'win32') return 'win';
	if (platform === 'darwin') return 'mac';
	if (platform === 'linux') return 'linux';
	throw new TypeError('Unsupported desktop product host platform.');
}

function isMainModule() {
	return process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
}

if (isMainModule()) {
	packageDesktopNightlyTestProducts().then(({ outputRoot, platform, arch }) => {
		console.log(`Packaged nightly test product runtimes for ${platform}/${arch} in ${outputRoot}`);
	}).catch((error) => {
		console.error(`Desktop nightly product packaging failed: ${error.message}`);
		process.exitCode = 1;
	});
}
