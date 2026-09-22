/* SPDX-License-Identifier: AGPL-3.0-only */

/** Frozen offline Kokoro G2P closure admission and bounded child-process protocol. */

import {
	spawn,
	type ChildProcessWithoutNullStreams,
	type SpawnOptionsWithStdioTuple,
	type StdioPipe,
} from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { access, lstat, open, readFile, readdir, realpath } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

import { isKokoroVoiceForLanguage } from '../src/common/editor/assistance/kokoro-voices-v1.ts';
import type {
	KokoroPhonemizeRequestV1,
} from './assistance-onnx-kokoro-worker.ts';

type SpawnPort = (
	executable: string,
	args: readonly string[],
	options: SpawnOptionsWithStdioTuple<StdioPipe, StdioPipe, StdioPipe>,
) => ChildProcessWithoutNullStreams;

export interface AssistanceKokoroG2pRuntimeOptionsV1 {
	readonly manifestPath: string;
	readonly runtimeRoot: string;
	readonly platform?: string;
	readonly architecture?: string;
	readonly spawn?: SpawnPort;
	readonly maximumDurationMs?: number;
}

interface PinnedFile {
	readonly path: string;
	readonly byteLength: number;
	readonly sha256: string;
}

interface Manifest {
	readonly targetId: string;
	readonly executable: string;
	readonly files: readonly PinnedFile[];
}

const VERSION = '0.9.4';
const PREFIX = `assistance/kokoro-g2p/${VERSION}`;
const TARGETS = new Set(['mac-arm64', 'linux-x64', 'linux-arm64', 'win-x64', 'win-arm64']);
const MAXIMUM_FILES = 16_384;
const MAXIMUM_CLOSURE_BYTES = 4 * 1024 ** 3;
const MAXIMUM_FILE_BYTES = 2 * 1024 ** 3;
const MAXIMUM_MANIFEST_BYTES = 4 * 1024 ** 2;
const MAXIMUM_INPUT_BYTES = 64 * 1024;
const MAXIMUM_OUTPUT_BYTES = 512 * 1024;
const MAXIMUM_STDERR_BYTES = 8 * 1024;
const MAXIMUM_CHUNKS = 128;
const MAXIMUM_PHONEMES = 510;
const DEFAULT_DURATION_MS = 120_000;
const MAXIMUM_DURATION_MS = 5 * 60_000;
// The owning thread has a 1.5 s cancellation grace before forced termination.
const KILL_GRACE_MS = 500;
const SHA256 = /^[a-f\d]{64}$/u;

export function createAssistanceKokoroOfflinePhonemizerV1(
	options: AssistanceKokoroG2pRuntimeOptionsV1,
): (request: KokoroPhonemizeRequestV1) => Promise<readonly string[]> {
	if (!options || !absolute(options.manifestPath) || !absolute(options.runtimeRoot)
		|| options.spawn !== undefined && typeof options.spawn !== 'function') {
		throw new TypeError('The offline Kokoro G2P runtime paths or process port are invalid.');
	}
	const targetId = targetFor(options.platform ?? process.platform,
		options.architecture ?? process.arch);
	const duration = options.maximumDurationMs ?? DEFAULT_DURATION_MS;
	if (!Number.isSafeInteger(duration) || duration < 1 || duration > MAXIMUM_DURATION_MS) {
		throw new RangeError('The offline Kokoro G2P duration bound is invalid.');
	}
	const start = options.spawn ?? spawn;
	return async (request) => {
		request.signal?.throwIfAborted();
		const input = requestBytes(request);
		const manifest = await loadManifest(options.manifestPath, targetId);
		const directory = resolve(options.runtimeRoot, PREFIX, targetId);
		await authenticateClosure(directory, manifest, request.signal);
		request.signal?.throwIfAborted();
		const executable = resolve(directory, manifest.executable);
		const output = await invoke(start, executable, directory, input, duration, request.signal);
		return reviewResponse(output);
	};
}

