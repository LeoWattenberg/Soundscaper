/* SPDX-License-Identifier: AGPL-3.0-only */

import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { access, lstat, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';

import {
	DESKTOP_SCAPE_OPEN_SMOKE_MODE,
	DESKTOP_SCAPE_OPEN_SMOKE_PREFIX,
	decodeScapeOpenSmokePlan,
	encodeScapeOpenSmokePlan,
	validateScapeOpenSmokePlan,
	validateScapeOpenSmokeResult,
} from '../../desktop/scape-open-smoke.js';
import {
	createAudioClip,
	createAudioSource,
	createAudioTrack,
} from '../../src/common/editor/project-media-factory.ts';
import { createSoundscaperProjectV29, validateSoundscaperProjectV29 } from '../../src/soundscaper/editor-project-v29.ts';
import { createSoundscaperScapeNativeRuntimeV29 } from '../../src/soundscaper/editor-scape-native-v29.ts';
import {
	packagedExecutableCandidates,
	resolveSmokeArchitecture,
} from './desktop-smoke.mjs';

export { DESKTOP_SCAPE_OPEN_SMOKE_MODE, DESKTOP_SCAPE_OPEN_SMOKE_PREFIX };

export const DESKTOP_SCAPE_OPEN_ARCHIVE_MINIMUM_BYTES = 65_557;
export const DESKTOP_SCAPE_OPEN_ARCHIVE_MAXIMUM_BYTES = 96 * 1024;
export const MAX_DESKTOP_SCAPE_OPEN_PLAN_BYTES = 4 * 1024;
const MIB = 1024 * 1024;
const MAXIMUM_CHILD_OUTPUT_BYTES = MIB;
const MAXIMUM_CHILD_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_CHILD_TIMEOUT_MS = 2 * 60 * 1000;
const CHILD_TERMINATION_GRACE_MS = 250;
const CHILD_SETTLEMENT_TIMEOUT_MS = 1_000;
export const DESKTOP_SCAPE_OPEN_FIXTURE = deepFreeze({
	archiveName: 'packaged-current-schema.scape',
	project: {
		id: 'packaged-scape-open-project',
		title: 'Packaged Scape Open',
		revision: 7,
		sourceId: 'packaged-source',
		trackId: 'packaged-track',
		clipId: 'packaged-clip',
		createdAt: '2026-07-31T12:00:00.000Z',
		updatedAt: '2026-07-31T12:00:00.000Z',
	},
	audio: {
		sampleRate: 48_000,
		channelCount: 1,
		frameCount: 16_384,
		chunkFrames: 16_384,
		pcmBytes: 65_536,
		assetBytes: 65_540,
	},
});

export async function createDesktopScapeOpenFixture(profileRoot) {
	const profile = absolutePath(profileRoot, 'fixture profile root');
	const project = createFixtureProject();
	validateSoundscaperProjectV29(project);
	const samples = createFixtureSamples();
	const store = {
		async loadMediaAsset() { return null; },
		readSourceChunks(sourceId) {
			if (sourceId !== DESKTOP_SCAPE_OPEN_FIXTURE.project.sourceId) {
				throw new Error('Packaged Scape-open fixture requested an unknown source');
			}
			return (async function* sourceChunks() {
				yield { channels: [samples] };
			})();
		},
	};
	const exported = await createSoundscaperScapeNativeRuntimeV29().exportScapeProject(project, store);
	if (!(exported.blob instanceof Blob)) {
		throw new Error('Packaged Scape-open fixture export did not produce a Blob');
	}
	const asset = exported.manifest?.assets?.[0];
	if (exported.manifest?.assets?.length !== 1
		|| asset?.sourceId !== DESKTOP_SCAPE_OPEN_FIXTURE.project.sourceId
		|| asset?.kind !== 'audio'
		|| asset?.encoding !== 'audio-f32le-chunks-v1'
		|| asset?.size !== DESKTOP_SCAPE_OPEN_FIXTURE.audio.assetBytes) {
		throw new Error('Packaged Scape-open fixture has unexpected asset geometry');
	}
	const byteLength = exported.blob.size;
	assertArchiveByteLength(byteLength);
	if (exported.byteLength !== byteLength) {
		throw new Error('Packaged Scape-open fixture writer byte count disagrees with its Blob');
	}
	const path = resolve(profile, DESKTOP_SCAPE_OPEN_FIXTURE.archiveName);
	if (dirname(path) !== profile) throw new Error('Packaged Scape-open fixture escaped its profile');
	const bytes = new Uint8Array(await exported.blob.arrayBuffer());
	const sha256 = createHash('sha256').update(bytes).digest('hex');
	await writeFile(path, bytes, { flag: 'wx', mode: 0o600 });
	const written = await stat(path);
	if (!written.isFile() || written.size !== byteLength) {
		throw new Error('Packaged Scape-open fixture did not persist exactly');
	}
	return deepFreeze({
		path,
		byteLength,
		sha256,
		assetBytes: asset.size,
		project: planProjectDescriptor(),
	});
}

export function createDesktopScapeOpenSmokePlan({
	archiveByteLength,
	productId = 'soundscaper',
	token,
} = {}) {
	assertArchiveByteLength(archiveByteLength);
	return deepFreeze(validateScapeOpenSmokePlan({
		schemaVersion: 1,
		mode: DESKTOP_SCAPE_OPEN_SMOKE_MODE,
		productId,
		token,
		archive: {
			name: DESKTOP_SCAPE_OPEN_FIXTURE.archiveName,
			byteLength: archiveByteLength,
		},
		project: planProjectDescriptor(),
	}));
}

export function encodeDesktopScapeOpenSmokePlan(value) {
	const encoded = encodeScapeOpenSmokePlan(validateScapeOpenSmokePlan(value));
	if (Buffer.byteLength(encoded, 'utf8') > MAX_DESKTOP_SCAPE_OPEN_PLAN_BYTES) {
		throw new RangeError('Desktop Scape-open smoke plan exceeds its 4 KiB command-line limit');
	}
	return encoded;
}

export function decodeDesktopScapeOpenSmokePlan(value) {
	if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > MAX_DESKTOP_SCAPE_OPEN_PLAN_BYTES) {
		throw new RangeError('Desktop Scape-open smoke plan exceeds its 4 KiB command-line limit');
	}
	return deepFreeze(decodeScapeOpenSmokePlan(value));
}

