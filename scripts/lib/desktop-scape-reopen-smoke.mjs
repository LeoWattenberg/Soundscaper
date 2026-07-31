/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash, randomBytes } from 'node:crypto';
import { lstat, mkdtemp, readFile, rm, stat, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';

import {
	DESKTOP_SCAPE_REOPEN_SMOKE_MODE,
	DESKTOP_SCAPE_REOPEN_SMOKE_PREFIX,
	decodeScapeReopenSmokePlan,
	encodeScapeReopenSmokePlan,
	validateScapeReopenSmokePlan,
	validateScapeReopenSmokeResult,
} from '../../desktop/scape-reopen-smoke.js';
import { validateScapeOpenSmokeResult } from '../../desktop/scape-open-smoke.js';
import {
	DESKTOP_SCAPE_OPEN_FIXTURE,
	createDesktopScapeOpenFixture,
	createDesktopScapeOpenSmokeInvocation,
	findPackagedExecutable,
	formatDesktopScapeOpenSmokeResult,
	parseDesktopScapeOpenSmokeOutput,
	runBoundedDesktopScapeOpenChild,
} from './desktop-scape-open-smoke.mjs';
import {
	packagedExecutableCandidates,
	resolveSmokeArchitecture,
} from './desktop-smoke.mjs';

export { DESKTOP_SCAPE_REOPEN_SMOKE_MODE, DESKTOP_SCAPE_REOPEN_SMOKE_PREFIX };

export const MAX_DESKTOP_SCAPE_REOPEN_PLAN_BYTES = 4 * 1024;
const MAXIMUM_CHILD_OUTPUT_BYTES = 1024 * 1024;

export function createDesktopScapeReopenSmokePlan({
	productId = 'soundscaper',
	token,
} = {}) {
	return deepFreeze(validateScapeReopenSmokePlan({
		schemaVersion: 1,
		mode: DESKTOP_SCAPE_REOPEN_SMOKE_MODE,
		productId,
		token,
		project: fixtureProjectDescriptor(),
	}));
}

export function encodeDesktopScapeReopenSmokePlan(value) {
	const encoded = encodeScapeReopenSmokePlan(validateScapeReopenSmokePlan(value));
	if (Buffer.byteLength(encoded, 'utf8') > MAX_DESKTOP_SCAPE_REOPEN_PLAN_BYTES) {
		throw new RangeError('Desktop Scape-reopen smoke plan exceeds its 4 KiB command-line limit');
	}
	return encoded;
}

export function decodeDesktopScapeReopenSmokePlan(value) {
	if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > MAX_DESKTOP_SCAPE_REOPEN_PLAN_BYTES) {
		throw new RangeError('Desktop Scape-reopen smoke plan exceeds its 4 KiB command-line limit');
	}
	return deepFreeze(decodeScapeReopenSmokePlan(value));
}

export function createDesktopScapeReopenSmokeInvocation({
	arch,
	outputRoot,
	platform,
	productId = 'soundscaper',
	profileRoot,
	token,
} = {}) {
	const targetArch = resolveSmokeArchitecture(arch, arch);
	const targetPlatform = validPlatform(platform);
	const output = absolutePath(outputRoot, 'package output root');
	const profile = absolutePath(profileRoot, 'profile root');
	const plan = createDesktopScapeReopenSmokePlan({ productId, token });
	const encodedPlan = encodeDesktopScapeReopenSmokePlan(plan);
	const userDataPath = resolve(profile, 'profile');
	const sharedAppDataPath = resolve(profile, 'application-data');
	return deepFreeze({
		arch: targetArch,
		platform: targetPlatform,
		productId: plan.productId,
		plan,
		encodedPlan,
		userDataPath,
		sharedAppDataPath,
		executableCandidates: packagedExecutableCandidates({
			arch: targetArch,
			outputRoot: output,
			platform: targetPlatform,
			productId: plan.productId,
			productName: 'Soundscaper',
		}),
		appArguments: [
			`--user-data-dir=${userDataPath}`,
			'--soundscaper-smoke',
			`--soundscaper-smoke-mode=${DESKTOP_SCAPE_REOPEN_SMOKE_MODE}`,
			`--soundscaper-smoke-plan=${encodedPlan}`,
			`--soundscaper-smoke-app-data=${sharedAppDataPath}`,
			'--lang=en',
			'--mute-audio',
			'--autoplay-policy=no-user-gesture-required',
		],
	});
}

