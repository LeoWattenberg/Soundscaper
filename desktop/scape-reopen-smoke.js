/* SPDX-License-Identifier: AGPL-3.0-only */

export const DESKTOP_SCAPE_REOPEN_SMOKE_MODE = 'scape-persistent-reopen-v1';
export const DESKTOP_SCAPE_REOPEN_SMOKE_PREFIX = 'SOUNDSCAPER_DESKTOP_SCAPE_REOPEN_SMOKE';

const MAXIMUM_PLAN_BYTES = 16 * 1024;
const TOKEN = /^[a-f\d]{32}$/u;
const PLAN_FIELDS = Object.freeze(['mode', 'productId', 'project', 'schemaVersion', 'token']);
const PROJECT_FIELDS = Object.freeze(['clipId', 'id', 'revision', 'sourceId', 'title', 'trackId']);
const EXECUTION_FIELDS = Object.freeze(['renderer', 'sharedProject']);
const SHARED_PROJECT_FIELDS = Object.freeze([
	'clipCount', 'revision', 'schemaVersion', 'sourceCount', 'trackCount',
]);
const RENDERER_FIELDS = Object.freeze([
	'activeTabTitle', 'alertCount', 'clipCount', 'clipId', 'dialogCount', 'projectId',
	'statusState', 'trackCount', 'trackId', 'waveformError', 'waveformRenderer', 'waveformSource',
]);
const RESULT_FIELDS = Object.freeze([...PLAN_FIELDS, ...EXECUTION_FIELDS]);

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
	if (value.sharedProject.schemaVersion !== 9
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
	return deepFreeze({
		sharedProject: {
			schemaVersion: 9,
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
		}, plan),
	});
}

