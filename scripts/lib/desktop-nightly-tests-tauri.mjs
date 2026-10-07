/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runBoundedSmokeChild } from './desktop-smoke-child.mjs';

export const TAURI_ARTIFACT_PATHS = Object.freeze({
	tauriConsoleLog: 'tauri/console.log',
	tauriSmokeReport: 'tauri/smoke-report.json',
	tauriSummary: 'tauri/summary.json',
});
const PLATFORM = Object.freeze({ linux: 'linux', darwin: 'mac', win32: 'win' });
const REPORT_PLATFORM = Object.freeze({ linux: 'linux', darwin: 'macos', win32: 'windows' });
const REPORT_ARCH = Object.freeze({ x64: 'x86_64', arm64: 'aarch64' });

/** Admit the optional source-bound native payload before launching any tests. */
export async function resolveDesktopNightlyTestsTauriPrototype({ payloadRoot, sourceRevision, platform, arch }) {
	assertAbsolute(payloadRoot, 'Tauri payload');
	let manifest;
	try { manifest = JSON.parse(await readFile(join(payloadRoot, 'stage-manifest.json'), 'utf8')); }
	catch (error) { if (error?.code === 'ENOENT') return null; throw error; }
	if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
		throw new Error('Tauri stage manifest must be an object.');
	}
	if (!Object.hasOwn(manifest, 'tauriPrototype')) return null;
	const descriptor = manifest.tauriPrototype;
	if (!closedRecord(descriptor, ['byteLength', 'executable', 'sha256', 'sourceRevision', 'target'])) {
		throw new Error('Tauri prototype descriptor is invalid.');
	}
	if (!/^[a-f\d]{40}$/u.test(descriptor.sourceRevision)
		|| descriptor.sourceRevision !== sourceRevision) throw new Error('Tauri prototype source revision differs.');
	if (!closedRecord(descriptor.target, ['arch', 'platform']) || !PLATFORM[platform]
		|| !REPORT_ARCH[arch] || descriptor.target.platform !== PLATFORM[platform]
		|| descriptor.target.arch !== arch) throw new Error('Tauri prototype target differs.');
	const executable = `tauri-prototype/soundscaper-tauri-prototype${platform === 'win32' ? '.exe' : ''}`;
	if (descriptor.executable !== executable || !Number.isSafeInteger(descriptor.byteLength)
		|| descriptor.byteLength < 1 || descriptor.byteLength > 512 * 1024 * 1024
		|| !/^[a-f\d]{64}$/u.test(descriptor.sha256)) throw new Error('Tauri executable descriptor is invalid.');
	const executablePath = join(payloadRoot, executable);
	const details = await lstat(executablePath).catch((error) => {
		throw new Error('Tauri prototype executable is unavailable.', { cause: error });
	});
	if (!details.isFile() || details.isSymbolicLink() || details.size !== descriptor.byteLength) {
		throw new Error('Tauri prototype executable bytes differ.');
	}
	const hash = createHash('sha256');
	for await (const chunk of createReadStream(executablePath)) hash.update(chunk);
	if (hash.digest('hex') !== descriptor.sha256) throw new Error('Tauri prototype executable digest differs.');
	return Object.freeze({ ...descriptor, target: Object.freeze({ ...descriptor.target }), executablePath });
}

/** Execute the embedded WebView smoke without any build tools on the test host. */
export function createDesktopNightlyTestsTauriPlan({ payloadRoot, runRoot, platform, environment = process.env, tauriPrototype }) {
	assertAbsolute(payloadRoot, 'Tauri payload');
	assertAbsolute(runRoot, 'Tauri run');
	assertAbsolute(tauriPrototype?.executablePath, 'Tauri executable');
	if (!PLATFORM[platform]) throw new Error('Tauri smoke platform is invalid.');
	const env = { ...environment };
	for (const key of ['ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS', 'NODE_V8_COVERAGE',
		'APPIMAGE', 'APPDIR', 'OWD', 'LD_LIBRARY_PATH', 'LD_PRELOAD']) delete env[key];
	const args = ['--smoke', '--smoke-report', join(runRoot, TAURI_ARTIFACT_PATHS.tauriSmokeReport)];
	const headless = platform === 'linux' && !env.DISPLAY?.trim() && !env.WAYLAND_DISPLAY?.trim();
	return Object.freeze({
		command: headless ? 'xvfb-run' : tauriPrototype.executablePath,
		args: Object.freeze(headless ? ['-a', tauriPrototype.executablePath, ...args] : args),
		cwd: payloadRoot, env: Object.freeze(env),
		logFile: join(runRoot, TAURI_ARTIFACT_PATHS.tauriConsoleLog),
	});
}

