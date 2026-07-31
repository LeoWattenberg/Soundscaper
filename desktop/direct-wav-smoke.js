/* SPDX-License-Identifier: AGPL-3.0-only */

import { mkdir, readdir, stat } from 'node:fs/promises';
import { isAbsolute, join, normalize } from 'node:path';

import { runDirectWavRendererSmoke } from './direct-wav-renderer-smoke.js';

export { runDirectWavRendererSmoke };

export const DESKTOP_DIRECT_WAV_SMOKE_MODE = 'direct-wav-export-v1';
export const DESKTOP_DIRECT_WAV_SMOKE_PREFIX = 'SOUNDSCAPER_DESKTOP_DIRECT_WAV_SMOKE';
export const DIRECT_AIFF_SMOKE_FILE_BYTES = 202_751_798;
export const DIRECT_BWF_SMOKE_FILE_BYTES = 50_688_702;
export const DIRECT_WAV_SMOKE_FILE_BYTES = 202_751_788;

const SMOKE_ARGUMENT = '--soundscaper-smoke';
const SMOKE_MODE_PREFIX = '--soundscaper-smoke-mode=';
const SMOKE_PLAN_PREFIX = '--soundscaper-smoke-plan=';
const SMOKE_APP_DATA_PREFIX = '--soundscaper-smoke-app-data=';
const MAXIMUM_PLAN_BYTES = 512;
const TOKEN = /^[a-f\d]{32}$/u;
const PRODUCT_IDS = new Set(['soundscaper', 'framescaper']);
const PLAN_FIELDS = Object.freeze(['schemaVersion', 'mode', 'productId', 'token']);
const RENDERER_FIELDS = Object.freeze([
	'imported', 'completed', 'cancelled', 'aiffCompleted', 'bwfCompleted', 'realtimeCount', 'downloadVisible',
]);
const NATIVE_FIELDS = Object.freeze([
	'selectionPurposes', 'completedBytes', 'completedAiffBytes', 'completedBwfBytes',
	'aiffChoiceValidated', 'bwfChoiceValidated', 'cancelledAbsent', 'stagingFilesRemaining',
]);
const RESULT_FIELDS = Object.freeze([...PLAN_FIELDS, 'renderer', 'native']);

export function validateDirectWavSmokePlan(value) {
	assertClosedRecord(value, PLAN_FIELDS, 'Direct WAV smoke plan');
	if (value.schemaVersion !== 1) throw new TypeError('Direct WAV smoke plan has an unsupported schema');
	if (value.mode !== DESKTOP_DIRECT_WAV_SMOKE_MODE) throw new TypeError('Direct WAV smoke plan has an unsupported mode');
	if (!PRODUCT_IDS.has(value.productId)) throw new TypeError('Direct WAV smoke plan has an unsupported product');
	if (typeof value.token !== 'string' || !TOKEN.test(value.token)) {
		throw new TypeError('Direct WAV smoke plan token must be 32 lowercase hexadecimal characters');
	}
	return Object.freeze({
		schemaVersion: 1,
		mode: DESKTOP_DIRECT_WAV_SMOKE_MODE,
		productId: value.productId,
		token: value.token,
	});
}

export function encodeDirectWavSmokePlan(value) {
	const json = canonicalJson(validateDirectWavSmokePlan(value));
	const bytes = Buffer.from(json, 'utf8');
	if (bytes.byteLength > MAXIMUM_PLAN_BYTES) throw new RangeError('Direct WAV smoke plan exceeds its byte limit');
	return bytes.toString('base64url');
}

export function decodeDirectWavSmokePlan(value) {
	if (typeof value !== 'string' || !value || !/^[A-Za-z\d_-]+$/u.test(value)) {
		throw new TypeError('Direct WAV smoke plan must be unpadded base64url');
	}
	if (Buffer.byteLength(value, 'utf8') > Math.ceil(MAXIMUM_PLAN_BYTES * 4 / 3)) {
		throw new RangeError('Direct WAV smoke plan exceeds its byte limit');
	}
	const bytes = Buffer.from(value, 'base64url');
	if (bytes.toString('base64url') !== value) throw new TypeError('Direct WAV smoke plan must be canonical base64url');
	if (bytes.byteLength > MAXIMUM_PLAN_BYTES) throw new RangeError('Direct WAV smoke plan exceeds its byte limit');
	let json;
	try {
		json = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	} catch {
		throw new TypeError('Direct WAV smoke plan must contain UTF-8 JSON');
	}
	let parsed;
	try {
		parsed = JSON.parse(json);
	} catch {
		throw new TypeError('Direct WAV smoke plan must contain JSON');
	}
	const plan = validateDirectWavSmokePlan(parsed);
	if (canonicalJson(plan) !== json) throw new TypeError('Direct WAV smoke plan JSON must be canonical');
	return plan;
}

