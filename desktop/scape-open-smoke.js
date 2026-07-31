/* SPDX-License-Identifier: AGPL-3.0-only */

export const DESKTOP_SCAPE_OPEN_SMOKE_MODE = 'scape-range-open-v1';
export const DESKTOP_SCAPE_OPEN_SMOKE_PREFIX = 'SOUNDSCAPER_DESKTOP_SCAPE_OPEN_SMOKE';

const MAXIMUM_PLAN_BYTES = 16 * 1024;
const MAXIMUM_ARCHIVE_BYTES = 65 * 1024 ** 3;
const TOKEN = /^[a-f\d]{32}$/u;
const CAPABILITY_ID = /^[a-f\d]{64}$/u;
const PLAN_FIELDS = Object.freeze(['archive', 'mode', 'productId', 'project', 'schemaVersion', 'token']);
const ARCHIVE_FIELDS = Object.freeze(['byteLength', 'name']);
const PROJECT_FIELDS = Object.freeze(['clipId', 'id', 'revision', 'sourceId', 'title', 'trackId']);
const NATIVE_DESCRIPTOR_FIELDS = Object.freeze([
	'id', 'lastModified', 'mimeType', 'name', 'readProfile', 'size', 'url',
]);
const DESCRIPTOR_FIELDS = Object.freeze([
	'liveBeforeDelivery', 'mimeType', 'name', 'readProfile', 'retiredAfterOpen', 'size',
]);
const RENDERER_FIELDS = Object.freeze([
	'activeTabTitle', 'alertCount', 'clipCount', 'clipId', 'dialogCount', 'projectId',
	'statusState', 'trackCount', 'trackId',
]);
const RESULT_FIELDS = Object.freeze([...PLAN_FIELDS, 'descriptor', 'renderer']);
const SCAPE_PROFILE = 'scape-range-v1';
const SCAPE_MIME_TYPE = 'application/vnd.soundscaper.scape+zip';
const APP_ORIGIN = 'soundscaper-app://bundle';

export function validateScapeOpenSmokePlan(value) {
	assertClosedRecord(value, PLAN_FIELDS, 'Scape-open smoke plan');
	if (value.schemaVersion !== 1) throw new TypeError('Scape-open smoke plan has an unsupported schema');
	if (value.mode !== DESKTOP_SCAPE_OPEN_SMOKE_MODE) throw new TypeError('Scape-open smoke plan has an unsupported mode');
	if (value.productId !== 'soundscaper') throw new TypeError('Scape-open smoke plan is only valid for Soundscaper');
	if (typeof value.token !== 'string' || !TOKEN.test(value.token)) {
		throw new TypeError('Scape-open smoke plan token must be 32 lowercase hexadecimal characters');
	}
	assertClosedRecord(value.archive, ARCHIVE_FIELDS, 'Scape-open smoke archive');
	const archiveName = archiveFileName(value.archive.name);
	const archiveByteLength = safeInteger(value.archive.byteLength, 'Scape-open smoke archive byte length', {
		minimum: 1,
		maximum: MAXIMUM_ARCHIVE_BYTES,
	});
	assertClosedRecord(value.project, PROJECT_FIELDS, 'Scape-open smoke project');
	const project = {
		id: boundedText(value.project.id, 'Scape-open smoke project id', 4_096),
		title: boundedText(value.project.title, 'Scape-open smoke project title', 4_096),
		revision: safeInteger(value.project.revision, 'Scape-open smoke project revision'),
		sourceId: boundedText(value.project.sourceId, 'Scape-open smoke project source id', 4_096),
		trackId: boundedText(value.project.trackId, 'Scape-open smoke project track id', 4_096),
		clipId: boundedText(value.project.clipId, 'Scape-open smoke project clip id', 4_096),
	};
	return deepFreeze({
		schemaVersion: 1,
		mode: DESKTOP_SCAPE_OPEN_SMOKE_MODE,
		productId: 'soundscaper',
		token: value.token,
		archive: { name: archiveName, byteLength: archiveByteLength },
		project,
	});
}

export function encodeScapeOpenSmokePlan(value) {
	const json = canonicalJson(validateScapeOpenSmokePlan(value));
	const bytes = Buffer.from(json, 'utf8');
	if (bytes.byteLength > MAXIMUM_PLAN_BYTES) throw new RangeError('Scape-open smoke plan exceeds its byte limit');
	return bytes.toString('base64url');
}