function targetFor(platform: string, architecture: string): string {
	const operatingSystem = platform === 'darwin' ? 'mac' : platform === 'win32' ? 'win' : platform;
	const target = `${operatingSystem}-${architecture}`;
	if (!TARGETS.has(target)) throw new TypeError('The offline Kokoro G2P target is unsupported.');
	return target;
}

function requestBytes(request: KokoroPhonemizeRequestV1): Uint8Array {
	if (!request || !isKokoroVoiceForLanguage(request.language, request.voice)
		|| typeof request.text !== 'string' || !request.text.trim()
		|| request.text.includes('\0')) {
		throw new TypeError('The offline Kokoro G2P language, voice, or text is invalid.');
	}
	const bytes = Buffer.from(JSON.stringify({
		language: request.language, voice: request.voice, text: request.text,
	}), 'utf8');
	if (bytes.byteLength > MAXIMUM_INPUT_BYTES) {
		throw new RangeError('The offline Kokoro G2P request exceeds its input bound.');
	}
	return bytes;
}

async function loadManifest(path: string, targetId: string): Promise<Manifest> {
	const stat = await lstat(path);
	if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2
		|| stat.size > MAXIMUM_MANIFEST_BYTES || await realpath(path) !== path) {
		throw new TypeError('The offline Kokoro G2P manifest is not a regular packaged file.');
	}
	const value: unknown = JSON.parse(await readFile(path, 'utf8'));
	const root = record(value, ['schemaVersion', 'runtimeVersion', 'targetId',
		'runtimePrefix', 'executable', 'files'], 'manifest');
	if (root.schemaVersion !== 1 || root.runtimeVersion !== VERSION
		|| root.runtimePrefix !== PREFIX || root.targetId !== targetId) {
		throw new TypeError('The offline Kokoro G2P manifest version or target is invalid.');
	}
	const executable = payloadPath(root.executable);
	if (executable !== (targetId.startsWith('win-') ? 'kokoro-g2p.exe' : 'kokoro-g2p')) {
		throw new TypeError('The offline Kokoro G2P executable name is invalid.');
	}
	if (!Array.isArray(root.files) || root.files.length < 1 || root.files.length > MAXIMUM_FILES) {
		throw new TypeError('The offline Kokoro G2P file closure is invalid.');
	}
	let totalBytes = 0;
	let previous = '';
	const files = root.files.map((entry) => {
		const file = record(entry, ['path', 'byteLength', 'sha256'], 'file pin');
		const path = payloadPath(file.path);
		if (previous !== '' && previous.localeCompare(path, 'en') >= 0
			|| !Number.isSafeInteger(file.byteLength)
			|| Number(file.byteLength) < 0 || Number(file.byteLength) > MAXIMUM_FILE_BYTES
			|| typeof file.sha256 !== 'string' || !SHA256.test(file.sha256)) {
			throw new TypeError('The offline Kokoro G2P file pin is invalid or unsorted.');
		}
		previous = path;
		totalBytes += Number(file.byteLength);
		if (totalBytes > MAXIMUM_CLOSURE_BYTES) {
			throw new RangeError('The offline Kokoro G2P file closure exceeds its byte bound.');
		}
		return Object.freeze({ path, byteLength: Number(file.byteLength), sha256: file.sha256 });
	});
	if (!files.some((file) => file.path === executable)) {
		throw new TypeError('The offline Kokoro G2P executable is absent from its closure.');
	}
	return Object.freeze({ targetId, executable, files: Object.freeze(files) });
}

