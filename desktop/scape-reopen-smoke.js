/* SPDX-License-Identifier: AGPL-3.0-only */

export const DESKTOP_SCAPE_REOPEN_SMOKE_MODE = 'scape-persistent-reopen-v1';
export const DESKTOP_SCAPE_REOPEN_SMOKE_PREFIX = 'SOUNDSCAPER_DESKTOP_SCAPE_REOPEN_SMOKE';
export const SOUNDSCAPER_SCAPE_REOPEN_PROJECT_SCHEMA_VERSION = 1;

const MAXIMUM_PLAN_BYTES = 16 * 1024;
const TOKEN = /^[a-f\d]{32}$/u;
const PLAN_FIELDS = Object.freeze(['mode', 'productId', 'project', 'schemaVersion', 'token']);
const PROJECT_FIELDS = Object.freeze(['clipId', 'id', 'revision', 'sourceId', 'title', 'trackId']);
const EXECUTION_FIELDS = Object.freeze(['playback', 'renderer', 'sharedProject']);
const SHARED_PROJECT_FIELDS = Object.freeze([
	'clipCount', 'revision', 'schemaFamily', 'schemaVersion', 'sourceCount', 'trackCount',
]);
const RENDERER_FIELDS = Object.freeze([
	'activeTabTitle', 'alertCount', 'clipCount', 'clipId', 'dialogCount', 'projectId',
	'statusState', 'trackCount', 'trackId', 'waveformError', 'waveformRenderer', 'waveformSource',
]);
const PLAYBACK_FIELDS = Object.freeze([
	'meterAboveFloor', 'playheadAdvanced', 'transportEntered', 'transportStopped',
]);
const RESULT_FIELDS = Object.freeze([...PLAN_FIELDS, ...EXECUTION_FIELDS]);
const CURRENT_PROJECT_SCHEMA_VERSION = SOUNDSCAPER_SCAPE_REOPEN_PROJECT_SCHEMA_VERSION;

export function validateScapeReopenSmokePlan(value) {
	assertClosedRecord(value, PLAN_FIELDS, 'Scape persisted-reopen smoke plan');
	if (value.schemaVersion !== 1) throw new TypeError('Scape persisted-reopen smoke plan has an unsupported schema');
	if (value.mode !== DESKTOP_SCAPE_REOPEN_SMOKE_MODE) {
		throw new TypeError('Scape persisted-reopen smoke plan has an unsupported mode');
	}
	if (value.productId !== 'soundscaper') {
		throw new TypeError('Scape persisted-reopen smoke plan is only valid for Soundscaper');
	}
	if (typeof value.token !== 'string' || !TOKEN.test(value.token)) {
		throw new TypeError('Scape persisted-reopen smoke plan token must be 32 lowercase hexadecimal characters');
	}
	assertClosedRecord(value.project, PROJECT_FIELDS, 'Scape persisted-reopen smoke project');
	const project = {
		id: boundedText(value.project.id, 'Scape persisted-reopen smoke project id'),
		title: boundedText(value.project.title, 'Scape persisted-reopen smoke project title'),
		revision: safeInteger(value.project.revision, 'Scape persisted-reopen smoke project revision'),
		sourceId: boundedText(value.project.sourceId, 'Scape persisted-reopen smoke project source id'),
		trackId: boundedText(value.project.trackId, 'Scape persisted-reopen smoke project track id'),
		clipId: boundedText(value.project.clipId, 'Scape persisted-reopen smoke project clip id'),
	};
	return deepFreeze({
		schemaVersion: 1,
		mode: DESKTOP_SCAPE_REOPEN_SMOKE_MODE,
		productId: 'soundscaper',
		token: value.token,
		project,
	});
}

export function encodeScapeReopenSmokePlan(value) {
	const json = canonicalJson(validateScapeReopenSmokePlan(value));
	const bytes = Buffer.from(json, 'utf8');
	if (bytes.byteLength > MAXIMUM_PLAN_BYTES) {
		throw new RangeError('Scape persisted-reopen smoke plan exceeds its byte limit');
	}
	return bytes.toString('base64url');
}

export function decodeScapeReopenSmokePlan(value) {
	if (typeof value !== 'string' || !value || !/^[A-Za-z\d_-]+$/u.test(value)) {
		throw new TypeError('Scape persisted-reopen smoke plan must be unpadded base64url');
	}
	if (Buffer.byteLength(value, 'utf8') > Math.ceil(MAXIMUM_PLAN_BYTES * 4 / 3)) {
		throw new RangeError('Scape persisted-reopen smoke plan exceeds its byte limit');
	}
	const bytes = Buffer.from(value, 'base64url');
	if (bytes.toString('base64url') !== value) {
		throw new TypeError('Scape persisted-reopen smoke plan must use canonical base64url');
	}
	if (bytes.byteLength > MAXIMUM_PLAN_BYTES) {
		throw new RangeError('Scape persisted-reopen smoke plan exceeds its byte limit');
	}
	let json;
	try {
		json = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	} catch {
		throw new TypeError('Scape persisted-reopen smoke plan must contain UTF-8 JSON');
	}
	let parsed;
	try {
		parsed = JSON.parse(json);
	} catch {
		throw new TypeError('Scape persisted-reopen smoke plan must contain JSON');
	}
	const plan = validateScapeReopenSmokePlan(parsed);
	if (canonicalJson(plan) !== json) {
		throw new TypeError('Scape persisted-reopen smoke plan JSON must be canonical');
	}
	return plan;
}