export function decodeScapeOpenSmokePlan(value) {
	if (typeof value !== 'string' || !value || !/^[A-Za-z\d_-]+$/u.test(value)) {
		throw new TypeError('Scape-open smoke plan must be unpadded base64url');
	}
	if (Buffer.byteLength(value, 'utf8') > Math.ceil(MAXIMUM_PLAN_BYTES * 4 / 3)) {
		throw new RangeError('Scape-open smoke plan exceeds its byte limit');
	}
	const bytes = Buffer.from(value, 'base64url');
	if (bytes.toString('base64url') !== value) throw new TypeError('Scape-open smoke plan must use canonical base64url');
	if (bytes.byteLength > MAXIMUM_PLAN_BYTES) throw new RangeError('Scape-open smoke plan exceeds its byte limit');
	let json;
	try {
		json = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	} catch {
		throw new TypeError('Scape-open smoke plan must contain UTF-8 JSON');
	}
	let parsed;
	try {
		parsed = JSON.parse(json);
	} catch {
		throw new TypeError('Scape-open smoke plan must contain JSON');
	}
	const plan = validateScapeOpenSmokePlan(parsed);
	if (canonicalJson(plan) !== json) throw new TypeError('Scape-open smoke plan JSON must be canonical');
	return plan;
}

export function validateScapeOpenProjectDescriptor(value, expectedPlan) {
	const plan = validateScapeOpenSmokePlan(expectedPlan);
	assertClosedRecord(value, NATIVE_DESCRIPTOR_FIELDS, 'Scape-open project descriptor');
	if (typeof value.id !== 'string' || !CAPABILITY_ID.test(value.id)) {
		throw new TypeError('Scape-open project descriptor capability id is invalid');
	}
	if (value.readProfile !== SCAPE_PROFILE) throw new TypeError('Scape-open project descriptor profile is invalid');
	if (value.name !== plan.archive.name) throw new TypeError('Scape-open project descriptor name does not match the plan');
	if (value.size !== plan.archive.byteLength) throw new TypeError('Scape-open project descriptor size does not match the plan');
	if (value.mimeType !== SCAPE_MIME_TYPE) throw new TypeError('Scape-open project descriptor MIME type is invalid');
	safeInteger(value.lastModified, 'Scape-open project descriptor timestamp');
	const expectedUrl = `${APP_ORIGIN}/_desktop/read/${SCAPE_PROFILE}/${value.id}/${encodeURIComponent(value.name)}`;
	if (value.url !== expectedUrl) throw new TypeError('Scape-open project descriptor capability URL is invalid');
	return Object.freeze({
		readProfile: SCAPE_PROFILE,
		name: plan.archive.name,
		size: plan.archive.byteLength,
		mimeType: SCAPE_MIME_TYPE,
	});
}

export function validateScapeOpenRendererResult(value, expectedPlan) {
	const plan = validateScapeOpenSmokePlan(expectedPlan);
	assertClosedRecord(value, RENDERER_FIELDS, 'Scape-open renderer result');
	if (value.projectId !== plan.project.id) throw new TypeError('Scape-open renderer project identity is invalid');
	if (value.trackCount !== 1) throw new TypeError('Scape-open renderer must expose exactly one track');
	if (value.clipCount !== 1) throw new TypeError('Scape-open renderer must expose exactly one clip');
	if (value.activeTabTitle !== plan.project.title) throw new TypeError('Scape-open renderer active tab title is invalid');
	if (value.trackId !== plan.project.trackId) throw new TypeError('Scape-open renderer track identity is invalid');
	if (value.clipId !== plan.project.clipId) throw new TypeError('Scape-open renderer clip identity is invalid');
	if (value.statusState !== 'success') throw new TypeError('Scape-open renderer did not reach success status');
	if (value.alertCount !== 0) throw new TypeError('Scape-open renderer exposed an alert');
	if (value.dialogCount !== 0) throw new TypeError('Scape-open renderer exposed a dialog');
	return Object.freeze({
		projectId: plan.project.id,
		trackCount: 1,
		clipCount: 1,
		activeTabTitle: plan.project.title,
		trackId: plan.project.trackId,
		clipId: plan.project.clipId,
		statusState: 'success',
		alertCount: 0,
		dialogCount: 0,
	});
}

