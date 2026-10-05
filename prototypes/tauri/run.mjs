#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { spawn } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const COMMANDS = new Set(['build', 'run', 'test', 'smoke']);
const USAGE = 'Usage: node prototypes/tauri/run.mjs build|run|test|smoke [--release]';

/** @param {string[]} args */
export function parsePrototypeArguments(args) {
	const [command, ...flags] = args;
	if (!COMMANDS.has(command) || flags.length > 1 || flags.some((flag) => flag !== '--release')) {
		throw new Error(USAGE);
	}
	return { command, release: flags.includes('--release') };
}

/** @param {{ root: string, command: string, release: boolean, platform: string }} options */
export function createPrototypePlan({ root, command, release, platform }) {
	if (!COMMANDS.has(command)) throw new Error(USAGE);
	const repositoryRoot = resolve(root);
	const outputRoot = resolve(repositoryRoot, '.tauri-prototype');
	return Object.freeze({
		command,
		platform,
		repositoryRoot,
		hostDirectory: resolve(repositoryRoot, 'prototypes/tauri/host'),
		outputRoot,
		rendererDirectory: resolve(outputRoot, 'renderer'),
		bridgeFile: resolve(outputRoot, 'bridge.js'),
		smokeFile: resolve(outputRoot, 'smoke.js'),
		smokeReport: resolve(outputRoot, 'smoke-report.json'),
		executable: resolve(outputRoot, 'target', release ? 'release' : 'debug',
			`soundscaper-tauri-prototype${platform === 'win32' ? '.exe' : ''}`),
		cargoArguments: [
			command === 'test' ? 'test' : 'build', '--locked', '--features', 'custom-protocol',
			'--manifest-path', resolve(repositoryRoot, 'prototypes/tauri/host/Cargo.toml'),
			'--target-dir', resolve(outputRoot, 'target'), ...(release ? ['--release'] : []),
		],
	});
}

/** @param {NodeJS.ProcessEnv} environment @returns {NodeJS.ProcessEnv} */
export function createPrototypeEnvironment(environment) {
	const result = { ...environment, SCAPE_PRODUCT: 'soundscaper' };
	delete result.SCAPE_DESKTOP_CODEC_RUNTIME;
	delete result.SCAPE_BUILD_SOURCE_MAPS;
	return result;
}

/** @typedef {ReturnType<typeof createPrototypePlan>} PrototypePlan */
/** @typedef {{ cwd: string, env: NodeJS.ProcessEnv, timeoutMs?: number }} ExecuteOptions */
/** @typedef {(command: string, args: string[], options: ExecuteOptions) => Promise<void>} Execute */

/**
 * Commands intentionally bypass Electron preparation and AI runtime staging.
 * The generated web assets must exist before Rust embeds its application context.
 * @param {PrototypePlan} plan
 * @param {{ execute?: Execute, buildFrontend?: typeof buildPrototypeFrontend,
 *   runSmoke?: typeof runPrototypeSmoke, environment?: NodeJS.ProcessEnv }} [dependencies]
 */
export async function runPrototypePlan(plan, dependencies = {}) {
	const execute = dependencies.execute ?? executeCommand;
	const environment = createPrototypeEnvironment(dependencies.environment ?? process.env);
	const execution = { cwd: plan.repositoryRoot, env: environment };
	// rustup discovers rust-toolchain.toml from cwd, not --manifest-path.
	const cargoExecution = { ...execution, cwd: plan.hostDirectory };
	try {
		await execute('cargo', ['--version'], cargoExecution);
	} catch (error) {
		if (error?.code === 'ENOENT') {
			throw new Error('Cargo is unavailable. Install the Rust toolchain and add cargo to PATH; see prototypes/tauri/README.md.', { cause: error });
		}
		throw error;
	}
	await (dependencies.buildFrontend ?? buildPrototypeFrontend)(plan, environment);
	await execute('cargo', plan.cargoArguments, cargoExecution);
	if (plan.command === 'run') await execute(plan.executable, [], execution);
	if (plan.command === 'smoke') {
		await (dependencies.runSmoke ?? runPrototypeSmoke)(plan, execute, execution);
	}
}