async function authenticateClosure(
	directory: string,
	manifest: Manifest,
	signal?: AbortSignal,
): Promise<void> {
	signal?.throwIfAborted();
	const root = await realpath(directory);
	if (root !== directory || !(await lstat(directory)).isDirectory()) {
		throw new TypeError('The offline Kokoro G2P closure root is not canonical.');
	}
	const inventory = await listFiles(directory, '', signal);
	if (JSON.stringify(inventory) !== JSON.stringify(manifest.files.map((file) => file.path))) {
		throw new TypeError('The offline Kokoro G2P closure inventory is not exact.');
	}
	for (const file of manifest.files) {
		signal?.throwIfAborted();
		await authenticateFile(resolve(directory, file.path), file);
	}
	if (process.platform !== 'win32') {
		await access(resolve(directory, manifest.executable), constants.X_OK);
	}
	signal?.throwIfAborted();
}

async function listFiles(directory: string, path: string, signal?: AbortSignal): Promise<string[]> {
	signal?.throwIfAborted();
	const entries = await readdir(resolve(directory, path), { withFileTypes: true });
	const files: string[] = [];
	for (const entry of entries) {
		const relativePath = path ? `${path}/${entry.name}` : entry.name;
		if (relativePath.split('/').length > 16 || !entry.isFile() && !entry.isDirectory()) {
			throw new TypeError('The offline Kokoro G2P closure contains a link or irregular entry.');
		}
		if (entry.isDirectory()) {
			const nested = await listFiles(directory, relativePath, signal);
			if (nested.length === 0) {
				throw new TypeError('The offline Kokoro G2P closure contains an empty directory.');
			}
			files.push(...nested);
		}
		else files.push(relativePath);
		if (files.length > MAXIMUM_FILES) {
			throw new RangeError('The offline Kokoro G2P closure inventory exceeds its bound.');
		}
	}
	return files.sort((left, right) => left.localeCompare(right, 'en'));
}

async function authenticateFile(path: string, pin: PinnedFile): Promise<void> {
	if (await realpath(path) !== path) {
		throw new TypeError('The offline Kokoro G2P closure contains a noncanonical path.');
	}
	const before = await lstat(path, { bigint: true });
	if (!before.isFile() || before.isSymbolicLink() || before.size !== BigInt(pin.byteLength)) {
		throw new TypeError('The offline Kokoro G2P closure file length is invalid.');
	}
	const handle = await open(path, constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW));
	try {
		const opened = await handle.stat({ bigint: true });
		if (opened.dev !== before.dev || opened.ino !== before.ino
			|| opened.size !== before.size) {
			throw new Error('The offline Kokoro G2P closure file changed during admission.');
		}
		const hash = createHash('sha256');
		for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk);
		const after = await handle.stat({ bigint: true });
		if (after.size !== before.size || after.mtimeNs !== before.mtimeNs
			|| hash.digest('hex') !== pin.sha256) {
			throw new Error('The offline Kokoro G2P closure file digest changed.');
		}
	} finally { await handle.close(); }
}

