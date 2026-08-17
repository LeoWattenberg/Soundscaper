/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Shared plumbing for the native helper addon's C-level suites.
 *
 * Two things these suites need that an ordinary in-process test cannot give
 * them. A memory-safety refusal has to be observed from outside the process
 * that would otherwise be corrupted by its absence, so the risky call runs in a
 * child and the assertion is made on what the child reported. And the paths
 * that only exist against a real backend library, or only on a target this host
 * is not, are reached by compiling a stub or a harness from the pinned sources
 * with the host compiler — the same compiler the payload itself is built with,
 * and skipped wherever there is none.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
	nativeHelperAddonTargetForRuntime,
	readNativeHelperAddonSourceManifest,
} from '../../scripts/lib/native-helper-addon-build.mjs';

export const ROOT = resolve(import.meta.dirname, '../..');
export const ADDON_SOURCE_ROOT = join(ROOT, 'native/soundscaper-helper-addon/src');
export const VENDORED_INCLUDES = Object.freeze([
	join(ROOT, 'vendor/pipewire-headers/pipewire-0.3'),
	join(ROOT, 'vendor/pipewire-headers/spa-0.2'),
]);

export const addonManifest = readNativeHelperAddonSourceManifest(ROOT);
export const addonTarget = nativeHelperAddonTargetForRuntime(process.platform, process.arch);
export const addonPath = addonTarget === null
	? null
	: join(ROOT, 'native/soundscaper-helper-addon/prebuilt', addonTarget.id, addonManifest.payloadName);
export const addonIsBuilt = addonTarget !== null
	&& addonManifest.targets[addonTarget.id]?.status === 'built';
export const fixturesAreBuilt = addonIsBuilt
	&& addonManifest.fixturePlugins?.targets?.[addonTarget.id]?.status === 'built';

export function loadAddon() {
	return createRequire(import.meta.url)(addonPath);
}

export const compiler = process.env.CC || 'cc';

export function compilerIsAvailable() {
	const probe = spawnSync(compiler, ['--version'], { encoding: 'utf8' });
	return probe.status === 0;
}

export function temporaryDirectory(label) {
	return mkdtempSync(join(tmpdir(), `soundscaper-${label}-`));
}

/** Compiles one C source into a shared library, throwing the compiler's own diagnostic. */
export function compileSharedLibrary({ source, outputPath, defines = [], includes = [], flags = [] }) {
	const sourcePath = `${outputPath}.c`;
	writeFileSync(sourcePath, source);
	const run = spawnSync(compiler, [
		'-std=c11', '-O1', '-fPIC', '-D_POSIX_C_SOURCE=200809L',
		...defines.map((define) => `-D${define}`),
		...includes.map((directory) => `-I${directory}`),
		...flags,
		'-shared', '-o', outputPath, sourcePath,
	], { encoding: 'utf8' });
	if (run.status !== 0) throw new Error(`The stub build failed:\n${run.stderr || run.stdout}`);
	return outputPath;
}

/** Compiles pinned addon sources plus a harness main into one executable. */
export function compileHarness({ source, outputPath, sources = [], defines = [], includes = [], flags = [] }) {
	const sourcePath = `${outputPath}.c`;
	writeFileSync(sourcePath, source);
	const run = spawnSync(compiler, [
		'-std=c11', '-O1', '-D_POSIX_C_SOURCE=200809L',
		...defines.map((define) => `-D${define}`),
		`-I${ADDON_SOURCE_ROOT}`,
		...includes.map((directory) => `-I${directory}`),
		...flags,
		'-o', outputPath, sourcePath, ...sources.map((name) => join(ADDON_SOURCE_ROOT, name)),
		'-lm', '-ldl',
	], { encoding: 'utf8' });
	if (run.status !== 0) throw new Error(`The harness build failed:\n${run.stderr || run.stdout}`);
	return outputPath;
}

export function runHarness(executablePath, argv = []) {
	const run = spawnSync(executablePath, argv, { encoding: 'utf8', timeout: 60_000 });
	return Object.freeze({
		status: run.status,
		signal: run.signal,
		stdout: run.stdout ?? '',
		stderr: run.stderr ?? '',
	});
}

/**
 * Runs one ES module in a child. A call whose refusal is missing takes the
 * process it runs in with it, so the answer under test is what the child
 * printed and whether it died — never an exception this process caught.
 */
export function runChildModule(source, { env = {}, directory } = {}) {
	const root = directory ?? temporaryDirectory('native-child');
	const modulePath = join(root, 'child.mjs');
	writeFileSync(modulePath, source);
	const run = spawnSync(process.execPath, [modulePath], {
		encoding: 'utf8',
		timeout: 60_000,
		env: { ...process.env, ...env },
	});
	return Object.freeze({
		status: run.status,
		signal: run.signal,
		stdout: run.stdout ?? '',
		stderr: run.stderr ?? '',
	});
}

/** The single line a child prints for its observation, parsed back here. */
export function childObservation(run) {
	const line = run.stdout.split(/\r?\n/u).find((entry) => entry.startsWith('OBSERVED '));
	if (line === undefined) {
		throw new Error(`The child reported nothing (status ${String(run.status)}, signal ${String(run.signal)}):\n${run.stdout}\n${run.stderr}`);
	}
	return JSON.parse(line.slice('OBSERVED '.length));
}