export function createDesktopScapeOpenSmokeInvocation({
	arch,
	archiveByteLength,
	outputRoot,
	platform,
	productId = 'soundscaper',
	profileRoot,
	scapePath,
	token,
} = {}) {
	const targetArch = resolveSmokeArchitecture(arch, arch);
	const targetPlatform = validPlatform(platform);
	const output = absolutePath(outputRoot, 'package output root');
	const profile = absolutePath(profileRoot, 'profile root');
	const projectPath = absolutePath(scapePath, 'Scape fixture path');
	const plan = createDesktopScapeOpenSmokePlan({ archiveByteLength, productId, token });
	if (projectPath !== resolve(profile, plan.archive.name) || dirname(projectPath) !== profile) {
		throw new Error('Desktop Scape-open fixture must be the fixed file inside its isolated profile');
	}
	const encodedPlan = encodeDesktopScapeOpenSmokePlan(plan);
	const userDataPath = resolve(profile, 'profile');
	const sharedAppDataPath = resolve(profile, 'application-data');
	const productName = plan.productId === 'framescaper' ? 'Framescaper' : 'Soundscaper';
	return deepFreeze({
		arch: targetArch,
		platform: targetPlatform,
		productId: plan.productId,
		plan,
		encodedPlan,
		scapePath: projectPath,
		userDataPath,
		sharedAppDataPath,
		executableCandidates: packagedExecutableCandidates({
			arch: targetArch,
			outputRoot: output,
			platform: targetPlatform,
			productId: plan.productId,
			productName,
		}),
		appArguments: [
			`--user-data-dir=${userDataPath}`,
			'--soundscaper-smoke',
			`--soundscaper-smoke-mode=${DESKTOP_SCAPE_OPEN_SMOKE_MODE}`,
			`--soundscaper-smoke-plan=${encodedPlan}`,
			`--soundscaper-smoke-app-data=${sharedAppDataPath}`,
			'--lang=en',
			'--mute-audio',
			'--autoplay-policy=no-user-gesture-required',
			projectPath,
		],
	});
}

