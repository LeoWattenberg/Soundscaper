/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash, randomBytes } from 'node:crypto';
import { access, lstat, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';

import {
	SOUNDSCAPER_DELIVERY_RESTART_CRASH_EXIT_CODE,
	SOUNDSCAPER_DELIVERY_RESTART_SMOKE_ARGUMENT_PREFIX,
	SOUNDSCAPER_DELIVERY_RESTART_SMOKE_PREFIX,
	createSoundscaperDeliveryRestartSmokePlan,
	decodeSoundscaperDeliveryRestartSmokePlan,
	encodeSoundscaperDeliveryRestartSmokePlan,
	soundscaperDeliveryRestartSmokeOutputRoot,
	validateSoundscaperDeliveryRestartSmokeEvidence,
} from '../../desktop/soundscaper-delivery-restart-smoke.mjs';
import { packagedExecutableCandidates, resolveSmokeArchitecture } from './desktop-smoke.mjs';
import { runBoundedDesktopScapeOpenChild } from './desktop-scape-open-smoke.mjs';

const PRODUCT_ID = 'soundscaper';
const PRODUCT_NAME = 'Soundscaper';
const MAXIMUM_CHILD_OUTPUT_BYTES = 1024 * 1024;

export function createDesktopSoundscaperDeliveryRestartSmokeInvocation({
	arch,
	outputRoot,
	platform,
	profileRoot,
	stage,
	token,
} = {}) {
	const targetArch = resolveSmokeArchitecture(arch, arch);
	const targetPlatform = validPlatform(platform);
	const output = absolutePath(outputRoot, 'package output root');
	const profile = absolutePath(profileRoot, 'profile root');
	const plan = createSoundscaperDeliveryRestartSmokePlan({ stage, token });
	const encodedPlan = encodeSoundscaperDeliveryRestartSmokePlan(plan);
	return deepFreeze({
		arch: targetArch,
		platform: targetPlatform,
		productId: PRODUCT_ID,
		plan,
		encodedPlan,
		profileRoot: profile,
		executableCandidates: packagedExecutableCandidates({
			arch: targetArch, outputRoot: output, platform: targetPlatform,
			productId: PRODUCT_ID, productName: PRODUCT_NAME,
		}),
		appArguments: [
			`--user-data-dir=${profile}`,
			`${SOUNDSCAPER_DELIVERY_RESTART_SMOKE_ARGUMENT_PREFIX}${encodedPlan}`,
			'--lang=en',
			'--mute-audio',
		],
	});
}

export function parseDesktopSoundscaperDeliveryRestartSmokeOutput(output, invocation) {
	if (typeof output !== 'string' || Buffer.byteLength(output, 'utf8') > MAXIMUM_CHILD_OUTPUT_BYTES) {
		throw new TypeError('Packaged persistent delivery restart output is invalid.');
	}
	validateInvocation(invocation, 'recover-publication');
	const matches = output.split(/\r?\n/u).filter((line) => line.startsWith(
		SOUNDSCAPER_DELIVERY_RESTART_SMOKE_PREFIX,
	));
	if (matches.length !== 1) {
		throw new Error('Packaged persistent delivery recovery must emit exactly one result.');
	}
	let parsed;
	try {
		parsed = JSON.parse(matches[0].slice(SOUNDSCAPER_DELIVERY_RESTART_SMOKE_PREFIX.length));
	} catch (error) {
		throw new TypeError('Packaged persistent delivery recovery emitted invalid JSON.', { cause: error });
	}
	return validateSoundscaperDeliveryRestartSmokeEvidence(parsed, invocation.plan.token);
}

export async function runDesktopSoundscaperDeliveryRestartPublicationSmoke({
	repositoryRoot,
	arch = process.env.SOUNDSCAPER_SMOKE_ARCH || process.arch,
	platform = process.platform,
	environment = process.env,
	outputRoot,
	token = randomBytes(16).toString('hex'),
	createProfile = (prefix) => mkdtemp(prefix),
	findExecutable = findPackagedExecutable,
	runChild = runBoundedDesktopScapeOpenChild,
	removeProfile = rm,
} = {}) {
	const root = absolutePath(repositoryRoot, 'repository root');
	for (const [candidate, label] of [
		[createProfile, 'profile factory'], [findExecutable, 'executable finder'],
		[runChild, 'child runner'], [removeProfile, 'profile remover'],
	]) {
		if (typeof candidate !== 'function') {
			throw new TypeError(`Packaged persistent delivery restart ${label} must be a function.`);
		}
	}
	const packageRoot = outputRoot === undefined ? resolve(root, 'release/desktop')
		: absolutePath(outputRoot, 'package output root');
	const profileRoot = await createdProfilePath(
		await createProfile(join(tmpdir(), 'soundscaper-delivery-restart-')),
	);
	let operationError;
	let result;
	try {
		const interrupted = createDesktopSoundscaperDeliveryRestartSmokeInvocation({
			arch, outputRoot: packageRoot, platform, profileRoot,
			stage: 'interrupt-publication', token,
		});
		const executable = await findExecutable(interrupted);
		const childEnvironment = childEnvironmentFor(environment);
		const first = await runInvocation({
			executable, invocation: interrupted, platform, environment: childEnvironment,
			repositoryRoot: root, runChild,
		});
		if (first.code !== SOUNDSCAPER_DELIVERY_RESTART_CRASH_EXIT_CODE) {
			throw new Error(
				`Packaged persistent delivery interrupt exited ${String(first.code)}, not the crash fence.\n${diagnostics(first)}`,
			);
		}
		const interruptedArtifact = await inspectInterruptedPublication(profileRoot, token);
		const recovered = createDesktopSoundscaperDeliveryRestartSmokeInvocation({
			arch, outputRoot: packageRoot, platform, profileRoot,
			stage: 'recover-publication', token,
		});
		assertSameDurableScope(interrupted, recovered);
		const second = await runInvocation({
			executable, invocation: recovered, platform, environment: childEnvironment,
			repositoryRoot: root, runChild,
		});
		if (second.code !== 0) {
			throw new Error(`Packaged persistent delivery recovery exited ${String(second.code)}.\n${diagnostics(second)}`);
		}
		result = parseDesktopSoundscaperDeliveryRestartSmokeOutput(second.stdout, recovered);
		if (result.publication.byteLength !== interruptedArtifact.byteLength
			|| result.publication.sha256 !== interruptedArtifact.sha256) {
			throw new Error('Recovered publication does not authenticate the interrupted native publication.');
		}
		await inspectRecoveredPublication(profileRoot, token, interruptedArtifact);
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
			'Packaged persistent delivery restart smoke and cleanup both failed.',
			{ cause: operationError },
		);
	}
	if (operationError) throw operationError;
	if (cleanupError) throw cleanupError;
	return result;
}