export function createDirectWavSmokeTargetHarness(options = {}) {
	const argv = stringArguments(options.argv);
	const smokeCount = argv.filter((argument) => argument === SMOKE_ARGUMENT).length;
	const modes = valuesForPrefix(argv, SMOKE_MODE_PREFIX);
	const encodedPlans = valuesForPrefix(argv, SMOKE_PLAN_PREFIX);
	const appDataValues = valuesForPrefix(argv, SMOKE_APP_DATA_PREFIX);
	if (smokeCount !== 1 || modes.length !== 1 || modes[0] !== DESKTOP_DIRECT_WAV_SMOKE_MODE) {
		throw new TypeError('Direct WAV target harness requires exactly one matching smoke mode');
	}
	if (encodedPlans.length !== 1) throw new TypeError('Direct WAV target harness requires exactly one smoke plan');
	if (appDataValues.length !== 1) throw new TypeError('Direct WAV target harness requires exactly one app data argument');
	const argvPlan = decodeDirectWavSmokePlan(encodedPlans[0]);
	const plan = options.plan === undefined ? argvPlan : validateDirectWavSmokePlan(options.plan);
	if (encodeDirectWavSmokePlan(plan) !== encodedPlans[0]) throw new TypeError('Direct WAV target harness plan does not match argv');
	const argvAppDataPath = appDataValues[0];
	const suppliedAppDataPath = options.appDataPath ?? argvAppDataPath;
	if (typeof suppliedAppDataPath !== 'string' || !isAbsolute(suppliedAppDataPath)
		|| !isAbsolute(argvAppDataPath)
		|| normalize(suppliedAppDataPath) !== normalize(argvAppDataPath)) {
		throw new TypeError('Direct WAV target harness requires one matching absolute app data path');
	}
	if (normalize(argvAppDataPath) !== argvAppDataPath) {
		throw new TypeError('Direct WAV target harness app data path must be normalized');
	}
	const appDataPath = argvAppDataPath;
	const smokeRoot = join(appDataPath, `direct-wav-smoke-${plan.token}`);
	const mkdirImpl = requiredFunction(options.mkdirImpl ?? mkdir, 'mkdir');
	const statImpl = requiredFunction(options.statImpl ?? stat, 'stat');
	const readdirImpl = requiredFunction(options.readdirImpl ?? readdir, 'readdir');
	const waitImpl = options.waitImpl ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
	const now = options.now ?? Date.now;
	requiredFunction(waitImpl, 'wait');
	requiredFunction(now, 'clock');
	let rootPromise = null;
	let operation = Promise.resolve();
	const selectionPurposes = [];

	const ensureRoot = () => {
		rootPromise ??= (async () => {
			await mkdirImpl(smokeRoot, { recursive: false, mode: 0o700 });
			const details = await statImpl(smokeRoot);
			if (!details?.isDirectory?.() || (details.mode & 0o777) !== 0o700) {
				throw new Error('Direct WAV smoke root is not a private directory');
			}
		})();
		return rootPromise;
	};

	const resolveSavePath = async (choice) => {
		if (choice?.purpose !== 'audio-pcm-mix') {
			throw new TypeError('Direct WAV smoke accepts only audio-pcm-mix save choices');
		}
		const current = operation.then(async () => {
			if (selectionPurposes.length >= 4) throw new Error('Direct WAV smoke requires exactly four save choices');
			await ensureRoot();
			const fileNames = ['completed.wav', 'cancelled.wav', 'completed.aiff', 'completed-bwf.wav'];
			if (selectionPurposes.length === 2) validateAiffSaveChoice(choice);
			if (selectionPurposes.length === 3) validateBwfSaveChoice(choice);
			const fileName = fileNames[selectionPurposes.length];
			selectionPurposes.push(choice.purpose);
			return join(smokeRoot, fileName);
		});
		operation = current.then(() => undefined, () => undefined);
		return current;
	};

	const evidence = async () => {
		await operation;
		if (selectionPurposes.length !== 4) throw new Error('Direct WAV smoke requires exactly four save choices');
		await ensureRoot();
		const deadline = now() + 15_000;
		while (true) {
			const completed = await optionalStat(statImpl, join(smokeRoot, 'completed.wav'));
			const completedAiff = await optionalStat(statImpl, join(smokeRoot, 'completed.aiff'));
			const completedBwf = await optionalStat(statImpl, join(smokeRoot, 'completed-bwf.wav'));
			const cancelled = await optionalStat(statImpl, join(smokeRoot, 'cancelled.wav'));
			const names = await readdirImpl(smokeRoot);
			if (!Array.isArray(names) || names.some((name) => typeof name !== 'string')) {
				throw new TypeError('Direct WAV smoke root listing is invalid');
			}
			const stagingFilesRemaining = names.filter((name) => name.endsWith('.soundscaper-part')).length;
			if (completed?.isFile?.() && completedAiff?.isFile?.() && completedBwf?.isFile?.()
				&& !cancelled && stagingFilesRemaining === 0) {
				if (!Number.isSafeInteger(completed.size) || completed.size < 0) {
					throw new TypeError('Direct WAV completed file size is invalid');
				}
				if (!Number.isSafeInteger(completedAiff.size) || completedAiff.size < 0) {
					throw new TypeError('Direct AIFF completed file size is invalid');
				}
				if (!Number.isSafeInteger(completedBwf.size) || completedBwf.size < 0) {
					throw new TypeError('Direct BWF completed file size is invalid');
				}
				return deepFreeze({
					selectionPurposes: [...selectionPurposes],
					completedBytes: completed.size,
					completedAiffBytes: completedAiff.size,
					completedBwfBytes: completedBwf.size,
					aiffChoiceValidated: true,
					bwfChoiceValidated: true,
					cancelledAbsent: true,
					stagingFilesRemaining,
				});
			}
			if (now() >= deadline) {
				const entries = [];
				for (const name of [...names].sort().slice(0, 8)) {
					const details = await optionalStat(statImpl, join(smokeRoot, name));
					entries.push({
						name: name.slice(0, 160),
						size: Number.isSafeInteger(details?.size) ? details.size : null,
					});
				}
				throw new Error(`Direct WAV native evidence timed out: ${JSON.stringify({
					entryCount: names.length,
					entries,
				})}`);
			}
			await waitImpl(25);
		}
	};

	return Object.freeze({ resolveSavePath, evidence });
}