export function parseDesktopScapeReopenSmokeOutput(output, invocation) {
	if (typeof output !== 'string') throw new TypeError('Packaged Scape-reopen child output must be text');
	if (Buffer.byteLength(output, 'utf8') > MAXIMUM_CHILD_OUTPUT_BYTES) {
		throw new RangeError('Packaged Scape-reopen child output exceeds its 1 MiB limit');
	}
	validateInvocation(invocation);
	const marker = `${DESKTOP_SCAPE_REOPEN_SMOKE_PREFIX} `;
	const matches = output.split(/\r?\n/u).filter((line) => line.startsWith(marker));
	if (matches.length !== 1) throw new Error('Packaged Scape-reopen child must emit exactly one smoke result');
	let payload;
	try {
		payload = JSON.parse(matches[0].slice(marker.length));
	} catch (error) {
		throw new TypeError('Packaged Scape-reopen child emitted invalid result JSON', { cause: error });
	}
	return deepFreeze(validateScapeReopenSmokeResult(payload, invocation.plan));
}

export function formatDesktopScapeReopenSmokeResult(result) {
	const validated = validateScapeReopenSmokeResult(result);
	const line = `${DESKTOP_SCAPE_REOPEN_SMOKE_PREFIX} ${JSON.stringify(validated)}`;
	if (Buffer.byteLength(line, 'utf8') > 64 * 1024) {
		throw new RangeError('Desktop Scape-reopen smoke result exceeds its 64 KiB limit');
	}
	return line;
}

export function formatDesktopScapePersistenceSmokeResult(result) {
	const validated = validatePersistenceResult(result);
	return [
		formatDesktopScapeOpenSmokeResult(validated.open),
		formatDesktopScapeReopenSmokeResult(validated.reopen),
	].join('\n');
}

export async function runDesktopScapePersistenceSmoke({
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
	removeArchive = unlink,
	removeProfile = rm,
} = {}) {
	const root = absolutePath(repositoryRoot, 'repository root');
	for (const [candidate, label] of [
		[createProfile, 'profile factory'],
		[createFixture, 'fixture factory'],
		[findExecutable, 'executable finder'],
		[runChild, 'child runner'],
		[removeArchive, 'archive remover'],
		[removeProfile, 'profile remover'],
	]) {
		if (typeof candidate !== 'function') throw new TypeError(`Desktop Scape persistence ${label} must be a function`);
	}
	const packageRoot = outputRoot === undefined ? resolve(root, 'release/desktop') : outputRoot;
	const profileRoot = await createdProfilePath(
		await createProfile(join(tmpdir(), 'scape-reopen-')),
	);
	let operationError;
	let result;
	try {
		const fixture = await createFixture(profileRoot);
		validateFixture(fixture, profileRoot);
		const openInvocation = createDesktopScapeOpenSmokeInvocation({
			arch,
			archiveByteLength: fixture.byteLength,
			outputRoot: packageRoot,
			platform,
			productId,
			profileRoot,
			scapePath: fixture.path,
			token,
		});
		const executable = await findExecutable(openInvocation);
		const childEnvironment = childEnvironmentFor(environment);
		const openChild = await runInvocation({
			executable,
			invocation: openInvocation,
			platform,
			environment: childEnvironment,
			repositoryRoot: root,
			runChild,
			label: 'open',
		});
		const open = parseDesktopScapeOpenSmokeOutput(openChild.stdout, openInvocation);
		await verifyFixtureUnchanged(fixture);
		await removeArchive(fixture.path);
		await assertPathMissing(fixture.path);
		const reopenInvocation = createDesktopScapeReopenSmokeInvocation({
			arch,
			outputRoot: packageRoot,
			platform,
			productId,
			profileRoot,
			token,
		});
		assertSamePersistentRoots(openInvocation, reopenInvocation);
		const reopenChild = await runInvocation({
			executable,
			invocation: reopenInvocation,
			platform,
			environment: childEnvironment,
			repositoryRoot: root,
			runChild,
			label: 'reopen',
		});
		const reopen = parseDesktopScapeReopenSmokeOutput(reopenChild.stdout, reopenInvocation);
		result = validatePersistenceResult({ open, reopen });
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
			'Desktop Scape persistence smoke failed and profile cleanup also failed',
			{ cause: operationError },
		);
	}
	if (operationError) throw operationError;
	if (cleanupError) throw cleanupError;
	return result;
}

function validatePersistenceResult(value) {
	assertClosedRecord(value, ['open', 'reopen'], 'Scape persistence smoke result');
	const open = validateScapeOpenSmokeResult(value.open);
	const reopen = validateScapeReopenSmokeResult(value.reopen);
	if (open.productId !== reopen.productId
		|| open.token !== reopen.token
		|| JSON.stringify(open.project) !== JSON.stringify(reopen.project)) {
		throw new TypeError('Desktop Scape persistence results do not describe one project and run');
	}
	return deepFreeze({ open, reopen });
}