export function parseDesktopScapeOpenSmokeOutput(output, invocation) {
	if (typeof output !== 'string') throw new TypeError('Packaged Scape-open child output must be text');
	if (Buffer.byteLength(output, 'utf8') > MAXIMUM_CHILD_OUTPUT_BYTES) {
		throw new RangeError('Packaged Scape-open child output exceeds its 1 MiB limit');
	}
	validateInvocation(invocation);
	const marker = `${DESKTOP_SCAPE_OPEN_SMOKE_PREFIX} `;
	const matches = output.split(/\r?\n/u).filter((line) => line.startsWith(marker));
	if (matches.length !== 1) throw new Error('Packaged Scape-open child must emit exactly one smoke result');
	let payload;
	try {
		payload = JSON.parse(matches[0].slice(marker.length));
	} catch (error) {
		throw new TypeError('Packaged Scape-open child emitted invalid result JSON', { cause: error });
	}
	return deepFreeze(validateScapeOpenSmokeResult(payload, invocation.plan));
}

export function formatDesktopScapeOpenSmokeResult(result) {
	const validated = validateScapeOpenSmokeResult(result);
	const line = `${DESKTOP_SCAPE_OPEN_SMOKE_PREFIX} ${JSON.stringify(validated)}`;
	if (Buffer.byteLength(line, 'utf8') > 64 * 1024) {
		throw new RangeError('Desktop Scape-open smoke result exceeds its 64 KiB limit');
	}
	return line;
}

