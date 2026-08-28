/* SPDX-License-Identifier: AGPL-3.0-only */

const PRELOAD_BRIDGE = Object.freeze([
	'abortPublication',
	'beginPublication',
	'connect',
	'deleteProject',
	'duplicateProject',
	'finishPublication',
	'handshakeState',
	'listProjects',
	'readBodyChunk',
	'readProjectBundle',
	'writePublicationChunk',
]);
const RENDERER_FIELDS = Object.freeze(['handshake', 'preloadBridge', 'project', 'ui']);
const ARTIFACT_FIELDS = Object.freeze([...RENDERER_FIELDS, 'main']);
const PROJECT_FIELDS = Object.freeze([
	'bodyCount', 'byteLength', 'metadataRevision', 'projectId', 'projectRevision',
	'schemaFamily', 'schemaVersion', 'sha256', 'title',
]);
const UI_FIELDS = Object.freeze(['clipCount', 'projectId', 'title', 'trackCount']);
const HOST_FIELDS = Object.freeze(['activePublication', 'closed', 'fenced', 'product']);
const MAIN_FIELDS = Object.freeze(['host', 'project']);
const HANDSHAKE_FIELDS = Object.freeze([
	'attachedScapeFormatVersion', 'desktopDatabaseUserVersion', 'desktopLibrarySchemaVersion',
	'desktopLibraryScope', 'kind', 'owner', 'schemaFamily', 'schemaVersion', 'scapeFormatVersions',
	'storageDatabaseName', 'version',
]);
const DIGEST = /^[a-f0-9]{64}$/u;

/**
 * The frozen library identity the packaged renderer must report. It is passed into
 * the injected smoke as data rather than written into it, because that function
 * is stringified into the renderer and cannot import the desktop contract it is
 * checking. `tests/desktop-framescaper-artifact-smoke-identity.test.js` pins
 * these values to that contract, so any post-v1 identity change fails a unit test
 * instead of every packaged Framescaper smoke in the nightly.
 */
export const FRAMESCAPER_BASELINE_ARTIFACT_LIBRARY_IDENTITY = Object.freeze({
	schemaFamily: 'framescaper',
	schemaVersion: 1,
	storageDatabaseName: 'kw-media-framescaper-editor-v1',
	desktopLibrarySchemaVersion: 1,
	desktopDatabaseUserVersion: 1,
	desktopLibraryScope: Object.freeze(['kw.media', 'framescaper-project-library', 'v1']),
});