export function validateScapeReopenRendererResult(value, expectedPlan) {
	const plan = validateScapeReopenSmokePlan(expectedPlan);
	assertClosedRecord(value, EXECUTION_FIELDS, 'Scape persisted-reopen renderer execution');
	assertClosedRecord(value.sharedProject, SHARED_PROJECT_FIELDS, 'Scape persisted-reopen shared project result');
	if (value.sharedProject.schemaFamily !== 'soundscaper'
		|| value.sharedProject.schemaVersion !== CURRENT_PROJECT_SCHEMA_VERSION
		|| value.sharedProject.revision !== plan.project.revision
		|| value.sharedProject.sourceCount !== 1
		|| value.sharedProject.trackCount !== 1
		|| value.sharedProject.clipCount !== 1) {
		throw new TypeError('Scape persisted-reopen shared project result is invalid');
	}
	assertClosedRecord(value.renderer, RENDERER_FIELDS, 'Scape persisted-reopen renderer result');
	const renderer = value.renderer;
	if (renderer.projectId !== plan.project.id) {
		throw new TypeError('Scape persisted-reopen renderer project identity is invalid');
	}
	if (renderer.trackCount !== 1 || renderer.clipCount !== 1) {
		throw new TypeError('Scape persisted-reopen renderer must expose exactly one track and clip');
	}
	if (renderer.activeTabTitle !== plan.project.title) {
		throw new TypeError('Scape persisted-reopen renderer active tab title is invalid');
	}
	if (renderer.trackId !== plan.project.trackId || renderer.clipId !== plan.project.clipId) {
		throw new TypeError('Scape persisted-reopen renderer track or clip identity is invalid');
	}
	if (renderer.waveformRenderer !== 'audacity' || renderer.waveformSource !== 'pcm'
		|| renderer.waveformError !== false) {
		throw new TypeError('Scape persisted-reopen renderer PCM waveform evidence is invalid');
	}
	if (renderer.statusState !== 'success') {
		throw new TypeError('Scape persisted-reopen renderer did not reach success status');
	}
	if (renderer.alertCount !== 0 || renderer.dialogCount !== 0) {
		throw new TypeError('Scape persisted-reopen renderer exposed an alert or dialog');
	}
	assertClosedRecord(value.playback, PLAYBACK_FIELDS, 'Scape persisted-reopen playback result');
	for (const field of PLAYBACK_FIELDS) {
		if (value.playback[field] !== true) {
			throw new TypeError(`Scape persisted-reopen playback ${field} evidence is invalid`);
		}
	}
	return deepFreeze({
		sharedProject: {
			schemaFamily: 'soundscaper',
			schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
			revision: plan.project.revision,
			sourceCount: 1,
			trackCount: 1,
			clipCount: 1,
		},
		renderer: {
			projectId: plan.project.id,
			trackCount: 1,
			clipCount: 1,
			activeTabTitle: plan.project.title,
			trackId: plan.project.trackId,
			clipId: plan.project.clipId,
			waveformRenderer: 'audacity',
			waveformSource: 'pcm',
			waveformError: false,
			statusState: 'success',
			alertCount: 0,
			dialogCount: 0,
		},
		playback: {
			transportEntered: true,
			playheadAdvanced: true,
			meterAboveFloor: true,
			transportStopped: true,
		},
	});
}

export function validateScapeReopenSmokeResult(value, expectedPlan = null) {
	assertClosedRecord(value, RESULT_FIELDS, 'Scape persisted-reopen smoke result');
	const plan = validateScapeReopenSmokePlan({
		schemaVersion: value.schemaVersion,
		mode: value.mode,
		productId: value.productId,
		token: value.token,
		project: value.project,
	});
	if (expectedPlan && encodeScapeReopenSmokePlan(plan) !== encodeScapeReopenSmokePlan(expectedPlan)) {
		throw new TypeError('Scape persisted-reopen smoke result does not match its plan');
	}
	return deepFreeze({
		...plan,
		...validateScapeReopenRendererResult({
			sharedProject: value.sharedProject,
			renderer: value.renderer,
			playback: value.playback,
		}, plan),
	});
}



function boundedText(value, label) {
	if (typeof value !== 'string' || !value || value.trim() !== value
		|| value.length > 4_096 || [...value].some((character) => {
			const point = character.codePointAt(0);
			return point <= 0x1f || point === 0x7f;
		})) {
		throw new TypeError(`${label} is invalid`);
	}
	return value;
}

function safeInteger(value, label) {
	if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${label} is invalid`);
	return value;
}

function assertClosedRecord(value, keys, label) {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| Object.getPrototypeOf(value) !== Object.prototype
		|| JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
		throw new TypeError(`${label} has unsupported fields or is not a closed plain object`);
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
	for (const item of Object.values(value)) deepFreeze(item);
	return Object.freeze(value);
}