async function invoke(
	start: SpawnPort,
	executable: string,
	directory: string,
	input: Uint8Array,
	duration: number,
	signal?: AbortSignal,
): Promise<Uint8Array> {
	signal?.throwIfAborted();
	const environment: NodeJS.ProcessEnv = { ...process.env, HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1',
		PYTHONNOUSERSITE: '1' };
	for (const name of ['PYTHONPATH', 'PYTHONHOME', 'LD_PRELOAD', 'LD_LIBRARY_PATH',
		'LD_LIBRARY_PATH_ORIG', 'DYLD_INSERT_LIBRARIES', 'DYLD_LIBRARY_PATH',
		'DYLD_FALLBACK_LIBRARY_PATH', 'ELECTRON_RUN_AS_NODE']) delete environment[name];
	const child = start(executable, [], { cwd: directory, stdio: ['pipe', 'pipe', 'pipe'],
		windowsHide: true, shell: false, env: environment });
	return await new Promise<Uint8Array>((resolvePromise, rejectPromise) => {
		const stdout: Uint8Array[] = [];
		let stdoutBytes = 0;
		let stderrBytes = 0;
		let terminal: Error | null = null;
		let settled = false;
		let forceTimer: ReturnType<typeof setTimeout> | undefined;
		const finish = (error: Error | null): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			if (forceTimer !== undefined) clearTimeout(forceTimer);
			signal?.removeEventListener('abort', abort);
			if (error) { rejectPromise(error); return; }
			resolvePromise(Buffer.concat(stdout, stdoutBytes));
		};
		const stop = (error: Error): void => {
			if (terminal || settled) return;
			terminal = error;
			try { child.kill('SIGTERM'); } catch { /* Force timer still bounds termination. */ }
			forceTimer = setTimeout(() => {
				try { child.kill('SIGKILL'); }
				catch { finish(terminal); return; }
				forceTimer = setTimeout(() => finish(terminal), KILL_GRACE_MS);
			}, KILL_GRACE_MS);
		};
		const abort = (): void => stop(signal?.reason instanceof Error
			? signal.reason : new DOMException('Offline Kokoro G2P cancelled.', 'AbortError'));
		const timeout = setTimeout(() => stop(new Error('Offline Kokoro G2P timed out.')), duration);
		signal?.addEventListener('abort', abort, { once: true });
		child.stdout.on('data', (value: Uint8Array) => {
			if (terminal || settled) return;
			stdoutBytes += value.byteLength;
			if (stdoutBytes > MAXIMUM_OUTPUT_BYTES) {
				stop(new RangeError('Offline Kokoro G2P stdout exceeds its bound.'));
				return;
			}
			stdout.push(value);
		});
		child.stderr.on('data', (value: Uint8Array) => {
			if (terminal || settled) return;
			stderrBytes += value.byteLength;
			if (stderrBytes > MAXIMUM_STDERR_BYTES) {
				stop(new RangeError('Offline Kokoro G2P stderr exceeds its bound.'));
			}
		});
		child.stdin.once('error', () => stop(new Error('Offline Kokoro G2P rejected its request.')));
		child.once('error', () => stop(new Error('Offline Kokoro G2P could not be started.')));
		child.once('close', (code, processSignal) => {
			if (terminal) { finish(terminal); return; }
			if (code !== 0 || processSignal !== null) {
				finish(new Error('Offline Kokoro G2P did not complete successfully.'));
				return;
			}
			finish(null);
		});
		child.stdin.end(input);
		if (signal?.aborted) abort();
	});
}

function reviewResponse(bytes: Uint8Array): readonly string[] {
	let value: unknown;
	try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown; }
	catch { throw new TypeError('Offline Kokoro G2P returned malformed JSON.'); }
	const root = record(value, ['schemaVersion', 'chunks'], 'response');
	if (root.schemaVersion !== 1 || !Array.isArray(root.chunks)
		|| root.chunks.length < 1 || root.chunks.length > MAXIMUM_CHUNKS
		|| root.chunks.some((chunk) => typeof chunk !== 'string' || !chunk
			|| Array.from(chunk).length > MAXIMUM_PHONEMES)) {
		throw new TypeError('Offline Kokoro G2P returned an invalid protocol response.');
	}
	return Object.freeze([...root.chunks] as string[]);
}

function payloadPath(value: unknown): string {
	if (typeof value !== 'string' || !value || value.includes('\\')
		|| value.includes('\0') || value.startsWith('/')
		|| value.split('/').some((part) => !part || part === '.' || part === '..')
		|| value.length > 512) {
		throw new TypeError('The offline Kokoro G2P payload path is invalid.');
	}
	return value;
}

function record(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| Object.getPrototypeOf(value) !== Object.prototype
		|| JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
		throw new TypeError(`The offline Kokoro G2P ${label} is invalid.`);
	}
	return value as Record<string, unknown>;
}

function absolute(value: unknown): value is string {
	return typeof value === 'string' && isAbsolute(value) && resolve(value) === value
		&& !value.includes('\0');
}