/** Runs only after the selected renderer has activated its baseline controller and baseline store. */
export async function runFramescaperBaselineArtifactRendererSmoke(scope, expected) {
	const fail = (message) => { throw new Error(`Framescaper baseline artifact smoke ${message}`); };
	const exactKeys = (value, keys, label) => {
		if (!value || typeof value !== 'object' || Array.isArray(value)
			|| JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
			fail(`requires the exact ${label}`);
		}
		return value;
	};
	if (!expected || typeof expected !== 'object'
		|| typeof expected.appName !== 'string' || typeof expected.appOrigin !== 'string'
		|| !expected.library || typeof expected.library !== 'object') {
		fail('requires an expected application identity');
	}
	const library = expected.library;
	if (scope?.location?.href !== `${expected.appOrigin}/`
		|| scope?.document?.title !== expected.appName) {
		fail('loaded an unexpected application identity');
	}
	const bridge = scope?.framescaperDesktop?.v1;
	if (!bridge || typeof bridge !== 'object') fail('requires the desktop v1 bridge');
	const environment = await bridge.getEnvironment?.();
	const saveOwnerReady = await bridge.beginWrite?.({
		targetId: '0'.repeat(48),
		size: 0,
	}).then(() => false, (error) => (
		/Save target expired or was already used/u.test(String(error?.message || error))
	));
	const editors = [...(scope?.document?.querySelectorAll?.(
		'[data-audio-editor][data-audio-editor-bound="true"]',
	) ?? [])];
	if (editors.length !== 1) fail('requires one activated editor UI');
	const editor = editors[0];
	if (editor?.dataset?.product !== 'framescaper') fail('requires the Framescaper editor UI');
	const projectId = editor.dataset.projectId;
	if (typeof projectId !== 'string' || projectId.length === 0) fail('requires an active UI project');
	const trackCount = count(editor.dataset.trackCount, 'UI track count');
	const clipCount = count(editor.dataset.clipCount, 'UI clip count');
	const activeTab = editor.querySelector?.(
		'.kw-audio-editor__project-tabs [role="tab"][aria-selected="true"]',
	);
	const uiTitle = activeTab?.textContent;
	if (typeof uiTitle !== 'string' || uiTitle.length === 0) fail('requires one active project tab');

	const preload = bridge.projectLibrary;
	const preloadKeys = Object.keys(exactKeys(preload, [
		'abortPublication', 'beginPublication', 'connect', 'deleteProject', 'duplicateProject',
		'finishPublication', 'handshakeState', 'listProjects', 'readBodyChunk', 'readProjectBundle',
		'writePublicationChunk',
	], 'baseline preload bridge')).sort();
	if (preloadKeys.some((key) => typeof preload[key] !== 'function')) {
		fail('requires callable exact baseline preload bridge methods');
	}
	if (preload.handshakeState() !== 'admitted') fail('requires an admitted baseline preload handshake');
	const handshake = exactKeys(await preload.connect(), [
		'kind', 'version', 'owner', 'schemaFamily', 'schemaVersion', 'scapeFormatVersions',
		'attachedScapeFormatVersion', 'storageDatabaseName', 'desktopLibrarySchemaVersion',
		'desktopDatabaseUserVersion', 'desktopLibraryScope',
	], 'baseline handshake');
	if (preload.handshakeState() !== 'admitted'
		|| handshake.kind !== 'framescaper-project-library-handshake'
		|| handshake.version !== 1
		|| handshake.owner !== 'framescaper'
		|| handshake.schemaFamily !== library.schemaFamily
		|| handshake.schemaVersion !== library.schemaVersion
		|| JSON.stringify(handshake.scapeFormatVersions) !== '[1]'
		|| handshake.attachedScapeFormatVersion !== 1
		|| handshake.storageDatabaseName !== library.storageDatabaseName
		|| handshake.desktopLibrarySchemaVersion !== library.desktopLibrarySchemaVersion
		|| handshake.desktopDatabaseUserVersion !== library.desktopDatabaseUserVersion
		|| JSON.stringify(handshake.desktopLibraryScope)
			!== JSON.stringify(library.desktopLibraryScope)) {
		fail('received a drifted baseline handshake');
	}

	const bundle = exactKeys(await preload.readProjectBundle(projectId), [
		'metadataRevision', 'project', 'document', 'bodies',
	], 'baseline transfer bundle');
	const row = exactKeys(bundle.project, [
		'id', 'projectId', 'name', 'metadataFile', 'preferredProduct', 'updatedAtMs',
		'schemaFamily', 'schemaVersion', 'projectRevision', 'byteLength', 'sha256',
	], 'baseline project row');
	if (!Array.isArray(bundle.bodies) || bundle.bodies.length !== 0) {
		fail('requires a source-free baseline package fixture');
	}
	if (typeof bundle.document !== 'string' || bundle.document.length === 0) {
		fail('requires a baseline project document');
	}
	let document;
	try { document = JSON.parse(bundle.document); }
	catch { fail('requires a JSON baseline project document'); }
	if (JSON.stringify(document) !== bundle.document) fail('requires a canonical baseline project document');
	if (document?.schemaFamily !== library.schemaFamily
		|| document?.schemaVersion !== library.schemaVersion || document?.id !== projectId
		|| document?.title !== uiTitle || row.projectId !== projectId || row.name !== uiTitle
		|| row.preferredProduct !== 'framescaper'
		|| row.schemaFamily !== library.schemaFamily
		|| row.schemaVersion !== library.schemaVersion
		|| row.projectRevision !== document?.revision
		|| !Array.isArray(document?.tracks) || document.tracks.length !== trackCount
		|| !Array.isArray(document?.clips) || document.clips.length !== clipCount) {
		fail('UI and baseline bundle do not match');
	}
	if (!Number.isSafeInteger(bundle.metadataRevision) || bundle.metadataRevision < 1
		|| !Number.isSafeInteger(row.projectRevision) || row.projectRevision < 0
		|| !Number.isSafeInteger(row.byteLength) || row.byteLength < 1
		|| typeof row.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(row.sha256)) {
		fail('received an invalid baseline project descriptor');
	}
	const encoder = scope?.TextEncoder;
	if (typeof encoder !== 'function' || !scope?.crypto?.subtle) fail('requires Web Crypto');
	const documentBytes = new encoder().encode(bundle.document);
	const digestBytes = new Uint8Array(await scope.crypto.subtle.digest('SHA-256', documentBytes));
	const sha256 = [...digestBytes].map((value) => value.toString(16).padStart(2, '0')).join('');
	if (documentBytes.byteLength !== row.byteLength || sha256 !== row.sha256) {
		fail('baseline bundle bytes do not match the baseline descriptor');
	}
	return {
		url: scope.location?.href,
		title: scope.document?.title,
		bridge: Object.keys(bridge).sort(),
		environment,
		hasEditor: Boolean(scope.document?.querySelector?.('main')),
		nodeExposed: typeof scope.process !== 'undefined' || typeof scope.require !== 'undefined',
		saveOwnerReady,
		framescaperBaseline: {
			preloadBridge: preloadKeys,
			handshake,
			ui: { projectId, title: uiTitle, trackCount, clipCount },
			project: {
				projectId,
				title: uiTitle,
				schemaFamily: library.schemaFamily,
				schemaVersion: library.schemaVersion,
				projectRevision: row.projectRevision,
				metadataRevision: bundle.metadataRevision,
				byteLength: row.byteLength,
				sha256: row.sha256,
				bodyCount: 0,
			},
		},
	};

	function count(value, label) {
		const result = Number(value);
		if (!Number.isSafeInteger(result) || result < 0 || String(result) !== value) fail(`has an invalid ${label}`);
		return result;
	}
}

