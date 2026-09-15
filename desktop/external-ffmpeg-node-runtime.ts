/* SPDX-License-Identifier: AGPL-3.0-only */

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, readdir, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createReadStream } from 'node:fs';
import { delimiter, posix, win32 } from 'node:path';

import type {
	ExternalFfmpegCandidateInput,
	ExternalFfmpegCandidateLocator,
	ExternalFfmpegProcessRequest,
	ExternalFfmpegProcessResult,
	ExternalFfmpegProcessRunner,
	ExternalFfmpegProbeResult,
} from './external-ffmpeg-probe.ts';

export type ExternalFfmpegTarget =
	| 'linux-x64'
	| 'linux-arm64'
	| 'mac-arm64'
	| 'win-x64'
	| 'win-arm64';

export interface ExternalFfmpegChildProcess {
	stdout: Readonly<{ on(event: 'data', listener: (chunk: unknown) => void): unknown }>;
	stderr: Readonly<{ on(event: 'data', listener: (chunk: unknown) => void): unknown }>;
	once(event: 'error', listener: (error: NodeJS.ErrnoException) => void): unknown;
	once(event: 'close', listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
	kill(signal: NodeJS.Signals): boolean;
}

export interface ExternalFfmpegLaunchOptions {
	readonly cwd: string;
	readonly env: Readonly<Record<string, string>>;
	readonly shell: false;
	readonly stdio: ['ignore', 'pipe', 'pipe'];
	readonly windowsHide: true;
}

export interface ExternalFfmpegProbeEvidence {
	readonly executablePath: string;
	readonly identity: Readonly<{
		readonly version: string;
		readonly ffmpegSha256: string;
		readonly ffprobePath: string;
		readonly ffprobeSha256: string;
		readonly executablePairClosureSha256: string;
	}>;
	readonly capabilities: Readonly<{
		readonly digest: string;
		readonly probedAtEpochMs: number;
	}>;
}

interface NodeRunnerOptions {
	readonly workingDirectory: string;
	readonly environment?: Readonly<Record<string, string | undefined>>;
	readonly launch?: (
		executablePath: string,
		arguments_: readonly string[],
		options: ExternalFfmpegLaunchOptions,
	) => ExternalFfmpegChildProcess;
	readonly setTimer?: typeof setTimeout;
	readonly clearTimer?: typeof clearTimeout;
}

interface LocatorOptions {
	readonly platform: NodeJS.Platform;
	readonly arch: string;
	readonly selectedPath?: string | null;
	readonly managedPath?: string | null;
	readonly environment?: Readonly<Record<string, string | undefined>>;
	readonly isExecutable?: (path: string) => Promise<boolean>;
	readonly listSubdirectories?: (path: string) => Promise<readonly string[]>;
}

const SHA256 = /^[0-9a-f]{64}$/u;

export function resolveExternalFfmpegTarget(
	platform: NodeJS.Platform,
	arch: string,
): ExternalFfmpegTarget {
	const target = `${platform}-${arch}`;
	if (target === 'linux-x64' || target === 'linux-arm64') return target;
	if (target === 'darwin-arm64') return 'mac-arm64';
	if (target === 'win32-x64') return 'win-x64';
	if (target === 'win32-arm64') return 'win-arm64';
	throw new Error(`External FFmpeg is unsupported on ${target}.`);
}

export function externalFfmpegPairFromSelection(
	selection: string,
	platform: NodeJS.Platform,
): Readonly<{ readonly ffmpegPath: string; readonly ffprobePath: string }> {
	const paths = platform === 'win32' ? win32 : posix;
	if (typeof selection !== 'string' || selection.length > 4_096 || selection.includes('\0')
		|| !paths.isAbsolute(selection)) {
		throw new TypeError('The FFmpeg selection must be an absolute executable path.');
	}
	const expected = platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
	if (paths.basename(selection).toLowerCase() !== expected) {
		throw new TypeError(`The FFmpeg selection must name ${expected}.`);
	}
	const ffmpegPath = paths.normalize(selection);
	const ffprobePath = paths.join(paths.dirname(ffmpegPath), platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
	return Object.freeze({ ffmpegPath, ffprobePath });
}

export function createExternalFfmpegCandidateLocator(
	options: LocatorOptions,
): ExternalFfmpegCandidateLocator {
	resolveExternalFfmpegTarget(options.platform, options.arch);
	const environment = options.environment ?? process.env;
	const executable = options.isExecutable ?? defaultExecutableCheck(options.platform);
	return Object.freeze({
		async discover(): Promise<readonly ExternalFfmpegCandidateInput[]> {
			const pending: Readonly<{
				readonly source: ExternalFfmpegCandidateInput['source'];
				readonly ffmpegPath: string;
			}>[] = [];
			if (options.selectedPath) pending.push({ source: 'user-selected', ffmpegPath: options.selectedPath });
			if (options.managedPath) pending.push({ source: 'managed-package', ffmpegPath: options.managedPath });
			for (const directory of await packageManagerDirectories(
				options.platform, environment, options.listSubdirectories ?? defaultSubdirectories,
			)) pending.push({
				source: 'package-manager', ffmpegPath: executableIn(directory, options.platform, 'ffmpeg'),
			});
			for (const directory of pathDirectories(options.platform, environmentValue(environment, 'PATH', options.platform))) pending.push({
				source: 'system-path', ffmpegPath: executableIn(directory, options.platform, 'ffmpeg'),
			});
			const result: ExternalFfmpegCandidateInput[] = [];
			const seen = new Set<string>();
			const ordinals = new Map<ExternalFfmpegCandidateInput['source'], number>();
			for (const pendingCandidate of pending) {
				let pair;
				try { pair = externalFfmpegPairFromSelection(pendingCandidate.ffmpegPath, options.platform); }
				catch { continue; }
				const key = options.platform === 'win32' ? pair.ffmpegPath.toLowerCase() : pair.ffmpegPath;
				if (seen.has(key) || !await executable(pair.ffmpegPath) || !await executable(pair.ffprobePath)) continue;
				seen.add(key);
				const ordinal = (ordinals.get(pendingCandidate.source) ?? 0) + 1;
				ordinals.set(pendingCandidate.source, ordinal);
				const id = pendingCandidate.source === 'user-selected' || pendingCandidate.source === 'managed-package'
					? pendingCandidate.source
					: `${pendingCandidate.source}-${String(ordinal)}`;
				result.push(Object.freeze({ id, source: pendingCandidate.source, ...pair }));
			}
			return Object.freeze(result);
		},
	});
}

export function createExternalFfmpegNodeRunner(options: NodeRunnerOptions): ExternalFfmpegProcessRunner {
	if (!options || typeof options !== 'object' || !posix.isAbsolute(options.workingDirectory)
		&& !win32.isAbsolute(options.workingDirectory)) {
		throw new TypeError('An absolute external FFmpeg scratch directory is required.');
	}
	const launch = options.launch ?? ((executablePath, arguments_, launchOptions) => (
		spawn(executablePath, [...arguments_], launchOptions) as unknown as ExternalFfmpegChildProcess
	));
	const setTimer = options.setTimer ?? setTimeout;
	const clearTimer = options.clearTimer ?? clearTimeout;
	const environment = childEnvironment(options.environment ?? process.env);
	return Object.freeze({
		run(request: ExternalFfmpegProcessRequest): Promise<ExternalFfmpegProcessResult> {
			validateProcessRequest(request);
			return new Promise((resolve) => {
				let child: ExternalFfmpegChildProcess;
				let settled = false;
				let stdout: Buffer<ArrayBufferLike> = Buffer.alloc(0);
				let stderr: Buffer<ArrayBufferLike> = Buffer.alloc(0);
				let timer: ReturnType<typeof setTimeout> | null = null;
				const finish = (result: ExternalFfmpegProcessResult, terminate = false): void => {
					if (settled) return;
					settled = true;
					if (timer !== null) clearTimer(timer);
					if (terminate) child.kill('SIGKILL');
					resolve(result);
				};
				try {
					const launchOptions: ExternalFfmpegLaunchOptions = Object.freeze({
						cwd: options.workingDirectory, env: environment, shell: false,
						stdio: ['ignore', 'pipe', 'pipe'] as ['ignore', 'pipe', 'pipe'], windowsHide: true,
					});
					child = launch(request.executablePath, request.arguments, launchOptions);
				} catch (error) {
					resolve(processLaunchFailure(error));
					return;
				}
				const append = (current: Buffer, chunk: unknown): Buffer | null => {
					const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
					if (stdout.byteLength + stderr.byteLength + bytes.byteLength > request.maximumOutputBytes) {
						finish({ status: 'unavailable', reason: 'output-limit' }, true);
						return null;
					}
					return Buffer.concat([current, bytes]);
				};
				child.stdout.on('data', (chunk) => { const next = append(stdout, chunk); if (next) stdout = next; });
				child.stderr.on('data', (chunk) => { const next = append(stderr, chunk); if (next) stderr = next; });
				child.once('error', (error) => finish(processLaunchFailure(error)));
				child.once('close', (code) => {
					if (code === null || !Number.isSafeInteger(code) || code < 0) {
						finish({ status: 'unavailable', reason: 'launch-failed' });
						return;
					}
					finish({
						status: 'exited', exitCode: code,
						stdout: stdout.toString('utf8'), stderr: stderr.toString('utf8'),
					});
				});
				timer = setTimer(() => finish({ status: 'unavailable', reason: 'timeout' }, true), request.maximumDurationMs);
				timer.unref?.();
			});
		},
	});
}

export async function createExternalFfmpegProbeEvidence(options: Readonly<{
	readonly probe: Extract<ExternalFfmpegProbeResult, { status: 'available' }>;
	readonly digestFile?: (path: string) => Promise<string>;
	readonly now?: () => number;
}>): Promise<ExternalFfmpegProbeEvidence> {
	if (options.probe?.status !== 'available') throw new TypeError('Available FFmpeg probe evidence is required.');
	const digestFile = options.digestFile ?? sha256File;
	const ffmpegPath = options.probe.candidate.ffmpegPath;
	const ffprobePath = options.probe.candidate.ffprobePath;
	const ffmpegSha256 = validateDigest(await digestFile(ffmpegPath));
	const ffprobeSha256 = validateDigest(await digestFile(ffprobePath));
	const executablePairClosureSha256 = externalFfmpegExecutablePairClosureSha256({
		ffmpegPath, ffmpegSha256, ffprobePath, ffprobeSha256,
	});
	const capabilitiesDigest = sha256(canonicalJson(options.probe.capabilities));
	const probedAtEpochMs = (options.now ?? Date.now)();
	if (!Number.isSafeInteger(probedAtEpochMs) || probedAtEpochMs < 0) {
		throw new RangeError('The FFmpeg probe time is invalid.');
	}
	return Object.freeze({
		executablePath: options.probe.candidate.ffmpegPath,
		identity: Object.freeze({
			version: options.probe.version.normalized,
			ffmpegSha256, ffprobePath, ffprobeSha256, executablePairClosureSha256,
		}),
		capabilities: Object.freeze({ digest: capabilitiesDigest, probedAtEpochMs }),
	});
}

/** Canonical identity of exactly the two released CLI executables; dynamic libraries are outside this scope. */
export function externalFfmpegExecutablePairClosureSha256(value: Readonly<{
	readonly ffmpegPath: string;
	readonly ffmpegSha256: string;
	readonly ffprobePath: string;
	readonly ffprobeSha256: string;
}>): string {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('The external FFmpeg executable-pair identity is invalid.');
	}
	assertExecutablePath(value.ffmpegPath, 'FFmpeg');
	assertExecutablePath(value.ffprobePath, 'FFprobe');
	if (value.ffmpegPath === value.ffprobePath) {
		throw new TypeError('FFmpeg and FFprobe executable-pair paths must differ.');
	}
	const ffmpegSha256 = validateDigest(value.ffmpegSha256);
	const ffprobeSha256 = validateDigest(value.ffprobeSha256);
	return sha256(canonicalJson([
		Object.freeze({ program: 'ffmpeg', path: value.ffmpegPath, sha256: ffmpegSha256 }),
		Object.freeze({ program: 'ffprobe', path: value.ffprobePath, sha256: ffprobeSha256 }),
	]));
}

async function packageManagerDirectories(
	platform: NodeJS.Platform,
	environment: Readonly<Record<string, string | undefined>>,
	list: (path: string) => Promise<readonly string[]>,
): Promise<readonly string[]> {
	const read = async (path: string): Promise<readonly string[]> => {
		try {
			return [...new Set(await list(path))].filter((name) => (
				name.length > 0 && name !== '.' && name !== '..' && !/[\\/\0]/u.test(name)
			)).sort(asciiOrder);
		} catch { return []; }
	};
	const value = (key: string): string | undefined => {
		const path = environmentValue(environment, key, platform);
		const paths = platform === 'win32' ? win32 : posix;
		return path && path.length <= 4_096 && !path.includes('\0') && paths.isAbsolute(path)
			? paths.normalize(path) : undefined;
	};
	if (platform === 'win32') {
		const profile = value('USERPROFILE');
		const local = value('LOCALAPPDATA') ?? (profile
			? win32.join(profile, 'AppData', 'Local') : undefined);
		const roots = [...new Set([
			...(local ? [win32.join(local, 'Microsoft', 'WinGet')] : []),
			win32.join(value('ProgramW6432') ?? value('ProgramFiles') ?? 'C:\\Program Files', 'WinGet'),
			win32.join(value('ProgramFiles(x86)') ?? 'C:\\Program Files (x86)', 'WinGet'),
		])];
		const result = roots.map((root) => win32.join(root, 'Links'));
		const walk = async (path: string, depth: number): Promise<void> => {
			result.push(path, win32.join(path, 'bin'));
			if (depth === 2) return;
			for (const name of await read(path)) {
				if (name.toLowerCase() !== 'bin') await walk(win32.join(path, name), depth + 1);
			}
		};
		for (const root of roots) {
			const packages = win32.join(root, 'Packages');
			for (const name of await read(packages)) {
				if (/(?:^|[._-])ffmpeg(?:[._-]|$)/iu.test(name)) await walk(win32.join(packages, name), 0);
			}
		}
		return Object.freeze(result);
	}
	const prefix = value('HOMEBREW_PREFIX');
	const cellar = value('HOMEBREW_CELLAR');
	const home = value('HOME');
	const prefixes = [...new Set([
		...(prefix ? [prefix] : []),
		...(platform === 'darwin' ? ['/opt/homebrew', '/usr/local'] : [
			'/home/linuxbrew/.linuxbrew', ...(home ? [posix.join(home, '.linuxbrew')] : []),
		]),
	])];
	const result: string[] = [];
	const formula = /^ffmpeg(?:-full|@\d+(?:\.\d+)*)?$/u;
	const scanCellar = async (path: string): Promise<void> => {
		for (const name of (await read(path)).filter((entry) => formula.test(entry))) {
			const rack = posix.join(path, name);
			const versions = [...await read(rack)].sort((left, right) => right.localeCompare(left, 'en', { numeric: true }));
			for (const version of versions) result.push(posix.join(rack, version, 'bin'));
		}
	};
	for (const root of prefixes) {
		result.push(posix.join(root, 'bin'), posix.join(root, 'opt', 'ffmpeg', 'bin'));
		const opt = posix.join(root, 'opt');
		for (const name of (await read(opt)).filter((entry) => entry !== 'ffmpeg' && formula.test(entry))) {
			result.push(posix.join(opt, name, 'bin'));
		}
		await scanCellar(root === prefix && cellar ? cellar : posix.join(root, 'Cellar'));
	}
	if (cellar && !prefix) await scanCellar(cellar);
	return Object.freeze(result);
}

async function defaultSubdirectories(path: string): Promise<readonly string[]> {
	return (await readdir(path, { withFileTypes: true }))
		.filter((entry) => entry.isDirectory() || entry.isSymbolicLink()).map((entry) => entry.name);
}

function environmentValue(
	environment: Readonly<Record<string, string | undefined>>,
	key: string,
	platform: NodeJS.Platform,
): string | undefined {
	if (platform !== 'win32') return environment[key];
	return Object.entries(environment).find(([name]) => name.toLowerCase() === key.toLowerCase())?.[1];
}

function pathDirectories(platform: NodeJS.Platform, value: string | undefined): readonly string[] {
	if (!value) return Object.freeze([]);
	const paths = platform === 'win32' ? win32 : posix;
	const separator = platform === 'win32' ? ';' : delimiter;
	return Object.freeze(value.split(separator).filter((entry) => paths.isAbsolute(entry)));
}

function executableIn(directory: string, platform: NodeJS.Platform, name: string): string {
	return (platform === 'win32' ? win32 : posix).join(directory, platform === 'win32' ? `${name}.exe` : name);
}

function defaultExecutableCheck(platform: NodeJS.Platform): (path: string) => Promise<boolean> {
	return async (path) => {
		try {
			const metadata = await stat(path);
			if (!metadata.isFile()) return false;
			await access(path, platform === 'win32' ? constants.F_OK : constants.X_OK);
			return true;
		} catch { return false; }
	};
}

function childEnvironment(
	value: Readonly<Record<string, string | undefined>>,
): Readonly<Record<string, string>> {
	const result: Record<string, string> = { LANG: 'C', LC_ALL: 'C', AV_LOG_FORCE_NOCOLOR: '1' };
	for (const key of ['HOME', 'PATH', 'SystemRoot', 'TEMP', 'TMP', 'TMPDIR', 'USERPROFILE', 'WINDIR']) {
		const entry = value[key];
		if (typeof entry === 'string' && entry.length <= 32_768 && !entry.includes('\0')) result[key] = entry;
	}
	return Object.freeze(Object.fromEntries(Object.entries(result).sort(([left], [right]) => asciiOrder(left, right))));
}

function validateProcessRequest(request: ExternalFfmpegProcessRequest): void {
	if (!request || typeof request !== 'object' || request.shell !== false || request.standardInput !== 'ignore'
		|| !Array.isArray(request.arguments) || request.arguments.length < 1 || request.arguments.length > 64
		|| typeof request.executablePath !== 'string' || request.executablePath.length > 4_096
		|| request.arguments.some((entry) => typeof entry !== 'string' || entry.length > 1_024 || entry.includes('\0'))
		|| !Number.isSafeInteger(request.maximumDurationMs) || request.maximumDurationMs < 1 || request.maximumDurationMs > 60_000
		|| !Number.isSafeInteger(request.maximumOutputBytes) || request.maximumOutputBytes < 1 || request.maximumOutputBytes > 4 * 1024 * 1024) {
		throw new TypeError('The external FFmpeg process request is invalid.');
	}
}

function processLaunchFailure(error: unknown): ExternalFfmpegProcessResult {
	const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
	if (code === 'ENOENT') return { status: 'unavailable', reason: 'not-found' };
	if (code === 'EACCES' || code === 'EPERM') return { status: 'unavailable', reason: 'not-executable' };
	return { status: 'unavailable', reason: 'launch-failed' };
}

async function sha256File(path: string): Promise<string> {
	const hash = createHash('sha256');
	for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
	return hash.digest('hex');
}

function validateDigest(value: unknown): string {
	if (typeof value !== 'string' || !SHA256.test(value)) throw new TypeError('The external FFmpeg digest is invalid.');
	return value;
}

function assertExecutablePath(value: unknown, label: string): asserts value is string {
	if (typeof value !== 'string' || value.length < 1 || value.length > 4_096
		|| value.includes('\0') || !posix.isAbsolute(value) && !win32.isAbsolute(value)) {
		throw new TypeError(`The external ${label} executable path is invalid.`);
	}
}

function canonicalJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
	if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>)
		.sort(([left], [right]) => asciiOrder(left, right))
		.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(',')}}`;
	return JSON.stringify(value);
}

function sha256(value: string): string {
	return createHash('sha256').update(value).digest('hex');
}

function asciiOrder(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}