export function validateScapeOpenSmokeResult(value, expectedPlan = null) {
	assertClosedRecord(value, RESULT_FIELDS, 'Scape-open smoke result');
	const plan = validateScapeOpenSmokePlan({
		schemaVersion: value.schemaVersion,
		mode: value.mode,
		productId: value.productId,
		token: value.token,
		archive: value.archive,
		project: value.project,
	});
	if (expectedPlan && encodeScapeOpenSmokePlan(plan) !== encodeScapeOpenSmokePlan(expectedPlan)) {
		throw new TypeError('Scape-open smoke result does not match its plan');
	}
	assertClosedRecord(value.descriptor, DESCRIPTOR_FIELDS, 'Scape-open descriptor result');
	const expectedDescriptor = {
		readProfile: SCAPE_PROFILE,
		name: plan.archive.name,
		size: plan.archive.byteLength,
		mimeType: SCAPE_MIME_TYPE,
	};
	for (const [key, expected] of Object.entries(expectedDescriptor)) {
		if (value.descriptor[key] !== expected) throw new TypeError(`Scape-open descriptor result ${key} is invalid`);
	}
	if (value.descriptor.liveBeforeDelivery !== true) {
		throw new TypeError('Scape-open descriptor was not live before delivery');
	}
	if (value.descriptor.retiredAfterOpen !== true) {
		throw new TypeError('Scape-open descriptor was not retired after open');
	}
	const renderer = validateScapeOpenRendererResult(value.renderer, plan);
	return deepFreeze({
		...plan,
		descriptor: {
			...expectedDescriptor,
			liveBeforeDelivery: true,
			retiredAfterOpen: true,
		},
		renderer,
	});
}

export async function runScapeOpenRendererSmoke(scope, plan) {
	const document = scope?.document;
	if (!document || typeof document.querySelectorAll !== 'function'
		|| typeof scope?.setTimeout !== 'function') {
		throw new Error('Packaged Scape-open renderer environment is incomplete');
	}
	if (!plan || plan.schemaVersion !== 1 || plan.mode !== 'scape-range-open-v1'
		|| plan.productId !== 'soundscaper' || !/^[a-f\d]{32}$/u.test(plan.token)
		|| !plan.archive || !plan.project) {
		throw new TypeError('Packaged Scape-open plan is invalid');
	}
	const now = () => scope.Date?.now?.() ?? Date.now();
	const delay = (milliseconds) => new Promise((resolve) => scope.setTimeout(resolve, milliseconds));
	const deadline = now() + 45_000;
	while (true) {
		const alerts = document.querySelectorAll('[role="alert"], [role="alertdialog"]');
		const dialogs = document.querySelectorAll('[role="dialog"], [role="alertdialog"]');
		if (alerts.length || dialogs.length) {
			throw new Error('Packaged Scape-open UI exposed an alert or dialog');
		}
		const roots = document.querySelectorAll('[data-audio-editor][data-audio-editor-bound="true"]');
		if (roots.length === 1) {
			const root = roots[0];
			const escape = scope.CSS?.escape;
			if (typeof escape !== 'function') throw new Error('Packaged Scape-open selector escaping is unavailable');
			const trackSelector = `[data-track-row][data-track-id="${escape(plan.project.trackId)}"]`;
			const clipSelector = `[data-clip-id="${escape(plan.project.clipId)}"]`;
			const tabs = root.querySelectorAll('.kw-audio-editor__project-tabs [role="tab"][aria-selected="true"]');
			const tracks = root.querySelectorAll(trackSelector);
			const clips = tracks.length === 1 ? tracks[0].querySelectorAll(clipSelector) : [];
			const statuses = root.querySelectorAll('[data-editor-status][data-state="success"]');
			if (root.getAttribute('data-project-id') === plan.project.id
				&& root.getAttribute('data-track-count') === '1'
				&& root.getAttribute('data-clip-count') === '1'
				&& tabs.length === 1 && tabs[0].textContent.trim() === plan.project.title
				&& tracks.length === 1 && clips.length === 1
				&& statuses.length === 1 && statuses[0].textContent.trim()) {
				return {
					projectId: plan.project.id,
					trackCount: 1,
					clipCount: 1,
					activeTabTitle: plan.project.title,
					trackId: plan.project.trackId,
					clipId: plan.project.clipId,
					statusState: 'success',
					alertCount: 0,
					dialogCount: 0,
				};
			}
		}
		if (now() >= deadline) throw new Error('Packaged Scape-open smoke timed out waiting for project-open UI');
		await delay(25);
	}
}

function archiveFileName(value) {
	const name = boundedText(value, 'Scape-open smoke archive name', 255);
	if (/[\\/]/u.test(name) || !/\.scape$/iu.test(name)) {
		throw new TypeError('Scape-open smoke archive name must be one terminal .scape file name');
	}
	return name;
}

function boundedText(value, label, maximumLength) {
	if (typeof value !== 'string' || !value || value.trim() !== value
		|| value.length > maximumLength || [...value].some((character) => {
			const point = character.codePointAt(0);
			return point <= 0x1f || point === 0x7f;
		})) {
		throw new TypeError(`${label} is invalid`);
	}
	return value;
}

function safeInteger(value, label, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER } = {}) {
	if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
		throw new RangeError(`${label} is invalid`);
	}
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