export function runBoundedDesktopScapeOpenChild(command, args, {
	cwd,
	environment,
	maximumOutputBytes = MAXIMUM_CHILD_OUTPUT_BYTES,
	timeoutMs = DEFAULT_CHILD_TIMEOUT_MS,
} = {}) {
	if (typeof command !== 'string' || !command || command.includes('\0')) {
		throw new TypeError('Packaged Scape-open child command is required');
	}
	if (!Array.isArray(args) || args.some((value) => typeof value !== 'string' || value.includes('\0'))) {
		throw new TypeError('Packaged Scape-open child arguments must be strings without NUL bytes');
	}
	const directory = absolutePath(cwd, 'child working directory');
	if (!environment || typeof environment !== 'object' || Array.isArray(environment)) {
		throw new TypeError('Packaged Scape-open child environment is required');
	}
	const outputLimit = integerInRange(maximumOutputBytes, 1, MAXIMUM_CHILD_OUTPUT_BYTES, 'child output limit');
	const timeout = integerInRange(timeoutMs, 1, MAXIMUM_CHILD_TIMEOUT_MS, 'child timeout');
	const childEnvironment = { ...environment };
	delete childEnvironment.ELECTRON_RUN_AS_NODE;
	return new Promise((resolvePromise, reject) => {
		const child = spawn(command, args, {
			cwd: directory,
			detached: process.platform !== 'win32',
			env: childEnvironment,
			stdio: ['ignore', 'pipe', 'pipe'],
			windowsHide: true,
		});
		const stdoutChunks = [];
		const stderrChunks = [];
		let outputBytes = 0;
		let failure = null;
		let settled = false;
		let childClosed = false;
		let forceSent = false;
		let timeoutHandle;
		let forceHandle;
		let settlementHandle;
		const clearTimers = () => {
			clearTimeout(timeoutHandle);
			clearTimeout(forceHandle);
			clearTimeout(settlementHandle);
		};
		const rejectOnce = (error, abandonChild = false) => {
			if (settled) return;
			settled = true;
			clearTimers();
			if (abandonChild) {
				child.stdout.destroy();
				child.stderr.destroy();
				child.unref();
			}
			reject(error);
		};
		const terminate = (error) => {
			if (failure) return;
			failure = error;
			clearTimeout(timeoutHandle);
			if (process.platform === 'win32') {
				terminateWindowsChildTree(child);
			} else {
				signalPosixChildGroup(child, 'SIGTERM');
				forceHandle = setTimeout(() => {
					forceSent = true;
					signalPosixChildGroup(child, 'SIGKILL');
					if (childClosed) rejectOnce(failure);
				}, CHILD_TERMINATION_GRACE_MS);
			}
			settlementHandle = setTimeout(() => {
				if (process.platform === 'win32') terminateWindowsChildTree(child);
				else {
					forceSent = true;
					signalPosixChildGroup(child, 'SIGKILL');
				}
				rejectOnce(failure, true);
			}, CHILD_SETTLEMENT_TIMEOUT_MS);
		};
		const append = (chunks) => (chunk) => {
			if (failure) return;
			const bytes = Buffer.from(chunk);
			outputBytes += bytes.byteLength;
			if (outputBytes > outputLimit) {
				terminate(new RangeError(`Packaged Scape-open child output exceeds ${String(outputLimit)} bytes`));
				return;
			}
			chunks.push(bytes);
		};
		child.stdout.on('data', append(stdoutChunks));
		child.stderr.on('data', append(stderrChunks));
		child.once('error', (error) => {
			if (!failure) rejectOnce(error);
		});
		timeoutHandle = setTimeout(() => {
			terminate(new Error(`Packaged Scape-open child timed out after ${String(timeout)} milliseconds`));
		}, timeout);
		child.once('close', (code, signal) => {
			if (settled) return;
			childClosed = true;
			if (failure && process.platform !== 'win32' && !forceSent) return;
			settled = true;
			clearTimers();
			if (failure) return reject(failure);
			if (signal) return reject(new Error(`Packaged Scape-open child exited with signal ${signal}`));
			resolvePromise(deepFreeze({
				code,
				stdout: Buffer.concat(stdoutChunks).toString('utf8'),
				stderr: Buffer.concat(stderrChunks).toString('utf8'),
			}));
		});
	});
}

