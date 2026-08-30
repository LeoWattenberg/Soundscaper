/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';

import { describeSoundscaperProfessionalNativePayload } from './soundscaper-professional-native-payload.mjs';

export const SOUNDSCAPER_DELIVERY_RESTART_SMOKE_ARGUMENT_PREFIX =
	'--soundscaper-delivery-restart-publication-smoke=';
export const SOUNDSCAPER_DELIVERY_RESTART_SMOKE_PREFIX =
	'SOUNDSCAPER_DELIVERY_RESTART_PUBLICATION_SMOKE ';
export const SOUNDSCAPER_DELIVERY_RESTART_CRASH_EXIT_CODE = 86;

const MODE = 'soundscaper-delivery-restart-publication';
const PRODUCT_ID = 'soundscaper';
const DATABASE_FILE_NAME = 'soundscaper-delivery-services-v1.sqlite';
const FINAL_FILE_NAME = 'restart-master.wav';
const STAGES = new Set(['interrupt-publication', 'recover-publication']);
const MAXIMUM_PLAN_BYTES = 2 * 1024;
const INTERRUPT_NOW_MS = 1_000;
const RECOVERY_NOW_MS = 40_000;

export function createSoundscaperDeliveryRestartSmokePlan({ stage, token } = {}) {
	return deepFreeze(validatePlan({
		schemaVersion: 1, mode: MODE, productId: PRODUCT_ID, stage, token,
	}));
}

export function encodeSoundscaperDeliveryRestartSmokePlan(value) {
	const json = JSON.stringify(validatePlan(value));
	if (Buffer.byteLength(json, 'utf8') > MAXIMUM_PLAN_BYTES) {
		throw new RangeError('Persistent delivery restart smoke plan exceeds 2 KiB.');
	}
	return Buffer.from(json, 'utf8').toString('base64url');
}

export function decodeSoundscaperDeliveryRestartSmokePlan(value) {
	if (typeof value !== 'string' || !value || value.length > MAXIMUM_PLAN_BYTES * 2
		|| !/^[A-Za-z\d_-]+$/u.test(value)) {
		throw new TypeError('Persistent delivery restart smoke plan encoding is invalid.');
	}
	let decoded;
	try {
		const bytes = Buffer.from(value, 'base64url');
		if (bytes.byteLength > MAXIMUM_PLAN_BYTES
			|| bytes.toString('base64url') !== value) throw new Error('non-canonical encoding');
		decoded = JSON.parse(bytes.toString('utf8'));
	} catch (error) {
		throw new TypeError('Persistent delivery restart smoke plan is not canonical JSON.', { cause: error });
	}
	return deepFreeze(validatePlan(decoded));
}

export function soundscaperDeliveryRestartSmokeOutputRoot(userDataPath, token) {
	return join(absolutePath(userDataPath, 'user-data root'), `persistent-delivery-restart-${validToken(token)}`);
}

/** Run before ordinary desktop startup so the first stage can model an abrupt process death. */
export async function runSoundscaperDeliveryRestartPublicationSmoke(options) {
	const argv = stringArray(options?.argv, 'arguments');
	const requests = argv.filter((value) => value.startsWith(
		SOUNDSCAPER_DELIVERY_RESTART_SMOKE_ARGUMENT_PREFIX,
	));
	if (requests.length === 0) return false;
	if (requests.length !== 1 || options?.packaged !== true || options?.productId !== PRODUCT_ID) {
		throw new Error('Persistent delivery restart smoke requires one packaged Soundscaper request.');
	}
	const plan = decodeSoundscaperDeliveryRestartSmokePlan(
		requests[0].slice(SOUNDSCAPER_DELIVERY_RESTART_SMOKE_ARGUMENT_PREFIX.length),
	);
	const userDataPath = absolutePath(options.userDataPath, 'user-data root');
	const runtime = options.runtime ?? await loadPackagedRuntime(options);
	validateRuntime(runtime);
	const outputBytes = options.outputBytes === undefined
		? createSmokeWavBytes() : exactBytes(options.outputBytes);
	const log = functionValue(options.log ?? console.log, 'log');
	if (plan.stage === 'interrupt-publication') {
		await interruptPublication({
			plan, userDataPath, runtime, outputBytes,
			crashProcess: functionValue(
				options.crashProcess ?? ((code) => process.exit(code)), 'crash process',
			),
		});
		return true;
	}
	const evidence = await recoverPublication({ plan, userDataPath, runtime, outputBytes });
	log(`${SOUNDSCAPER_DELIVERY_RESTART_SMOKE_PREFIX}${JSON.stringify(evidence)}`);
	return true;
}