async function inspectInterruptedPublication(profileRoot, token) {
	const outputRoot = soundscaperDeliveryRestartSmokeOutputRoot(profileRoot, token);
	const names = (await readdir(outputRoot)).sort();
	if (JSON.stringify(names) !== JSON.stringify(['restart-master.wav'])) {
		throw new Error('The interrupted process did not leave one exact native publication.');
	}
	return regularFile(join(outputRoot, 'restart-master.wav'));
}

async function inspectRecoveredPublication(profileRoot, token, expected) {
	const outputRoot = soundscaperDeliveryRestartSmokeOutputRoot(profileRoot, token);
	const names = (await readdir(outputRoot)).sort();
	if (JSON.stringify(names) !== JSON.stringify(['restart-master.wav'])) {
		throw new Error('Recovery did not retire the partial into one unambiguous final file.');
	}
	const final = await regularFile(join(outputRoot, 'restart-master.wav'));
	if (final.byteLength !== expected.byteLength || final.sha256 !== expected.sha256) {
		throw new Error('Recovery changed the authenticated publication bytes.');
	}
}

async function regularFile(path) {
	const details = await lstat(path);
	if (!details.isFile() || details.isSymbolicLink() || details.size < 1 || details.size > 1024 * 1024) {
		throw new Error('Packaged persistent delivery smoke artifact is not one bounded regular file.');
	}
	const bytes = await readFile(path);
	return Object.freeze({
		byteLength: bytes.byteLength,
		sha256: createHash('sha256').update(bytes).digest('hex'),
	});
}