/** @param {PrototypePlan} plan @param {NodeJS.ProcessEnv} environment */
export async function buildPrototypeFrontend(plan, environment) {
	const previous = new Map(['SCAPE_PRODUCT', 'SCAPE_DESKTOP_CODEC_RUNTIME', 'SCAPE_BUILD_SOURCE_MAPS']
		.map((key) => [key, process.env[key]]));
	for (const key of previous.keys()) {
		if (environment[key] === undefined) delete process.env[key];
		else process.env[key] = environment[key];
	}
	try {
		const [{ build: buildVite }, { build: buildEsbuild }] = await Promise.all([import('vite'), import('esbuild')]);
		await buildVite({
			root: plan.repositoryRoot,
			configFile: resolve(plan.repositoryRoot, 'vite.config.mjs'),
			build: { outDir: plan.rendererDirectory, emptyOutDir: true },
		});
		await mkdir(plan.outputRoot, { recursive: true });
		const { generateDesktopIcon } = await import('../../scripts/desktop-icons.mjs');
		const iconRoot = resolve(plan.outputRoot, 'icons');
		await generateDesktopIcon({
			sourcePath: resolve(plan.repositoryRoot, 'public/logo/soundscaper.svg'),
			outputPath: resolve(iconRoot, 'icon.png'),
		});
		// A PNG-backed 256px ICO supplies the Windows resource compiler as well.
		const png = await readFile(resolve(iconRoot, 'linux/256x256.png'));
		const ico = Buffer.alloc(22 + png.length);
		ico.writeUInt16LE(1, 2);
		ico.writeUInt16LE(1, 4);
		ico.writeUInt16LE(1, 10);
		ico.writeUInt16LE(32, 12);
		ico.writeUInt32LE(png.length, 14);
		ico.writeUInt32LE(22, 18);
		png.copy(ico, 22);
		await writeFile(resolve(iconRoot, 'icon.ico'), ico);
		for (const [entry, output] of [['bridge.mjs', plan.bridgeFile], ['smoke.mjs', plan.smokeFile]]) {
			await buildEsbuild({
				entryPoints: [resolve(plan.repositoryRoot, 'prototypes/tauri', entry)],
				outfile: output,
				bundle: true,
				format: 'iife',
				platform: 'browser',
				target: 'es2022',
				logLevel: 'info',
			});
		}
	} finally {
		for (const [key, value] of previous) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}
}

/** @param {PrototypePlan} plan @param {Execute} execute @param {ExecuteOptions} execution */
export async function runPrototypeSmoke(plan, execute, execution) {
	await rm(plan.smokeReport, { force: true });
	const args = ['--smoke', '--smoke-report', plan.smokeReport];
	const virtualDisplay = plan.platform === 'linux' && !execution.env.DISPLAY;
	try {
		await execute(virtualDisplay ? 'xvfb-run' : plan.executable,
			virtualDisplay ? ['-a', plan.executable, ...args] : args,
			{ ...execution, timeoutMs: 120_000 });
	} catch (error) {
		if (virtualDisplay && error?.code === 'ENOENT') {
			throw new Error('Headless Linux smoke requires xvfb-run on PATH. Install xvfb or run in a graphical session.', { cause: error });
		}
		throw error;
	}
	let report;
	try { report = JSON.parse(await readFile(plan.smokeReport, 'utf8')); }
	catch (error) { throw new Error(`The prototype did not produce a valid smoke report at ${plan.smokeReport}.`, { cause: error }); }
	if (report?.success !== true) throw new Error(`Prototype smoke failed: ${JSON.stringify(report)}`);
	console.log(`Prototype smoke passed: ${plan.smokeReport}`);
}

/** @type {Execute} */
export function executeCommand(command, args, { cwd, env, timeoutMs }) {
	return new Promise((resolveCommand, reject) => {
		const grouped = process.platform !== 'win32' && timeoutMs !== undefined;
		const child = spawn(command, args, { cwd, env, stdio: 'inherit', detached: grouped });
		let deadline;
		let termination;
		let timedOut = false;
		const kill = (signal) => {
			try {
				if (grouped && child.pid) process.kill(-child.pid, signal);
				else child.kill(signal);
			} catch { /* The process may have exited between the deadline and signal. */ }
		};
		child.once('error', (error) => { clearTimeout(deadline); clearTimeout(termination); reject(error); });
		child.once('exit', (code, signal) => {
			clearTimeout(deadline);
			clearTimeout(termination);
			if (timedOut) reject(new Error(`${command} exceeded the ${timeoutMs} ms deadline.`));
			else if (code === 0) resolveCommand();
			else reject(new Error(`${command} exited with ${signal ? `signal ${signal}` : `code ${code}`}.`));
		});
		if (timeoutMs !== undefined) {
			deadline = setTimeout(() => {
				timedOut = true;
				kill('SIGTERM');
				termination = setTimeout(() => kill('SIGKILL'), 1_000);
			}, timeoutMs);
		}
	});
}

async function main() {
	if (process.argv.slice(2).includes('--help')) { console.log(USAGE); return; }
	const options = parsePrototypeArguments(process.argv.slice(2));
	await runPrototypePlan(createPrototypePlan({ ...options, root: ROOT, platform: process.platform }));
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
	void main().catch((error) => { console.error(`Tauri prototype: ${error.message}`); process.exitCode = 1; });
}