export async function runDesktopNightlyTestsTauriPhase(options, { runChild = runBoundedSmokeChild, onItems } = {}) {
	const plan = createDesktopNightlyTestsTauriPlan(options);
	const reportPath = join(options.runRoot, TAURI_ARTIFACT_PATHS.tauriSmokeReport);
	const summaryPath = join(options.runRoot, TAURI_ARTIFACT_PATHS.tauriSummary);
	await mkdir(join(options.runRoot, 'tauri'), { recursive: false });
	await rm(reportPath, { force: true });
	const summary = { schemaVersion: 1, host: 'tauri', sourceRevision: options.tauriPrototype.sourceRevision,
		target: options.tauriPrototype.target, status: 'running', child: null, failure: null };
	onItems?.(Object.freeze({ completed: 0, total: 1, label: 'Native editor WAV import and export' }));
	const controller = new AbortController();
	const interrupted = (signal) => () => controller.abort(new Error(`Packaged Tauri smoke child exited with signal ${signal}`));
	const onSIGINT = interrupted('SIGINT'), onSIGTERM = interrupted('SIGTERM');
	process.on('SIGINT', onSIGINT); process.on('SIGTERM', onSIGTERM);
	try {
		const child = await runChild(plan.command, plan.args, {
			cwd: plan.cwd, environment: plan.env, outputLimit: 1024 * 1024,
			timeout: 120_000, label: 'Tauri smoke', errorEvent: 'once', signal: controller.signal,
		});
		controller.signal.throwIfAborted();
		await writeFile(plan.logFile, `${child.stdout}\n${child.stderr}`, { flag: 'wx' });
		const report = await readNativeReport(reportPath, options.platform, options.arch);
		controller.signal.throwIfAborted();
		const passed = child.code === 0 && report.success === true && report.validWave === true
			&& report.nonSilent === true && report.renderer?.success === true
			&& report.renderer.editorReady === true && report.renderer.importedViaMenu === true
			&& report.renderer.exportedViaMenu === true && report.renderer.nodeExposed === false
			&& Array.isArray(report.renderer.errors) && report.renderer.errors.length === 0;
		const exit = Object.freeze({ code: child.code, signal: null });
		Object.assign(summary, { child: exit, status: passed ? 'passed' : 'failed',
			failure: passed ? null : 'Native editor WAV import/export assertions failed.' });
		await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
		onItems?.(Object.freeze({ completed: 1, total: 1, label: passed ? 'Native smoke passed' : 'Native smoke failed' }));
		controller.signal.throwIfAborted();
		return Object.freeze({ child: exit, diagnostics: Object.freeze({ passed }) });
	} catch (error) {
		const failure = error instanceof Error ? error.message : String(error);
		const signal = /^Packaged Tauri smoke child exited with signal (SIGINT|SIGTERM)$/u.exec(failure)?.[1] ?? null;
		const child = Object.freeze({ code: null, signal });
		Object.assign(summary, { child, status: signal ? 'interrupted' : 'error', failure });
		await writeFile(plan.logFile, `${failure}\n`, { flag: 'a' });
		await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
		if (signal) return Object.freeze({ child, diagnostics: Object.freeze({ passed: false }) });
		throw error;
	} finally {
		process.removeListener('SIGINT', onSIGINT); process.removeListener('SIGTERM', onSIGTERM);
	}
}

/** CI exercises the exact prepared payload without launching the Electron suite. */
export async function runDesktopNightlyTestsTauriSmokeCLI(argv, {
	platform = process.platform, arch = process.arch, runPhase = runDesktopNightlyTestsTauriPhase,
} = {}) {
	const args = new Map();
	for (let index = 0; index < argv.length; index += 2) {
		const key = argv[index], value = argv[index + 1];
		if (!['--payload', '--output', '--source-revision', '--arch'].includes(key)
			|| args.has(key) || !value || value.startsWith('--')) throw new Error('Tauri smoke CLI arguments are invalid.');
		args.set(key, value);
	}
	const payloadRoot = args.get('--payload'), runRoot = args.get('--output');
	const sourceRevision = args.get('--source-revision');
	arch = args.get('--arch') ?? arch;
	if (!/^[a-f\d]{40}$/u.test(sourceRevision) || !REPORT_ARCH[arch]) throw new Error('Tauri smoke CLI arguments are invalid.');
	assertAbsolute(runRoot, 'Tauri CLI output');
	const tauriPrototype = await resolveDesktopNightlyTestsTauriPrototype({ payloadRoot, sourceRevision, platform, arch });
	if (!tauriPrototype) throw new Error('Prepared nightly payload does not contain a Tauri prototype.');
	await mkdir(runRoot, { recursive: true });
	const result = await runPhase({ payloadRoot, runRoot, platform, arch, tauriPrototype });
	if (result.child.signal === 'SIGINT') return 130;
	if (result.child.signal === 'SIGTERM') return 143;
	if (result.child.signal || ![0, 1].includes(result.child.code)) return 2;
	return result.child.code === 0 && result.diagnostics.passed ? 0 : 1;
}

async function readNativeReport(path, platform, arch) {
	try {
		const details = await lstat(path);
		if (!details.isFile() || details.isSymbolicLink() || details.size > 128 * 1024) throw new Error('Invalid report file.');
		const report = JSON.parse(await readFile(path, 'utf8'));
		if (report?.host !== 'tauri' || report.platform !== REPORT_PLATFORM[platform]
			|| report.architecture !== REPORT_ARCH[arch] || typeof report.success !== 'boolean') {
			throw new Error('Native report identity differs.');
		}
		return report;
	} catch (error) { throw new Error('Tauri smoke report is unavailable or invalid.', { cause: error }); }
}

function closedRecord(value, keys) {
	return value && typeof value === 'object' && !Array.isArray(value)
		&& Object.keys(value).sort().join('\n') === keys.join('\n');
}

function assertAbsolute(value, label) {
	if (typeof value !== 'string' || !isAbsolute(value)) throw new TypeError(`${label} path must be absolute.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	try { process.exitCode = await runDesktopNightlyTestsTauriSmokeCLI(process.argv.slice(2)); }
	catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 2; }
}