export function validateDirectWavRendererResult(value) {
	assertClosedRecord(value, RENDERER_FIELDS, 'Direct WAV renderer result');
	if (value.imported !== true) throw new TypeError('Direct WAV renderer did not import its fixture');
	if (value.completed !== true) throw new TypeError('Direct WAV renderer did not complete its first export');
	if (value.cancelled !== true) throw new TypeError('Direct WAV renderer did not cancel its second export');
	if (value.aiffCompleted !== true) throw new TypeError('Direct WAV renderer did not complete its AIFF export');
	if (value.bwfCompleted !== true) throw new TypeError('Direct WAV renderer did not complete its BWF export');
	if (value.realtimeCount !== 4) throw new TypeError('Direct WAV renderer must enter realtime export exactly four times');
	if (value.downloadVisible !== false) throw new TypeError('Direct WAV renderer exposed a browser download');
	return Object.freeze({
		imported: true,
		completed: true,
		cancelled: true,
		aiffCompleted: true,
		bwfCompleted: true,
		realtimeCount: 4,
		downloadVisible: false,
	});
}

export function validateDirectWavSmokeResult(value, expectedPlan = null) {
	assertClosedRecord(value, RESULT_FIELDS, 'Direct WAV smoke result');
	const plan = validateDirectWavSmokePlan({
		schemaVersion: value.schemaVersion,
		mode: value.mode,
		productId: value.productId,
		token: value.token,
	});
	if (expectedPlan && encodeDirectWavSmokePlan(plan) !== encodeDirectWavSmokePlan(expectedPlan)) {
		throw new TypeError('Direct WAV smoke result does not match its plan token');
	}
	const renderer = validateDirectWavRendererResult(value.renderer);
	assertClosedRecord(value.native, NATIVE_FIELDS, 'Direct WAV native result');
	if (!Array.isArray(value.native.selectionPurposes)
		|| value.native.selectionPurposes.length !== 4
		|| value.native.selectionPurposes.some((purpose) => purpose !== 'audio-pcm-mix')) {
		throw new TypeError('Direct WAV native result has invalid save selections');
	}
	if (value.native.completedBytes !== DIRECT_WAV_SMOKE_FILE_BYTES) {
		throw new TypeError('Direct WAV native result has an unexpected completed byte count');
	}
	if (value.native.completedAiffBytes !== DIRECT_AIFF_SMOKE_FILE_BYTES) {
		throw new TypeError('Direct AIFF native result has an unexpected completed byte count');
	}
	if (value.native.completedBwfBytes !== DIRECT_BWF_SMOKE_FILE_BYTES) {
		throw new TypeError('Direct BWF native result has an unexpected completed byte count');
	}
	if (value.native.aiffChoiceValidated !== true) throw new TypeError('Direct AIFF native result has an invalid save choice');
	if (value.native.bwfChoiceValidated !== true) throw new TypeError('Direct BWF native result has an invalid save choice');
	if (value.native.cancelledAbsent !== true) throw new TypeError('Direct WAV native result published its cancelled target');
	if (value.native.stagingFilesRemaining !== 0) throw new TypeError('Direct WAV native result retained staging files');
	return deepFreeze({
		...plan,
		renderer,
		native: {
			selectionPurposes: [...value.native.selectionPurposes],
			completedBytes: value.native.completedBytes,
			completedAiffBytes: value.native.completedAiffBytes,
			completedBwfBytes: value.native.completedBwfBytes,
			aiffChoiceValidated: true,
			bwfChoiceValidated: true,
			cancelledAbsent: true,
			stagingFilesRemaining: 0,
		},
	});
}