export function validateSoundscaperDeliveryRestartSmokeEvidence(value, expectedToken) {
	closedRecord(value, [
		'schemaVersion', 'mode', 'productId', 'token', 'state', 'attempt',
		'recoveredPreparedJournal', 'persistedReport', 'publication', 'visibleFiles',
	], 'recovery evidence');
	if (value.schemaVersion !== 1 || value.mode !== MODE || value.productId !== PRODUCT_ID
		|| value.token !== validToken(expectedToken) || value.state !== 'completed'
		|| value.attempt !== 1 || value.recoveredPreparedJournal !== true
		|| value.persistedReport !== true) {
		throw new TypeError('Persistent delivery restart smoke recovery evidence is invalid.');
	}
	closedRecord(value.publication, ['fileName', 'byteLength', 'sha256'], 'publication evidence');
	if (value.publication.fileName !== FINAL_FILE_NAME
		|| !Number.isSafeInteger(value.publication.byteLength) || value.publication.byteLength < 1
		|| !/^[a-f\d]{64}$/u.test(value.publication.sha256)
		|| !Array.isArray(value.visibleFiles)
		|| JSON.stringify(value.visibleFiles) !== JSON.stringify([FINAL_FILE_NAME])) {
		throw new TypeError('Persistent delivery restart smoke publication evidence is invalid.');
	}
	return deepFreeze(structuredClone(value));
}

async function interruptPublication({ plan, userDataPath, runtime, outputBytes, crashProcess }) {
	const outputRoot = soundscaperDeliveryRestartSmokeOutputRoot(userDataPath, plan.token);
	await mkdir(outputRoot, { recursive: false, mode: 0o700 });
	let crashRequested = false;
	const identity = projectIdentity(plan.token);
	const service = await runtime.startService({
		databasePath: join(userDataPath, runtime.databaseFileName ?? DATABASE_FILE_NAME),
		instanceId: `restart_interrupt_${plan.token}`,
		processId: process.pid,
		now: () => INTERRUPT_NOW_MS,
		readProjectIdentity: async (projectId) => projectId === identity.projectId ? identity : null,
		beforeFileFence(operation) {
			if (operation !== 'publication-link') return;
			crashRequested = true;
			crashProcess(SOUNDSCAPER_DELIVERY_RESTART_CRASH_EXIT_CODE);
			throw new Error('Persistent delivery restart smoke crash callback returned.');
		},
	});
	const grant = await service.authorizeRoot(outputRoot);
	const planPayload = runtime.createPlan({
		settings: { format: 'wav', sampleRate: 48_000 },
		exportPlan: { format: 'wav', sampleRate: 48_000, range: 'project' },
	});
	const description = runtime.createDescription({
		label: 'Restart publication master', projectIdentity: identity,
		destinationGrantId: grant.grantId, plan: planPayload,
	});
	await service.enqueue(description, null, admission(description));
	const claim = await service.claimNext(authority(description));
	if (!claim) throw new Error('Persistent delivery restart smoke could not claim its exact project.');
	const writer = await service.beginWrite({
		claimId: claim.claimId, fileName: FINAL_FILE_NAME, size: outputBytes.byteLength,
	});
	await service.writeChunk({ writeId: writer.writeId, offset: 0, bytes: outputBytes });
	const sealed = await service.finishWrite(writer.writeId);
	if (sealed.byteLength !== outputBytes.byteLength) {
		throw new Error('Persistent delivery restart smoke sealed a short output.');
	}
	await service.complete({
		claimId: claim.claimId,
		report: deliveryReport(),
		currentAuthority: authority(description),
		revalidateAuthority: () => authority(description),
	});
	if (crashRequested) throw new Error('Persistent delivery restart smoke did not exit at its crash fence.');
	throw new Error('Persistent delivery restart smoke never reached its post-link crash fence.');
}

