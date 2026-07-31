/* SPDX-License-Identifier: AGPL-3.0-only */

import { mkdir, readdir, stat } from 'node:fs/promises';
import { isAbsolute, join, normalize } from 'node:path';

export const DESKTOP_DIRECT_WAV_SMOKE_MODE = 'direct-wav-export-v1';
export const DESKTOP_DIRECT_WAV_SMOKE_PREFIX = 'SOUNDSCAPER_DESKTOP_DIRECT_WAV_SMOKE';
export const DIRECT_AIFF_SMOKE_FILE_BYTES = 202_751_798;
export const DIRECT_WAV_SMOKE_FILE_BYTES = 202_751_788;

const SMOKE_ARGUMENT = '--soundscaper-smoke';
const SMOKE_MODE_PREFIX = '--soundscaper-smoke-mode=';
const SMOKE_PLAN_PREFIX = '--soundscaper-smoke-plan=';
const SMOKE_APP_DATA_PREFIX = '--soundscaper-smoke-app-data=';
const MAXIMUM_PLAN_BYTES = 512;
const TOKEN = /^[a-f\d]{32}$/u;
const PRODUCT_IDS = new Set(['soundscaper', 'framescaper']);
const PLAN_FIELDS = Object.freeze(['schemaVersion', 'mode', 'productId', 'token']);
const RENDERER_FIELDS = Object.freeze(['imported', 'completed', 'cancelled', 'aiffCompleted', 'realtimeCount', 'downloadVisible']);
const NATIVE_FIELDS = Object.freeze([
	'selectionPurposes', 'completedBytes', 'completedAiffBytes', 'aiffChoiceValidated',
	'cancelledAbsent', 'stagingFilesRemaining',
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
			if (selectionPurposes.length >= 3) throw new Error('Direct WAV smoke requires exactly three save choices');
			await ensureRoot();
			const fileNames = ['completed.wav', 'cancelled.wav', 'completed.aiff'];
			if (selectionPurposes.length === 2) validateAiffSaveChoice(choice);
			const fileName = fileNames[selectionPurposes.length];
			selectionPurposes.push(choice.purpose);
			return join(smokeRoot, fileName);
		});
		operation = current.then(() => undefined, () => undefined);
		return current;
	};

	const evidence = async () => {
		await operation;
		if (selectionPurposes.length !== 3) throw new Error('Direct WAV smoke requires exactly three save choices');
		await ensureRoot();
		const deadline = now() + 15_000;
		while (true) {
			const completed = await optionalStat(statImpl, join(smokeRoot, 'completed.wav'));
			const completedAiff = await optionalStat(statImpl, join(smokeRoot, 'completed.aiff'));
			const cancelled = await optionalStat(statImpl, join(smokeRoot, 'cancelled.wav'));
			const names = await readdirImpl(smokeRoot);
			if (!Array.isArray(names) || names.some((name) => typeof name !== 'string')) {
				throw new TypeError('Direct WAV smoke root listing is invalid');
			}
			const stagingFilesRemaining = names.filter((name) => name.endsWith('.soundscaper-part')).length;
			if (completed?.isFile?.() && completedAiff?.isFile?.() && !cancelled && stagingFilesRemaining === 0) {
				if (!Number.isSafeInteger(completed.size) || completed.size < 0) {
					throw new TypeError('Direct WAV completed file size is invalid');
				}
				if (!Number.isSafeInteger(completedAiff.size) || completedAiff.size < 0) {
					throw new TypeError('Direct AIFF completed file size is invalid');
				}
				return deepFreeze({
					selectionPurposes: [...selectionPurposes],
					completedBytes: completed.size,
					completedAiffBytes: completedAiff.size,
					aiffChoiceValidated: true,
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
	if (value.realtimeCount !== 3) throw new TypeError('Direct WAV renderer must enter realtime export exactly three times');
	if (value.downloadVisible !== false) throw new TypeError('Direct WAV renderer exposed a browser download');
	return Object.freeze({
		imported: true,
		completed: true,
		cancelled: true,
		aiffCompleted: true,
		realtimeCount: 3,
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
		|| value.native.selectionPurposes.length !== 3
		|| value.native.selectionPurposes.some((purpose) => purpose !== 'audio-pcm-mix')) {
		throw new TypeError('Direct WAV native result has invalid save selections');
	}
	if (value.native.completedBytes !== DIRECT_WAV_SMOKE_FILE_BYTES) {
		throw new TypeError('Direct WAV native result has an unexpected completed byte count');
	}
	if (value.native.completedAiffBytes !== DIRECT_AIFF_SMOKE_FILE_BYTES) {
		throw new TypeError('Direct AIFF native result has an unexpected completed byte count');
	}
	if (value.native.aiffChoiceValidated !== true) throw new TypeError('Direct AIFF native result has an invalid save choice');
	if (value.native.cancelledAbsent !== true) throw new TypeError('Direct WAV native result published its cancelled target');
	if (value.native.stagingFilesRemaining !== 0) throw new TypeError('Direct WAV native result retained staging files');
	return deepFreeze({
		...plan,
		renderer,
		native: {
			selectionPurposes: [...value.native.selectionPurposes],
			completedBytes: value.native.completedBytes,
			completedAiffBytes: value.native.completedAiffBytes,
			aiffChoiceValidated: true,
			cancelledAbsent: true,
			stagingFilesRemaining: 0,
		},
	});
}

export async function runDirectWavRendererSmoke(scope, plan) {
	const document = scope?.document;
	const bridge = scope?.scapeDesktop?.v1;
	if (!document || !bridge
		|| typeof bridge.chooseSaveTarget !== 'function'
		|| typeof bridge.beginWrite !== 'function'
		|| typeof bridge.writeChunk !== 'function'
		|| typeof bridge.finishWrite !== 'function'
		|| typeof bridge.abortWrite !== 'function') {
		throw new Error('Packaged direct WAV bridge is incomplete');
	}
	if (!plan || plan.schemaVersion !== 1 || plan.mode !== 'direct-wav-export-v1'
		|| !['soundscaper', 'framescaper'].includes(plan.productId)
		|| !/^[a-f\d]{32}$/u.test(plan.token)) {
		throw new TypeError('Packaged direct WAV plan is invalid');
	}
	const delay = (milliseconds) => new Promise((resolve) => scope.setTimeout(resolve, milliseconds));
	const waitFor = async (read, label, timeout = 45_000) => {
		const deadline = Date.now() + timeout;
		while (true) {
			const value = read();
			if (value) return value;
			if (Date.now() >= deadline) throw new Error(`Packaged direct WAV smoke timed out waiting for ${label}`);
			await delay(25);
		}
	};
	const setValue = (control, value) => {
		let owner = Object.getPrototypeOf(control);
		let descriptor;
		while (owner && !descriptor) {
			descriptor = Object.getOwnPropertyDescriptor(owner, 'value');
			owner = Object.getPrototypeOf(owner);
		}
		if (descriptor?.set) descriptor.set.call(control, value);
		else control.value = value;
		control.dispatchEvent(new scope.Event('input', { bubbles: true }));
		control.dispatchEvent(new scope.Event('change', { bubbles: true }));
	};
	const choose = async (dialog, field, index, expectedText) => {
		const button = await waitFor(() => dialog.querySelector(`${field} button`), `${field} button`);
		button.click();
		const option = await waitFor(() => {
			const values = [...document.querySelectorAll('[role="option"]')]
				.filter((option) => option.getAttribute?.('aria-disabled') !== 'true');
			if (expectedText) {
				const matches = values.filter((candidate) => String(candidate.textContent || '').trim() === expectedText);
				if (matches.length > 1) throw new Error(`Packaged direct WAV ${field} option is ambiguous`);
				return matches[0] ?? null;
			}
			return values[index] ?? null;
		}, `${field} options`);
		option.click();
		await delay(25);
		if (expectedText) {
			await waitFor(
				() => String(button.textContent || '').trim() === expectedText ? button : null,
				`${field} selection`,
			);
		}
	};
	const createFixture = () => {
		const sampleRate = 48_000;
		const channelCount = 2;
		const frameCount = 792_000;
		const bytes = new Uint8Array(44 + frameCount * channelCount * 2);
		const view = new DataView(bytes.buffer);
		const text = (offset, value) => {
			for (let index = 0; index < value.length; index += 1) bytes[offset + index] = value.charCodeAt(index);
		};
		const dataBytes = bytes.byteLength - 44;
		text(0, 'RIFF');
		view.setUint32(4, 36 + dataBytes, true);
		text(8, 'WAVE');
		text(12, 'fmt ');
		view.setUint32(16, 16, true);
		view.setUint16(20, 1, true);
		view.setUint16(22, channelCount, true);
		view.setUint32(24, sampleRate, true);
		view.setUint32(28, sampleRate * channelCount * 2, true);
		view.setUint16(32, channelCount * 2, true);
		view.setUint16(34, 16, true);
		text(36, 'data');
		view.setUint32(40, dataBytes, true);
		for (let frame = 0; frame < frameCount; frame += 1) {
			const phase = 2 * Math.PI * 220 * frame / sampleRate;
			view.setInt16(44 + frame * 4, Math.round(Math.sin(phase) * 9_830), true);
			view.setInt16(46 + frame * 4, Math.round(Math.sin(phase + Math.PI / 3) * 9_830), true);
		}
		return new scope.File([bytes], `direct-wav-smoke-${plan.token}.wav`, { type: 'audio/wav' });
	};

	const editor = await waitFor(() => {
		const candidate = document.querySelector('[data-audio-editor]');
		return candidate?.getAttribute('data-audio-editor-bound') === 'true' ? candidate : null;
	}, 'bound editor');
	if (editor.getAttribute('data-product') !== plan.productId) throw new Error('Packaged direct WAV product does not match its plan');
	const projectBin = document.querySelector('[data-workspace-panel="project-bin"]');
	if (projectBin) {
		const closeProjectBin = projectBin.querySelector('.kw-audio-editor__workspace-panel-close');
		if (!closeProjectBin) throw new Error('Packaged direct WAV project bin close action is unavailable');
		closeProjectBin.click();
		await waitFor(() => !document.querySelector('[data-workspace-panel="project-bin"]'), 'project bin close');
	}
	const input = await waitFor(() => document.querySelector('[data-import-input]'), 'import input');
	const initialClips = Number(editor.getAttribute('data-clip-count') || 0);
	const transfer = new scope.DataTransfer();
	transfer.items.add(createFixture());
	input.files = transfer.files;
	input.dispatchEvent(new scope.Event('change', { bubbles: true }));
	await waitFor(() => {
		const status = document.querySelector('[data-status]');
		if (status?.getAttribute('data-state') === 'error') {
			const detail = String(status.textContent || '').replace(/\s+/gu, ' ').trim().slice(0, 512);
			throw new Error(`Packaged direct WAV fixture import failed${detail ? `: ${detail}` : ''}`);
		}
		return Number(editor.getAttribute('data-clip-count') || 0) > initialClips
			&& status?.getAttribute('data-state') === 'success';
	}, 'fixture import', 30_000);

	const exportButton = await waitFor(() => document.querySelector(
		'[data-action-bar] .kw-audio-editor__action-bar-center > button:last-of-type',
	), 'export action');
	exportButton.click();
	let dialog = await waitFor(() => document.querySelector('[data-export-dialog]'), 'export dialog');
	const footerButtons = [...dialog.querySelectorAll('.audio-editor-dialog-footer button')];
	if (footerButtons.length < 2) throw new Error('Packaged direct WAV export footer is incomplete');
	footerButtons[0].click();
	const metadata = await waitFor(() => document.querySelector('[data-export-metadata-dialog]'), 'metadata dialog');
	const metadataFields = [...metadata.querySelectorAll('.audio-editor-metadata-table input, .audio-editor-metadata-table textarea')];
	if (metadataFields.length !== 8) throw new Error('Packaged direct WAV metadata fields are incomplete');
	for (const field of metadataFields) setValue(field, '');
	const customMetadata = metadata.querySelector('.audio-editor-export-details textarea');
	if (!customMetadata) throw new Error('Packaged direct WAV custom metadata field is missing');
	setValue(customMetadata, '{}');
	await delay(25);
	const metadataButtons = [...metadata.querySelectorAll('.audio-editor-dialog-footer button')];
	if (metadataButtons.length !== 1) throw new Error('Packaged direct WAV metadata footer is incomplete');
	metadataButtons[0].click();
	dialog = await waitFor(() => document.querySelector('[data-export-dialog]'), 'restored export dialog');

	await choose(dialog, '[data-export-field="bitDepth"]', 0, '16-bit PCM');
	const sampleRate = await waitFor(() => dialog.querySelector('[data-export-field="sampleRate"] input'), 'sample rate');
	setValue(sampleRate, '384000');
	await delay(25);
	if (sampleRate.value !== '384000') throw new Error('Packaged direct WAV sample rate did not update');
	await choose(dialog, '[data-export-field="channelMapping"]', 3, 'Custom channel mapping');
	const matrix = await waitFor(() => dialog.querySelector('textarea'), 'custom channel matrix');
	setValue(matrix, JSON.stringify(Array.from({ length: 16 }, () => 0)));
	await delay(25);
	await choose(dialog, '[data-export-field="dither"]', 0, 'None');
	await delay(25);

	const OriginalAudioContext = scope.AudioContext || scope.webkitAudioContext;
	if (typeof OriginalAudioContext !== 'function') throw new Error('Packaged direct WAV AudioContext is unavailable');
	const originalDescriptor = Object.getOwnPropertyDescriptor(scope, 'AudioContext');
	let realtimeCount = 0;
	const TrackingAudioContext = new Proxy(OriginalAudioContext, {
		construct(target, argumentsList) {
			realtimeCount += 1;
			return Reflect.construct(target, argumentsList, target);
		},
		apply(target, thisValue, argumentsList) {
			realtimeCount += 1;
			return Reflect.apply(target, thisValue, argumentsList);
		},
	});
	Object.defineProperty(scope, 'AudioContext', { configurable: true, writable: true, value: TrackingAudioContext });
	let completed;
	let cancelled;
	let aiffCompleted;
	try {
		const firstStart = await waitFor(() => dialog.querySelector('[data-export-action="start"] button'), 'first export action');
		firstStart.click();
		await waitFor(() => dialog.querySelector('[data-export-action="cancel"] button'), 'first export start');
		await waitFor(() => realtimeCount === 1, 'first realtime render');
		await waitFor(() => {
			const output = dialog.querySelector('[data-export-progress] output');
			const value = Number.parseFloat(String(output?.textContent || ''));
			return Number.isFinite(value) && value > 0 ? value : null;
		}, 'first export progress', 60_000);
		await waitFor(() => dialog.querySelector('[data-export-action="start"] button'), 'completed export', 150_000);
		const completedStatus = document.querySelector('[data-status]');
		if (completedStatus?.getAttribute('data-state') !== 'success') {
			const detail = String(completedStatus?.textContent || '').replace(/\s+/gu, ' ').trim().slice(0, 512);
			throw new Error(`Packaged direct WAV export failed${detail ? `: ${detail}` : ''}`);
		}
		completed = true;

		const secondStart = dialog.querySelector('[data-export-action="start"] button');
		secondStart.click();
		await waitFor(() => dialog.querySelector('[data-export-action="cancel"] button'), 'second export start');
		await waitFor(() => realtimeCount === 2, 'second realtime render');
		await delay(5_000);
		const cancel = dialog.querySelector('[data-export-action="cancel"] button');
		if (!cancel) throw new Error('Packaged direct WAV second export completed before cancellation');
		cancel.click();
		await waitFor(() => dialog.querySelector('[data-export-action="start"] button'), 'cancelled export');
		cancelled = true;

		await choose(dialog, '[data-export-field="format"]', 3, 'AIFF');
		await choose(dialog, '[data-export-field="bitDepth"]', 0, '16-bit PCM');
		const aiffSampleRate = await waitFor(
			() => dialog.querySelector('[data-export-field="sampleRate"] input'),
			'AIFF sample rate',
		);
		if (aiffSampleRate.value !== '384000') throw new Error('Packaged direct AIFF sample rate did not persist');
		const aiffStart = dialog.querySelector('[data-export-action="start"] button');
		if (!aiffStart) throw new Error('Packaged direct AIFF export action is unavailable');
		aiffStart.click();
		await waitFor(() => dialog.querySelector('[data-export-action="cancel"] button'), 'AIFF export start');
		await waitFor(() => realtimeCount === 3, 'AIFF realtime render');
		await waitFor(() => dialog.querySelector('[data-export-action="start"] button'), 'completed AIFF export', 150_000);
		const aiffStatus = document.querySelector('[data-status]');
		if (aiffStatus?.getAttribute('data-state') !== 'success') {
			const detail = String(aiffStatus?.textContent || '').replace(/\s+/gu, ' ').trim().slice(0, 512);
			throw new Error(`Packaged direct AIFF export failed${detail ? `: ${detail}` : ''}`);
		}
		aiffCompleted = true;
	} finally {
		if (originalDescriptor) Object.defineProperty(scope, 'AudioContext', originalDescriptor);
		else delete scope.AudioContext;
	}
	const download = dialog.querySelector('[data-export-download]');
	const downloadVisible = Boolean(download && !download.hidden);
	return Object.freeze({ imported: true, completed, cancelled, aiffCompleted, realtimeCount, downloadVisible });
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
	const expectedFilters = [{ name: 'WAV and AIFF audio mix', extensions: ['wav', 'aif', 'aiff'] }];
	if (canonicalJson(choice.filters) !== canonicalJson(expectedFilters)) {
		throw new TypeError('Direct AIFF smoke requires the native PCM mix save filter');
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
