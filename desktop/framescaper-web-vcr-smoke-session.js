/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	FRAMESCAPER_WEB_VCR_SMOKE_CAPTURE_GESTURE_KEY,
	FRAMESCAPER_WEB_VCR_SMOKE_STAGE_KEY,
	runFramescaperWebVcrDormantRendererSmoke,
	runFramescaperWebVcrPackagedRendererSmoke,
	validateFramescaperWebVcrDormantSmokeResult,
	validateFramescaperWebVcrPackagedRendererSmokeResult,
	validateFramescaperWebVcrPackagedSmokeResult,
} from './framescaper-web-vcr-renderer-smoke.js';
import {
	FRAMESCAPER_WEB_VCR_DORMANT_SMOKE_MODE,
	FRAMESCAPER_WEB_VCR_DORMANT_SMOKE_PREFIX,
	FRAMESCAPER_WEB_VCR_PACKAGED_SMOKE_MODE,
	FRAMESCAPER_WEB_VCR_PACKAGED_SMOKE_PREFIX,
} from './framescaper-web-vcr-smoke-plan.js';

export function createFramescaperWebVcrSmokeSession(configuration) {
	const mode = configuration?.mode;
	const plan = configuration?.plan;
	if (![FRAMESCAPER_WEB_VCR_DORMANT_SMOKE_MODE,
		FRAMESCAPER_WEB_VCR_PACKAGED_SMOKE_MODE].includes(mode)
		|| !plan || plan.mode !== mode || plan.productId !== 'framescaper') {
		throw new TypeError('Framescaper Web VCR smoke session requires its exact plan.');
	}
	const dormant = mode === FRAMESCAPER_WEB_VCR_DORMANT_SMOKE_MODE;
	const runner = dormant
		? runFramescaperWebVcrDormantRendererSmoke
		: runFramescaperWebVcrPackagedRendererSmoke;
	const validate = dormant
		? validateFramescaperWebVcrDormantSmokeResult
		: validateFramescaperWebVcrPackagedRendererSmokeResult;
	const prefix = dormant
		? FRAMESCAPER_WEB_VCR_DORMANT_SMOKE_PREFIX
		: FRAMESCAPER_WEB_VCR_PACKAGED_SMOKE_PREFIX;
	let completed = false;
	let finished = false;
	const pendingDisplayWitnesses = [];
	const capturedDisplayWitnesses = [];
	let latestPermissionCheckWitness = null;
	let latestPermissionWitness = null;
	let latestDisplayWitness = null;
	return Object.freeze({
		prefix,
		observeDisplaySecurityWitness(value) {
			if (dormant || !completed || finished) return false;
			const witness = displaySecurityWitness(value);
			if (witness.stage === 'permission-check') latestPermissionCheckWitness = witness;
			else if (witness.stage === 'permission-request') latestPermissionWitness = witness;
			else {
				latestDisplayWitness = witness;
				pendingDisplayWitnesses.push(witness);
				if (pendingDisplayWitnesses.length > 2) pendingDisplayWitnesses.shift();
			}
			return true;
		},
		async run(webContents) {
			if (completed) throw new Error('Framescaper Web VCR smoke session already completed.');
			if (!webContents || typeof webContents.executeJavaScript !== 'function'
				|| typeof webContents.focus !== 'function') {
				throw new TypeError('Framescaper Web VCR smoke requires trusted web contents.');
			}
			completed = true;
			try {
				const execution = webContents.executeJavaScript(
					`(async () => {
						try {
							return { status: 'fulfilled', value: await (${runner.toString()})(globalThis, ${JSON.stringify(plan)}) };
						} catch (error) {
							const message = typeof error?.message === 'string' ? error.message : String(error);
							const stage = globalThis[${JSON.stringify(FRAMESCAPER_WEB_VCR_SMOKE_STAGE_KEY)}];
							return { status: 'rejected', message: message.slice(0, 2048), stage };
						}
					})()`,
					true,
				);
				if (!dormant) await driveCaptureGestures(webContents, execution, {
					pendingDisplayWitnesses, capturedDisplayWitnesses,
				});
				const envelope = await execution;
				if (envelope?.status === 'rejected') {
					const stage = typeof envelope.stage === 'string' ? ` at stage ${envelope.stage}` : '';
					throw new Error(`${String(envelope.message || 'Renderer smoke failed')}${stage}`);
				}
				if (envelope?.status !== 'fulfilled') {
					throw new TypeError('Framescaper Web VCR renderer smoke returned a malformed envelope.');
				}
				const renderer = validate(envelope.value, plan);
				if (dormant) return renderer;
				while (pendingDisplayWitnesses.length > 0 && capturedDisplayWitnesses.length < 2) {
					capturedDisplayWitnesses.push(pendingDisplayWitnesses.shift());
				}
				return validateFramescaperWebVcrPackagedSmokeResult({
					...renderer,
					displaySecurity: {
						requests: capturedDisplayWitnesses.map((witness, index) => ({
							...witness, resolution: index === 0 ? '720p' : '1080p',
						})),
					},
				}, plan);
			} catch (error) {
				throw smokeFailure(
					error, latestPermissionCheckWitness, latestPermissionWitness, latestDisplayWitness,
				);
			} finally {
				finished = true;
			}
		},
	});
}