async function recoverPublication({ plan, userDataPath, runtime, outputBytes }) {
	const identity = projectIdentity(plan.token);
	const outputRoot = soundscaperDeliveryRestartSmokeOutputRoot(userDataPath, plan.token);
	const service = await runtime.startService({
		databasePath: join(userDataPath, runtime.databaseFileName ?? DATABASE_FILE_NAME),
		instanceId: `restart_recovery_${plan.token}`,
		processId: process.pid,
		now: () => RECOVERY_NOW_MS,
		readProjectIdentity: async (projectId) => projectId === identity.projectId ? identity : null,
	});
	try {
		const queue = service.list({ currentProjectIdentity: identity });
		if (queue.paused !== false || queue.nextCursor !== null || queue.entries.length !== 1) {
			throw new Error('Persistent delivery restart smoke did not recover one exact queue row.');
		}
		const summary = queue.entries[0];
		const expectedSha256 = sha256(outputBytes);
		if (summary.state !== 'completed' || summary.attempt !== 1 || summary.lastFailureCode !== null
			|| summary.result?.publication?.fileName !== FINAL_FILE_NAME
			|| summary.result.publication.byteLength !== outputBytes.byteLength
			|| summary.result.publication.sha256 !== expectedSha256
			|| JSON.stringify(summary.result.report) !== JSON.stringify(deliveryReport())) {
			throw new Error('Persistent delivery restart smoke recovered an inexact result or report.');
		}
		const visibleFiles = (await readdir(outputRoot)).sort();
		if (JSON.stringify(visibleFiles) !== JSON.stringify([FINAL_FILE_NAME])) {
			throw new Error('Persistent delivery restart smoke left an ambiguous publication namespace.');
		}
		const finalPath = join(outputRoot, FINAL_FILE_NAME);
		const details = await lstat(finalPath);
		if (!details.isFile() || details.isSymbolicLink() || details.size !== outputBytes.byteLength
			|| sha256(await readFile(finalPath)) !== expectedSha256) {
			throw new Error('Persistent delivery restart smoke final file failed authentication.');
		}
		return validateSoundscaperDeliveryRestartSmokeEvidence({
			schemaVersion: 1, mode: MODE, productId: PRODUCT_ID, token: plan.token,
			state: summary.state, attempt: summary.attempt, recoveredPreparedJournal: true,
			persistedReport: true, publication: summary.result.publication, visibleFiles,
		}, plan.token);
	} finally {
		await service.close();
	}
}

async function loadPackagedRuntime(options) {
	const [database, service, contract, plan, processFilesystem] = await Promise.all([
		import('./project-library-runtime/desktop/soundscaper-delivery-database.js'),
		import('./project-library-runtime/desktop/soundscaper-delivery-service.js'),
		import('./project-library-runtime/src/common/editor/soundscaper-delivery-contract-v1.js'),
		import('./project-library-runtime/src/common/editor/soundscaper-persistent-delivery-plan-v1.js'),
		import('./project-library-runtime/desktop/soundscaper-delivery-filesystem-process.js'),
	]);
	const availability = await describeSoundscaperProfessionalNativePayload(options.nativePayloadLocation);
	if (availability.status !== 'available' || !availability.descriptor.deliveryFilesystem?.path) {
		throw new Error('Packaged persistent delivery restart smoke requires the authenticated native filesystem helper.');
	}
	const filesystem = processFilesystem.createSoundscaperDeliveryFilesystemProcessAuthority({
		executablePath: availability.descriptor.deliveryFilesystem.path,
	});
	return Object.freeze({
		databaseFileName: database.SOUNDSCAPER_DELIVERY_DATABASE_FILE_NAME,
		startService: (startOptions) => service.SoundscaperDeliveryService.start({
			...startOptions, filesystem,
		}),
		createDescription: contract.createSoundscaperDeliveryDescriptionV1,
		createPlan: plan.createSoundscaperPersistentAudioDeliveryPlanV1,
	});
}