export function joinFramescaperBaselineArtifactEvidence(rendererValue, mainValue) {
	const renderer = validateFramescaperBaselineArtifactRendererEvidence(rendererValue);
	const main = validateFramescaperBaselineArtifactMainEvidence(mainValue, renderer.project);
	return Object.freeze({ ...renderer, main });
}

export function validateFramescaperBaselineArtifactEvidence(value) {
	const record = closedRecord(value, ARTIFACT_FIELDS, 'Framescaper baseline artifact evidence');
	return joinFramescaperBaselineArtifactEvidence({
		handshake: record.handshake,
		preloadBridge: record.preloadBridge,
		project: record.project,
		ui: record.ui,
	}, record.main);
}

export function validateFramescaperBaselineArtifactRendererEvidence(value) {
	const record = closedRecord(value, RENDERER_FIELDS, 'Framescaper baseline renderer evidence');
	const preloadBridge = exactStringArray(record.preloadBridge, PRELOAD_BRIDGE, 'Framescaper baseline preload bridge');
	const handshake = validateHandshake(record.handshake);
	const project = validateProject(record.project);
	const uiRecord = closedRecord(record.ui, UI_FIELDS, 'Framescaper baseline UI evidence');
	const ui = Object.freeze({
		projectId: text(uiRecord.projectId, 'Framescaper baseline UI project identity'),
		title: text(uiRecord.title, 'Framescaper baseline UI title'),
		trackCount: nonNegativeInteger(uiRecord.trackCount, 'Framescaper baseline UI track count'),
		clipCount: nonNegativeInteger(uiRecord.clipCount, 'Framescaper baseline UI clip count'),
	});
	if (ui.projectId !== project.projectId || ui.title !== project.title) {
		throw new Error('Framescaper baseline UI and renderer readback do not match');
	}
	return Object.freeze({ preloadBridge, handshake, ui, project });
}

export function validateFramescaperBaselineArtifactMainEvidence(value, expectedProject) {
	const record = closedRecord(value, MAIN_FIELDS, 'Framescaper baseline main evidence');
	const hostRecord = closedRecord(record.host, HOST_FIELDS, 'Framescaper baseline main host evidence');
	if (hostRecord.product !== 'framescaper' || hostRecord.closed !== false
		|| hostRecord.fenced !== false || hostRecord.activePublication !== false) {
		throw new Error('Framescaper baseline main host was not active and quiescent');
	}
	const host = Object.freeze({
		product: 'framescaper', closed: false, fenced: false, activePublication: false,
	});
	const project = validateProject(record.project);
	const expected = validateProject(expectedProject);
	for (const field of PROJECT_FIELDS) {
		if (project[field] !== expected[field]) {
			throw new Error('Framescaper baseline renderer and main readback do not match');
		}
	}
	return Object.freeze({ host, project });
}