export async function runDesktopScapeOpenSmoke({
	repositoryRoot,
	arch = process.env.SOUNDSCAPER_SMOKE_ARCH || process.arch,
	platform = process.platform,
	environment = process.env,
	outputRoot,
	productId = environment.SCAPE_PRODUCT === 'framescaper' ? 'framescaper' : 'soundscaper',
	token = randomBytes(16).toString('hex'),
	createProfile = (prefix) => mkdtemp(prefix),
	createFixture = createDesktopScapeOpenFixture,
	findExecutable = findPackagedExecutable,
	runChild = runBoundedDesktopScapeOpenChild,
	removeProfile = rm,
} = {}) {
	const root = absolutePath(repositoryRoot, 'repository root');
	for (const [candidate, label] of [
		[createProfile, 'profile factory'],
		[createFixture, 'fixture factory'],
		[findExecutable, 'executable finder'],
		[runChild, 'child runner'],
		[removeProfile, 'profile remover'],
	]) {
		if (typeof candidate !== 'function') throw new TypeError(`Desktop Scape-open ${label} must be a function`);
	}
	const packageRoot = outputRoot === undefined ? resolve(root, 'release/desktop') : outputRoot;
	const profileRoot = await createdProfilePath(
		await createProfile(join(tmpdir(), 'scape-open-')),
	);
	let operationError;
	let result;
	try {
		const fixture = await createFixture(profileRoot);
		validateFixture(fixture, profileRoot);
		const invocation = createDesktopScapeOpenSmokeInvocation({
			arch,
			archiveByteLength: fixture.byteLength,
			outputRoot: packageRoot,
			platform,
			productId,
			profileRoot,
			scapePath: fixture.path,
			token,
		});
		const executable = await findExecutable(invocation);
		const useXvfb = platform === 'linux' && environment.SOUNDSCAPER_SMOKE_XVFB === 'true';
		const command = useXvfb ? 'xvfb-run' : executable;
		const args = useXvfb ? ['-a', executable, ...invocation.appArguments] : invocation.appArguments;
		const childEnvironment = { ...environment };
		delete childEnvironment.ELECTRON_RUN_AS_NODE;
		delete childEnvironment.SCAPE_PRODUCT;
		const child = await runChild(command, args, { cwd: root, environment: childEnvironment });
		if (child.code !== 0) {
			throw new Error(`Packaged Scape-open smoke exited with code ${String(child.code)}.\n${childDiagnostics(child)}`);
		}
		result = parseDesktopScapeOpenSmokeOutput(child.stdout, invocation);
		const after = await stat(fixture.path);
		const afterSha256 = createHash('sha256').update(await readFile(fixture.path)).digest('hex');
		if (!after.isFile() || after.size !== fixture.byteLength || afterSha256 !== fixture.sha256) {
			throw new Error('Packaged Scape-open smoke changed its fixture archive');
		}
	} catch (error) {
		operationError = error;
	}
	let cleanupError;
	try {
		await removeProfile(profileRoot, { recursive: true, force: true });
	} catch (error) {
		cleanupError = error;
	}
	if (operationError && cleanupError) {
		throw new AggregateError(
			[operationError, cleanupError],
			'Desktop Scape-open smoke failed and profile cleanup also failed',
			{ cause: operationError },
		);
	}
	if (operationError) throw operationError;
	if (cleanupError) throw cleanupError;
	return result;
}
export async function findPackagedExecutable(invocation) {
	validateInvocation(invocation);
	for (const candidate of invocation.executableCandidates) {
		try {
			await access(candidate);
			return candidate;
		} catch {
			// Try the next electron-builder unpacked-output convention.
		}
	}
	throw new Error(`No packaged ${invocation.productId} executable was found for the Scape-open smoke`);
}

function createFixtureProject() {
	const fixture = DESKTOP_SCAPE_OPEN_FIXTURE;
	const source = createAudioSource({
		id: fixture.project.sourceId,
		storageKey: fixture.project.sourceId,
		name: 'Packaged source.wav',
		mimeType: 'audio/wav',
		frameCount: fixture.audio.frameCount,
		channelCount: fixture.audio.channelCount,
		sampleRate: fixture.audio.sampleRate,
		originalSampleRate: fixture.audio.sampleRate,
		chunkFrames: fixture.audio.chunkFrames,
	});
	const clip = createAudioClip({
		id: fixture.project.clipId,
		sourceId: fixture.project.sourceId,
		title: 'Packaged clip',
		durationFrames: fixture.audio.frameCount,
		sourceDurationFrames: fixture.audio.frameCount,
	});
	const track = createAudioTrack({
		id: fixture.project.trackId,
		name: 'Packaged track',
		clipIds: [fixture.project.clipId],
	}, fixture.audio.sampleRate);
	return createSoundscaperProjectV29({
		id: fixture.project.id,
		title: fixture.project.title,
		revision: fixture.project.revision,
		now: fixture.project.createdAt,
		updatedAt: fixture.project.updatedAt,
		sampleRate: fixture.audio.sampleRate,
		masterChannels: 1,
		sources: [source],
		clips: [clip],
		tracks: [track],
		view: { selectedTrackIds: [fixture.project.trackId] },
	});
}

function createFixtureSamples() {
	const samples = new Float32Array(DESKTOP_SCAPE_OPEN_FIXTURE.audio.frameCount);
	for (let index = 0; index < samples.length; index += 1) {
		samples[index] = ((index % 257) - 128) / 128;
	}
	return samples;
}