function validateRuntime(value) {
	if (!value || typeof value !== 'object' || typeof value.startService !== 'function'
		|| typeof value.createDescription !== 'function' || typeof value.createPlan !== 'function'
		|| (value.databaseFileName !== undefined && value.databaseFileName !== DATABASE_FILE_NAME)) {
		throw new TypeError('Persistent delivery restart smoke runtime is invalid.');
	}
}

function validatePlan(value) {
	closedRecord(value, ['schemaVersion', 'mode', 'productId', 'stage', 'token'], 'plan');
	if (value.schemaVersion !== 1 || value.mode !== MODE || value.productId !== PRODUCT_ID
		|| !STAGES.has(value.stage)) throw new TypeError('Persistent delivery restart smoke plan is invalid.');
	validToken(value.token);
	return value;
}

function projectIdentity(token) {
	return Object.freeze({
		projectId: `delivery-restart-${token}`,
		projectRevision: 1,
		projectSha256: sha256(Buffer.from(`soundscaper-delivery-restart:${token}`, 'utf8')),
	});
}

function authority(description) {
	return Object.freeze({
		projectIdentity: description.projectIdentity,
		planFingerprint: description.planFingerprint,
	});
}

function admission(description) {
	return Object.freeze({
		projectIdentity: description.projectIdentity,
		planFingerprints: Object.freeze([description.planFingerprint]),
		saved: true, clean: true, named: true,
	});
}

function deliveryReport() {
	return Object.freeze({
		schemaVersion: 1, format: 'delivery', direction: 'export',
		subject: Object.freeze({
			format: 'wav', container: 'riff', codec: 'pcm-s16le', sampleRate: 48_000,
			channelCount: 1, lossless: true,
		}),
		items: Object.freeze([]),
		counts: Object.freeze({ preserved: 0, converted: 0, missing: 0, omitted: 0 }),
	});
}

function createSmokeWavBytes() {
	const bytes = Buffer.alloc(46);
	bytes.write('RIFF', 0, 'ascii');
	bytes.writeUInt32LE(38, 4);
	bytes.write('WAVEfmt ', 8, 'ascii');
	bytes.writeUInt32LE(16, 16);
	bytes.writeUInt16LE(1, 20);
	bytes.writeUInt16LE(1, 22);
	bytes.writeUInt32LE(48_000, 24);
	bytes.writeUInt32LE(96_000, 28);
	bytes.writeUInt16LE(2, 32);
	bytes.writeUInt16LE(16, 34);
	bytes.write('data', 36, 'ascii');
	bytes.writeUInt32LE(2, 40);
	return new Uint8Array(bytes);
}

function exactBytes(value) {
	if (!(value instanceof Uint8Array) || value.byteLength < 1 || value.byteLength > 1024 * 1024) {
		throw new TypeError('Persistent delivery restart smoke output bytes are invalid.');
	}
	return value.slice();
}

function sha256(value) { return createHash('sha256').update(value).digest('hex'); }

function validToken(value) {
	if (typeof value !== 'string' || !/^[a-f\d]{32}$/u.test(value)) {
		throw new TypeError('Persistent delivery restart smoke token is invalid.');
	}
	return value;
}

function absolutePath(value, label) {
	if (typeof value !== 'string' || !value || value.includes('\0')
		|| !isAbsolute(value) || resolve(value) !== value) {
		throw new TypeError(`Persistent delivery restart smoke ${label} must be a normalized absolute path.`);
	}
	return value;
}

function stringArray(value, label) {
	if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.includes('\0'))) {
		throw new TypeError(`Persistent delivery restart smoke ${label} must be strings.`);
	}
	return value;
}

function functionValue(value, label) {
	if (typeof value !== 'function') throw new TypeError(`Persistent delivery restart smoke ${label} is invalid.`);
	return value;
}

function closedRecord(value, fields, label) {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| Object.getPrototypeOf(value) !== Object.prototype
		|| JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...fields].sort())) {
		throw new TypeError(`Persistent delivery restart smoke ${label} has unsupported fields.`);
	}
}

function deepFreeze(value) {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	for (const nested of Object.values(value)) deepFreeze(nested);
	return Object.freeze(value);
}