async function runInvocation({ executable, invocation, platform, environment, repositoryRoot, runChild }) {
	const useXvfb = platform === 'linux' && environment.SOUNDSCAPER_SMOKE_XVFB === 'true';
	const command = useXvfb ? 'xvfb-run' : executable;
	const args = useXvfb ? ['-a', executable, ...invocation.appArguments] : invocation.appArguments;
	return runChild(command, args, {
		cwd: repositoryRoot, environment, maximumOutputBytes: MAXIMUM_CHILD_OUTPUT_BYTES,
	});
}

async function findPackagedExecutable(invocation) {
	validateInvocation(invocation);
	for (const candidate of invocation.executableCandidates) {
		try { await access(candidate); return candidate; }
		catch { /* Try the next electron-builder output convention. */ }
	}
	throw new Error('No packaged Soundscaper executable was found for persistent delivery restart smoke.');
}

function validateInvocation(value, expectedStage) {
	if (!value || typeof value !== 'object' || value.productId !== PRODUCT_ID) {
		throw new TypeError('Packaged persistent delivery restart invocation is invalid.');
	}
	const decoded = decodeSoundscaperDeliveryRestartSmokePlan(value.encodedPlan);
	if (JSON.stringify(decoded) !== JSON.stringify(value.plan)
		|| (expectedStage !== undefined && decoded.stage !== expectedStage)
		|| !value.appArguments.includes(`--user-data-dir=${value.profileRoot}`)) {
		throw new Error('Packaged persistent delivery restart invocation does not match its plan.');
	}
	return value;
}

function assertSameDurableScope(first, second) {
	if (first.profileRoot !== second.profileRoot || first.plan.token !== second.plan.token
		|| first.arch !== second.arch || first.platform !== second.platform) {
		throw new Error('Persistent delivery restart stages do not share one exact durable scope.');
	}
}

function childEnvironmentFor(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Packaged persistent delivery restart child environment is invalid.');
	}
	const environment = { ...value };
	delete environment.ELECTRON_RUN_AS_NODE;
	delete environment.SCAPE_PRODUCT;
	return environment;
}

async function createdProfilePath(value) {
	const path = absolutePath(value, 'created profile root');
	const details = await lstat(path);
	if (dirname(path) !== resolve(tmpdir()) || !basename(path).startsWith('soundscaper-delivery-restart-')
		|| !details.isDirectory() || details.isSymbolicLink()) {
		throw new TypeError('Persistent delivery restart profile must be a direct temporary directory.');
	}
	return path;
}

function absolutePath(value, label) {
	if (typeof value !== 'string' || !value || value.includes('\0')
		|| !isAbsolute(value) || resolve(value) !== value) {
		throw new TypeError(`Packaged persistent delivery restart ${label} must be a normalized absolute path.`);
	}
	return value;
}

function validPlatform(value) {
	if (!['darwin', 'linux', 'win32'].includes(value)) {
		throw new Error(`Unsupported packaged persistent delivery restart platform: ${String(value)}`);
	}
	return value;
}

function diagnostics(child) { return [child.stdout, child.stderr].filter(Boolean).join('\n'); }

function deepFreeze(value) {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	for (const nested of Object.values(value)) deepFreeze(nested);
	return Object.freeze(value);
}