function validateProject(value) {
	const record = closedRecord(value, PROJECT_FIELDS, 'Framescaper baseline project evidence');
	const project = Object.freeze({
		projectId: text(record.projectId, 'Framescaper baseline project identity'),
		title: text(record.title, 'Framescaper baseline project title'),
		schemaFamily: record.schemaFamily,
		schemaVersion: record.schemaVersion,
		projectRevision: nonNegativeInteger(record.projectRevision, 'Framescaper baseline project revision'),
		metadataRevision: positiveInteger(record.metadataRevision, 'Framescaper baseline metadata revision'),
		byteLength: positiveInteger(record.byteLength, 'Framescaper baseline project byte length'),
		sha256: record.sha256,
		bodyCount: record.bodyCount,
	});
	if (project.schemaFamily !== FRAMESCAPER_BASELINE_ARTIFACT_LIBRARY_IDENTITY.schemaFamily
		|| project.schemaVersion !== FRAMESCAPER_BASELINE_ARTIFACT_LIBRARY_IDENTITY.schemaVersion
		|| typeof project.sha256 !== 'string'
		|| !DIGEST.test(project.sha256) || project.bodyCount !== 0) {
		throw new Error('Framescaper baseline project evidence is invalid');
	}
	return project;
}

function validateHandshake(value) {
	const record = closedRecord(value, HANDSHAKE_FIELDS, 'Framescaper baseline handshake evidence');
	if (record.kind !== 'framescaper-project-library-handshake' || record.version !== 1
		|| record.owner !== 'framescaper'
		|| record.schemaFamily !== FRAMESCAPER_BASELINE_ARTIFACT_LIBRARY_IDENTITY.schemaFamily
		|| record.schemaVersion !== FRAMESCAPER_BASELINE_ARTIFACT_LIBRARY_IDENTITY.schemaVersion
		|| record.attachedScapeFormatVersion !== 1
		|| record.storageDatabaseName !== FRAMESCAPER_BASELINE_ARTIFACT_LIBRARY_IDENTITY.storageDatabaseName
		|| record.desktopLibrarySchemaVersion !== FRAMESCAPER_BASELINE_ARTIFACT_LIBRARY_IDENTITY.desktopLibrarySchemaVersion
		|| record.desktopDatabaseUserVersion !== FRAMESCAPER_BASELINE_ARTIFACT_LIBRARY_IDENTITY.desktopDatabaseUserVersion) {
		throw new Error('Framescaper baseline handshake evidence is invalid');
	}
	return Object.freeze({
		kind: record.kind,
		version: record.version,
		owner: record.owner,
		schemaFamily: record.schemaFamily,
		schemaVersion: record.schemaVersion,
		scapeFormatVersions: exactNumberArray(
			record.scapeFormatVersions, [1], 'Framescaper baseline Scape format versions',
		),
		attachedScapeFormatVersion: record.attachedScapeFormatVersion,
		storageDatabaseName: record.storageDatabaseName,
		desktopLibrarySchemaVersion: record.desktopLibrarySchemaVersion,
		desktopDatabaseUserVersion: record.desktopDatabaseUserVersion,
		desktopLibraryScope: exactStringArray(
			record.desktopLibraryScope,
			FRAMESCAPER_BASELINE_ARTIFACT_LIBRARY_IDENTITY.desktopLibraryScope,
			'Framescaper baseline library scope',
		),
	});
}

function closedRecord(value, fields, label) {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`${label} must be a plain record`);
	}
	const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.length
		|| keys.some((key) => typeof key !== 'string' || !fields.includes(key))) {
		throw new TypeError(`${label} has missing or unsupported fields`);
	}
	const result = Object.create(null);
	for (const field of fields) {
		const descriptor = Object.getOwnPropertyDescriptor(value, field);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${label}.${field} must be an own enumerable data property`);
		}
		result[field] = descriptor.value;
	}
	return result;
}

function exactStringArray(value, expected, label) {
	if (!Array.isArray(value) || JSON.stringify(value) !== JSON.stringify(expected)) {
		throw new Error(`${label} does not match the reviewed contract`);
	}
	return Object.freeze([...expected]);
}

function exactNumberArray(value, expected, label) {
	if (!Array.isArray(value) || JSON.stringify(value) !== JSON.stringify(expected)) {
		throw new Error(`${label} does not match the reviewed contract`);
	}
	return Object.freeze([...expected]);
}

function text(value, label) {
	if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${label} is invalid`);
	return value;
}

function nonNegativeInteger(value, label) {
	if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${label} is invalid`);
	return value;
}

function positiveInteger(value, label) {
	if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${label} is invalid`);
	return value;
}