export async function runScapeReopenRendererSmoke(scope, plan) {
	const document = scope?.document;
	const api = scope?.scapeDesktop?.v1;
	if (!document || typeof document.querySelectorAll !== 'function'
		|| typeof scope?.setTimeout !== 'function'
		|| !api || typeof api.readSharedProject !== 'function') {
		throw new Error('Packaged Scape persisted-reopen renderer environment is incomplete');
	}
	const closed = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
		&& JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
	if (!closed(plan, ['mode', 'productId', 'project', 'schemaVersion', 'token'])
		|| plan.schemaVersion !== 1 || plan.mode !== 'scape-persistent-reopen-v1'
		|| plan.productId !== 'soundscaper' || !/^[a-f\d]{32}$/u.test(plan.token)
		|| !closed(plan.project, ['clipId', 'id', 'revision', 'sourceId', 'title', 'trackId'])) {
		throw new TypeError('Packaged Scape persisted-reopen plan is invalid');
	}
	const projectDocument = await api.readSharedProject(plan.project.id);
	if (typeof projectDocument !== 'string') {
		throw new Error('Persisted shared project is unavailable on descriptor-free reopen');
	}
	let project;
	try {
		project = JSON.parse(projectDocument);
	} catch {
		throw new Error('Persisted shared project is not canonical JSON');
	}
	if (JSON.stringify(project) !== projectDocument) {
		throw new Error('Persisted shared project is not canonical JSON');
	}
	if (!project || typeof project !== 'object' || Array.isArray(project)
		|| project.schemaVersion !== 9 || project.id !== plan.project.id
		|| project.title !== plan.project.title || project.revision !== plan.project.revision) {
		throw new Error('Persisted shared project identity does not match its descriptor');
	}
	if (!Array.isArray(project.sources) || project.sources.length !== 1) {
		throw new Error('Persisted shared project must expose exactly one source');
	}
	if (!Array.isArray(project.tracks) || project.tracks.length !== 1) {
		throw new Error('Persisted shared project must expose exactly one track');
	}
	if (!Array.isArray(project.clips) || project.clips.length !== 1) {
		throw new Error('Persisted shared project must expose exactly one clip');
	}
	const [source] = project.sources;
	const [track] = project.tracks;
	const [clip] = project.clips;
	if (!source || typeof source !== 'object' || Array.isArray(source)
		|| source.id !== plan.project.sourceId || source.kind !== 'audio') {
		throw new Error('Persisted shared project source identity is invalid');
	}
	if (!track || typeof track !== 'object' || Array.isArray(track)
		|| track.id !== plan.project.trackId || track.type !== 'audio'
		|| !Array.isArray(track.clipIds) || track.clipIds.length !== 1
		|| track.clipIds[0] !== plan.project.clipId) {
		throw new Error('Persisted shared project track does not own the expected clip');
	}
	if (!clip || typeof clip !== 'object' || Array.isArray(clip)
		|| clip.id !== plan.project.clipId || clip.kind !== 'audio'
		|| clip.sourceId !== plan.project.sourceId) {
		throw new Error('Persisted shared project clip does not reference the expected source');
	}

	const now = () => scope.Date?.now?.() ?? Date.now();
	const delay = (milliseconds) => new Promise((resolve) => scope.setTimeout(resolve, milliseconds));
	const deadline = now() + 45_000;
	let zoomInClicks = 0;
	while (true) {
		const alerts = document.querySelectorAll('[role="alert"], [role="alertdialog"]');
		const dialogs = document.querySelectorAll('[role="dialog"], [role="alertdialog"]');
		if (alerts.length || dialogs.length) {
			throw new Error('Packaged Scape persisted-reopen UI exposed an alert or dialog');
		}
		const roots = document.querySelectorAll('[data-audio-editor][data-audio-editor-bound="true"]');
		if (roots.length === 1) {
			const root = roots[0];
			const escape = scope.CSS?.escape;
			if (typeof escape !== 'function') {
				throw new Error('Packaged Scape persisted-reopen selector escaping is unavailable');
			}
			const trackSelector = `[data-track-row][data-track-id="${escape(plan.project.trackId)}"]`;
			const clipSelector = `[data-clip-id="${escape(plan.project.clipId)}"]`;
			const tabs = root.querySelectorAll('.kw-audio-editor__project-tabs [role="tab"][aria-selected="true"]');
			const tracks = root.querySelectorAll(trackSelector);
			const clips = tracks.length === 1 ? tracks[0].querySelectorAll(clipSelector) : [];
			const waveforms = clips.length === 1
				? clips[0].querySelectorAll('canvas.clip-body__waveform')
				: [];
			const statuses = root.querySelectorAll('[data-editor-status][data-state="success"]');
			const waveform = waveforms.length === 1 ? waveforms[0] : null;
			if (waveform?.getAttribute('data-waveform-error') !== null) {
				throw new Error('Packaged Scape persisted-reopen UI exposed a waveform error');
			}
			const identityReady = root.getAttribute('data-project-id') === plan.project.id
				&& root.getAttribute('data-track-count') === '1'
				&& root.getAttribute('data-clip-count') === '1'
				&& tabs.length === 1 && tabs[0].textContent.trim() === plan.project.title
				&& tracks.length === 1 && clips.length === 1 && waveforms.length === 1
				&& statuses.length === 1 && statuses[0].textContent.trim();
			if (identityReady && waveform.getAttribute('data-waveform-renderer') === 'audacity'
				&& waveform.getAttribute('data-waveform-source') === 'peaks') {
				const zoomButtons = root.querySelectorAll(
					'.kw-audio-editor__zoom-actions button[aria-label="Zoom in"]',
				);
				if (zoomButtons.length !== 1 || typeof zoomButtons[0].click !== 'function') {
					throw new Error('Packaged Scape persisted-reopen UI has no exact Zoom In control');
				}
				if (zoomInClicks >= 12) {
					throw new Error('Packaged Scape persisted-reopen waveform did not reach PCM rendering');
				}
				zoomButtons[0].click();
				zoomInClicks += 1;
			}
			if (identityReady
				&& waveform.getAttribute('data-waveform-renderer') === 'audacity'
				&& waveform.getAttribute('data-waveform-source') === 'pcm') {
				return {
					sharedProject: {
						schemaVersion: 9,
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
				};
			}
		}
		if (now() >= deadline) {
			throw new Error('Packaged Scape persisted-reopen smoke timed out waiting for persisted project UI');
		}
		await delay(25);
	}
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