async function driveCaptureGestures(webContents, execution, witnesses) {
	let settled = false;
	void execution.then(() => { settled = true; }, () => { settled = true; });
	for (const expected of ['720p-capture-user-gesture', '1080p-capture-user-gesture']) {
		const deadline = Date.now() + 20_000;
		let invoked = false;
		while (!settled && Date.now() < deadline) {
			const stage = await webContents.executeJavaScript(
				`globalThis[${JSON.stringify(FRAMESCAPER_WEB_VCR_SMOKE_STAGE_KEY)}] ?? null`,
			);
			if (stage === expected) {
				webContents.focus();
				const accepted = await webContents.executeJavaScript(`(() => {
					const invoke = globalThis[${JSON.stringify(FRAMESCAPER_WEB_VCR_SMOKE_CAPTURE_GESTURE_KEY)}];
					return typeof invoke === 'function' && invoke() === true;
				})()`, true);
				if (accepted !== true) throw new Error(`Web VCR smoke capture gesture ${expected} was not armed.`);
				await captureDisplayWitness(execution, settled, witnesses, expected);
				invoked = true;
				break;
			}
			await new Promise((resolve) => setTimeout(resolve, 25));
		}
		if (!settled && !invoked && Date.now() >= deadline) {
			throw new Error(`Web VCR smoke timed out arming ${expected}.`);
		}
	}
}

async function captureDisplayWitness(execution, settledAtInvocation, witnesses, expected) {
	const deadline = Date.now() + 5_000;
	while (witnesses.pendingDisplayWitnesses.length === 0
		&& !settledAtInvocation && Date.now() < deadline) {
		const outcome = await Promise.race([
			execution.then(() => 'settled', () => 'settled'),
			new Promise((resolve) => setTimeout(() => resolve('waiting'), 25)),
		]);
		if (outcome === 'settled') break;
	}
	const witness = witnesses.pendingDisplayWitnesses.shift();
	if (witness) witnesses.capturedDisplayWitnesses.push(witness);
	else if (!settledAtInvocation && Date.now() >= deadline) {
		throw new Error(`Web VCR smoke timed out observing display security for ${expected}.`);
	}
}

function displaySecurityWitness(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Web VCR display-security witness must be a closed record.');
	}
	const permission = [
		'version', 'stage', 'windowLive', 'focused', 'senderMatches', 'originMatches',
		'editorDocument', 'ownerAvailable', 'pending', 'systemPicker', 'allowed',
	];
	const display = [
		'version', 'stage', 'windowLive', 'focused', 'frameMatches', 'originMatches',
		'editorDocument', 'ownerAvailable', 'userGesture', 'videoRequested',
		'audioRequested', 'pending', 'systemPicker', 'outcome',
	];
	const fields = value.stage === 'permission-check' || value.stage === 'permission-request' ? permission
		: value.stage === 'display-request' ? display : null;
	if (!fields || Reflect.ownKeys(value).length !== fields.length
		|| Reflect.ownKeys(value).some((key) => typeof key !== 'string' || !fields.includes(key))
		|| value.version !== 1
		|| fields.filter((field) => !['version', 'stage', 'outcome'].includes(field))
			.some((field) => typeof value[field] !== 'boolean')
		|| (value.stage === 'display-request' && ![
			'rejected-trust', 'rejected-system-picker', 'rejected-web-vcr-grant',
			'rejected-device-grant', 'granted-web-vcr', 'granted-device',
		].includes(value.outcome))) {
		throw new TypeError('Web VCR display-security witness is invalid.');
	}
	return Object.freeze(Object.fromEntries(fields.map((field) => [field, value[field]])));
}

function smokeFailure(error, check, permission, display) {
	const message = error instanceof Error ? error.message : String(error);
	const diagnostic = check || permission || display
		? `; display security ${JSON.stringify({ check, permission, display })}` : '';
	return new Error(`${message}${diagnostic}`);
}