function planProjectDescriptor() {
	const project = DESKTOP_SCAPE_OPEN_FIXTURE.project;
	return {
		id: project.id,
		title: project.title,
		revision: project.revision,
		sourceId: project.sourceId,
		trackId: project.trackId,
		clipId: project.clipId,
	};
}

function validateFixture(value, profileRoot) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Desktop Scape-open fixture result must be an object');
	}
	assertArchiveByteLength(value.byteLength);
	if (value.assetBytes !== DESKTOP_SCAPE_OPEN_FIXTURE.audio.assetBytes
		|| !/^[a-f\d]{64}$/u.test(value.sha256)
		|| value.path !== resolve(profileRoot, DESKTOP_SCAPE_OPEN_FIXTURE.archiveName)
		|| JSON.stringify(value.project) !== JSON.stringify(planProjectDescriptor())) {
		throw new Error('Desktop Scape-open fixture result does not match the fixed fixture');
	}
}

function validateInvocation(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Desktop Scape-open invocation must be an object');
	}
	const plan = validateScapeOpenSmokePlan(value.plan);
	const decoded = decodeDesktopScapeOpenSmokePlan(value.encodedPlan);
	if (JSON.stringify(decoded) !== JSON.stringify(plan)) {
		throw new Error('Desktop Scape-open invocation encoded plan does not match');
	}
	if (value.productId !== plan.productId || value.scapePath !== resolve(dirname(value.scapePath), plan.archive.name)) {
		throw new Error('Desktop Scape-open invocation does not match its plan');
	}
}

function assertArchiveByteLength(value) {
	if (!Number.isSafeInteger(value)
		|| value <= DESKTOP_SCAPE_OPEN_ARCHIVE_MINIMUM_BYTES
		|| value > DESKTOP_SCAPE_OPEN_ARCHIVE_MAXIMUM_BYTES) {
		throw new RangeError('Desktop Scape-open archive must be larger than 65,557 bytes and no larger than 96 KiB');
	}
	return value;
}

function absolutePath(value, label) {
	if (typeof value !== 'string' || !value || value.includes('\0')
		|| !isAbsolute(value) || resolve(value) !== value) {
		throw new TypeError(`Desktop Scape-open ${label} must be a normalized absolute path`);
	}
	return value;
}

async function createdProfilePath(value) {
	const path = absolutePath(value, 'created profile root');
	const entry = await lstat(path);
	if (dirname(path) !== resolve(tmpdir()) || !basename(path).startsWith('scape-open-')
		|| !entry.isDirectory() || entry.isSymbolicLink()) {
		throw new TypeError('Desktop Scape-open created profile must be a direct scape-open-* temporary directory');
	}
	return path;
}

function validPlatform(value) {
	if (!['darwin', 'linux', 'win32'].includes(value)) {
		throw new Error(`Unsupported desktop Scape-open platform: ${String(value)}`);
	}
	return value;
}

function integerInRange(value, minimum, maximum, label) {
	if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
		throw new RangeError(`Desktop Scape-open ${label} must be an integer from ${String(minimum)} to ${String(maximum)}`);
	}
	return value;
}

function signalPosixChildGroup(child, signal) {
	if (!Number.isSafeInteger(child.pid) || child.pid < 1) return;
	try {
		process.kill(-child.pid, signal);
	} catch (error) {
		if (error?.code === 'ESRCH') return;
		try {
			child.kill(signal);
		} catch {
			// The independent settlement deadline remains authoritative.
		}
	}
}

function terminateWindowsChildTree(child) {
	if (!Number.isSafeInteger(child.pid) || child.pid < 1) return;
	const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
		stdio: 'ignore',
		windowsHide: true,
	});
	killer.once('error', () => {
		try {
			child.kill('SIGKILL');
		} catch {
			// The independent settlement deadline remains authoritative.
		}
	});
	killer.unref();
}

function childDiagnostics(child) {
	return [child.stdout, child.stderr].filter(Boolean).join('\n');
}

function deepFreeze(value) {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	for (const nested of Object.values(value)) deepFreeze(nested);
	return Object.freeze(value);
}