async function runInvocation({
	executable, invocation, platform, environment, repositoryRoot, runChild, label,
}) {
	const useXvfb = platform === 'linux' && environment.SOUNDSCAPER_SMOKE_XVFB === 'true';
	const command = useXvfb ? 'xvfb-run' : executable;
	const args = useXvfb ? ['-a', executable, ...invocation.appArguments] : invocation.appArguments;
	const child = await runChild(command, args, { cwd: repositoryRoot, environment });
	if (child.code !== 0) {
		throw new Error(`Packaged Scape ${label} smoke exited with code ${String(child.code)}.\n${childDiagnostics(child)}`);
	}
	return child;
}

function childEnvironmentFor(environment) {
	if (!environment || typeof environment !== 'object' || Array.isArray(environment)) {
		throw new TypeError('Desktop Scape persistence child environment is required');
	}
	const childEnvironment = { ...environment };
	delete childEnvironment.ELECTRON_RUN_AS_NODE;
	delete childEnvironment.SCAPE_PRODUCT;
	return childEnvironment;
}

async function verifyFixtureUnchanged(fixture) {
	const after = await stat(fixture.path);
	const sha256 = createHash('sha256').update(await readFile(fixture.path)).digest('hex');
	if (!after.isFile() || after.size !== fixture.byteLength || sha256 !== fixture.sha256) {
		throw new Error('Packaged Scape persistence smoke changed its fixture archive');
	}
}

function validateFixture(value, profileRoot) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Desktop Scape persistence fixture result must be an object');
	}
	if (!Number.isSafeInteger(value.byteLength) || value.byteLength < 1
		|| value.assetBytes !== DESKTOP_SCAPE_OPEN_FIXTURE.audio.assetBytes
		|| !/^[a-f\d]{64}$/u.test(value.sha256)
		|| value.path !== resolve(profileRoot, DESKTOP_SCAPE_OPEN_FIXTURE.archiveName)
		|| JSON.stringify(value.project) !== JSON.stringify(fixtureProjectDescriptor())) {
		throw new Error('Desktop Scape persistence fixture result does not match the fixed fixture');
	}
}

function validateInvocation(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Desktop Scape-reopen invocation must be an object');
	}
	const plan = validateScapeReopenSmokePlan(value.plan);
	const decoded = decodeDesktopScapeReopenSmokePlan(value.encodedPlan);
	if (JSON.stringify(decoded) !== JSON.stringify(plan) || value.productId !== plan.productId
		|| value.appArguments.some((argument) => argument.endsWith('.scape'))) {
		throw new Error('Desktop Scape-reopen invocation does not match its plan');
	}
}

function assertSamePersistentRoots(open, reopen) {
	if (open.userDataPath !== reopen.userDataPath
		|| open.sharedAppDataPath !== reopen.sharedAppDataPath) {
		throw new Error('Desktop Scape persistence stages must share both isolated data roots');
	}
}

async function assertPathMissing(path) {
	try {
		await lstat(path);
	} catch (error) {
		if (error?.code === 'ENOENT') return;
		throw error;
	}
	throw new Error('Desktop Scape persistence fixture archive still exists before reopen');
}

function fixtureProjectDescriptor() {
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

async function createdProfilePath(value) {
	const path = absolutePath(value, 'created profile root');
	const entry = await lstat(path);
	if (dirname(path) !== resolve(tmpdir()) || !basename(path).startsWith('scape-reopen-')
		|| !entry.isDirectory() || entry.isSymbolicLink()) {
		throw new TypeError('Desktop Scape persistence profile must be a direct scape-reopen-* temporary directory');
	}
	return path;
}

function absolutePath(value, label) {
	if (typeof value !== 'string' || !value || value.includes('\0')
		|| !isAbsolute(value) || resolve(value) !== value) {
		throw new TypeError(`Desktop Scape persistence ${label} must be a normalized absolute path`);
	}
	return value;
}

function validPlatform(value) {
	if (!['darwin', 'linux', 'win32'].includes(value)) {
		throw new Error(`Unsupported desktop Scape-reopen platform: ${String(value)}`);
	}
	return value;
}

function assertClosedRecord(value, keys, label) {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| Object.getPrototypeOf(value) !== Object.prototype
		|| JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
		throw new TypeError(`Desktop ${label} has unsupported fields or is not a closed object`);
	}
}

function childDiagnostics(child) {
	return [child.stdout, child.stderr].filter(Boolean).join('\n');
}

function deepFreeze(value) {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	for (const nested of Object.values(value)) deepFreeze(nested);
	return Object.freeze(value);
}