async function optionalStat(statImpl, path) {
	try {
		return await statImpl(path);
	} catch (error) {
		if (error?.code === 'ENOENT') return null;
		throw error;
	}
}

function validateAiffSaveChoice(choice) {
	assertClosedRecord(choice, ['filters', 'purpose', 'suggestedName'], 'Direct AIFF save choice');
	if (typeof choice.suggestedName !== 'string' || !choice.suggestedName.endsWith('.aiff')) {
		throw new TypeError('Direct AIFF smoke requires a canonical .aiff save choice');
	}
	validatePcmMixFilters(choice.filters, 'AIFF');
}

function validateBwfSaveChoice(choice) {
	assertClosedRecord(choice, ['filters', 'purpose', 'suggestedName'], 'Direct BWF save choice');
	if (typeof choice.suggestedName !== 'string' || !choice.suggestedName.endsWith('.wav')) {
		throw new TypeError('Direct BWF smoke requires a canonical .wav save choice');
	}
	validatePcmMixFilters(choice.filters, 'BWF');
}

function validatePcmMixFilters(filters, format) {
	const expectedFilters = [{ name: 'WAV and AIFF audio mix', extensions: ['wav', 'aif', 'aiff'] }];
	if (canonicalJson(filters) !== canonicalJson(expectedFilters)) {
		throw new TypeError(`Direct ${format} smoke requires the native PCM mix save filter`);
	}
}

function assertClosedRecord(value, fields, label) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${label} must be a plain object`);
	const ownKeys = Reflect.ownKeys(value);
	if (ownKeys.some((key) => typeof key !== 'string')) throw new TypeError(`${label} has unsupported fields`);
	const keys = ownKeys.sort();
	const expected = [...fields].sort();
	if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
		throw new TypeError(`${label} has unsupported fields`);
	}
}

function canonicalJson(value) {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
	if (value && typeof value === 'object') {
		return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
	}
	return JSON.stringify(value);
}

function deepFreeze(value) {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	for (const nested of Object.values(value)) deepFreeze(nested);
	return Object.freeze(value);
}

function requiredFunction(value, name) {
	if (typeof value !== 'function') throw new TypeError(`Direct WAV target harness requires ${name}`);
	return value;
}

function stringArguments(value) {
	if (!Array.isArray(value) || value.some((argument) => typeof argument !== 'string')) {
		throw new TypeError('Direct WAV target harness arguments must be strings');
	}
	return value;
}

function valuesForPrefix(argv, prefix) {
	return argv.filter((argument) => argument.startsWith(prefix)).map((argument) => argument.slice(prefix.length));
}
