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
	'projectSchemaVersion', 'sha256', 'title',
]);
const UI_FIELDS = Object.freeze(['clipCount', 'projectId', 'title', 'trackCount']);
const HOST_FIELDS = Object.freeze(['activePublication', 'closed', 'fenced', 'product']);
const MAIN_FIELDS = Object.freeze(['host', 'project']);
const HANDSHAKE_FIELDS = Object.freeze([
	'attachedScapeFormatVersion', 'desktopDatabaseUserVersion', 'desktopLibrarySchemaVersion',
	'desktopLibraryScope', 'kind', 'owner', 'projectSchemaVersion', 'scapeFormatVersions',
	'storageDatabaseName', 'version',
]);
const DIGEST = /^[a-f0-9]{64}$/u;

/**
 * The library generation the packaged renderer must report. It is passed into
 * the injected smoke as data rather than written into it, because that function
 * is stringified into the renderer and cannot import the desktop contract it is
 * checking. `tests/desktop-framescaper-artifact-smoke-identity.test.js` pins
 * these values to that contract, so the next generation bump fails a unit test
 * instead of every packaged Framescaper smoke in the nightly.
 */
export const FRAMESCAPER_ARTIFACT_SMOKE_LIBRARY_IDENTITY = Object.freeze({
	projectSchemaVersion: 31,
	storageDatabaseName: 'kw-media-framescaper-editor-v31',
	desktopLibrarySchemaVersion: 20,
	desktopDatabaseUserVersion: 22,
	desktopLibraryScope: Object.freeze(['kw.media', 'scape-project-library', 'v20']),
});


/** Runs only after the selected renderer has activated its V27 controller and V27 store. */
export async function runFramescaperV27ArtifactRendererSmoke(scope, expected) {
	const fail = (message) => { throw new Error(`Framescaper V27 artifact smoke ${message}`); };
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
	], 'V18 preload bridge')).sort();
	if (preloadKeys.some((key) => typeof preload[key] !== 'function')) {
		fail('requires callable exact V18 preload bridge methods');
	}
	if (preload.handshakeState() !== 'admitted') fail('requires an admitted V18 preload handshake');
	const handshake = exactKeys(await preload.connect(), [
		'kind', 'version', 'owner', 'projectSchemaVersion', 'scapeFormatVersions',
		'attachedScapeFormatVersion', 'storageDatabaseName', 'desktopLibrarySchemaVersion',
		'desktopDatabaseUserVersion', 'desktopLibraryScope',
	], 'V18 handshake');
	if (preload.handshakeState() !== 'admitted'
		|| handshake.kind !== 'framescaper-project-library-handshake'
		|| handshake.version !== 1
		|| handshake.owner !== 'framescaper'
		|| handshake.projectSchemaVersion !== library.projectSchemaVersion
		|| JSON.stringify(handshake.scapeFormatVersions) !== '[1,2]'
		|| handshake.attachedScapeFormatVersion !== 2
		|| handshake.storageDatabaseName !== library.storageDatabaseName
		|| handshake.desktopLibrarySchemaVersion !== library.desktopLibrarySchemaVersion
		|| handshake.desktopDatabaseUserVersion !== library.desktopDatabaseUserVersion
		|| JSON.stringify(handshake.desktopLibraryScope)
			!== JSON.stringify(library.desktopLibraryScope)) {
		fail('received a drifted V18 handshake');
	}

	const bundle = exactKeys(await preload.readProjectBundle(projectId), [
		'metadataRevision', 'project', 'document', 'bodies',
	], 'V18 transfer bundle');
	const row = exactKeys(bundle.project, [
		'id', 'projectId', 'name', 'metadataFile', 'preferredProduct', 'updatedAtMs',
		'projectSchemaVersion', 'projectRevision', 'byteLength', 'sha256',
	], 'V18 project row');
	if (!Array.isArray(bundle.bodies) || bundle.bodies.length !== 0) {
		fail('requires a source-free V27 package fixture');
	}
	if (typeof bundle.document !== 'string' || bundle.document.length === 0) {
		fail('requires a V27 project document');
	}
	let document;
	try { document = JSON.parse(bundle.document); }
	catch { fail('requires a JSON V27 project document'); }
	if (JSON.stringify(document) !== bundle.document) fail('requires a canonical V27 project document');
	if (document?.schemaVersion !== library.projectSchemaVersion || document?.id !== projectId
		|| document?.title !== uiTitle || row.projectId !== projectId || row.name !== uiTitle
		|| row.preferredProduct !== 'framescaper'
		|| row.projectSchemaVersion !== library.projectSchemaVersion
		|| row.projectRevision !== document?.revision
		|| !Array.isArray(document?.tracks) || document.tracks.length !== trackCount
		|| !Array.isArray(document?.clips) || document.clips.length !== clipCount) {
		fail('UI and V27 bundle do not match');
	}
	if (!Number.isSafeInteger(bundle.metadataRevision) || bundle.metadataRevision < 1
		|| !Number.isSafeInteger(row.projectRevision) || row.projectRevision < 0
		|| !Number.isSafeInteger(row.byteLength) || row.byteLength < 1
		|| typeof row.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(row.sha256)) {
		fail('received an invalid V18 project descriptor');
	}
	const encoder = scope?.TextEncoder;
	if (typeof encoder !== 'function' || !scope?.crypto?.subtle) fail('requires Web Crypto');
	const documentBytes = new encoder().encode(bundle.document);
	const digestBytes = new Uint8Array(await scope.crypto.subtle.digest('SHA-256', documentBytes));
	const sha256 = [...digestBytes].map((value) => value.toString(16).padStart(2, '0')).join('');
	if (documentBytes.byteLength !== row.byteLength || sha256 !== row.sha256) {
		fail('V27 bundle bytes do not match the V18 descriptor');
	}
	return {
		url: scope.location?.href,
		title: scope.document?.title,
		bridge: Object.keys(bridge).sort(),
		environment,
		hasEditor: Boolean(scope.document?.querySelector?.('main')),
		nodeExposed: typeof scope.process !== 'undefined' || typeof scope.require !== 'undefined',
		saveOwnerReady,
		framescaperV27: {
			preloadBridge: preloadKeys,
			handshake,
			ui: { projectId, title: uiTitle, trackCount, clipCount },
			project: {
				projectId,
				title: uiTitle,
				projectSchemaVersion: library.projectSchemaVersion,
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

export function joinFramescaperV27ArtifactEvidence(rendererValue, mainValue) {
	const renderer = validateFramescaperV27ArtifactRendererEvidence(rendererValue);
	const main = validateFramescaperV27ArtifactMainEvidence(mainValue, renderer.project);
	return Object.freeze({ ...renderer, main });
}

export function validateFramescaperV27ArtifactEvidence(value) {
	const record = closedRecord(value, ARTIFACT_FIELDS, 'Framescaper V27 artifact evidence');
	return joinFramescaperV27ArtifactEvidence({
		handshake: record.handshake,
		preloadBridge: record.preloadBridge,
		project: record.project,
		ui: record.ui,
	}, record.main);
}

export function validateFramescaperV27ArtifactRendererEvidence(value) {
	const record = closedRecord(value, RENDERER_FIELDS, 'Framescaper V27 renderer evidence');
	const preloadBridge = exactStringArray(record.preloadBridge, PRELOAD_BRIDGE, 'Framescaper V18 preload bridge');
	const handshake = validateHandshake(record.handshake);
	const project = validateProject(record.project);
	const uiRecord = closedRecord(record.ui, UI_FIELDS, 'Framescaper V27 UI evidence');
	const ui = Object.freeze({
		projectId: text(uiRecord.projectId, 'Framescaper V27 UI project identity'),
		title: text(uiRecord.title, 'Framescaper V27 UI title'),
		trackCount: nonNegativeInteger(uiRecord.trackCount, 'Framescaper V27 UI track count'),
		clipCount: nonNegativeInteger(uiRecord.clipCount, 'Framescaper V27 UI clip count'),
	});
	if (ui.projectId !== project.projectId || ui.title !== project.title) {
		throw new Error('Framescaper V27 UI and renderer readback do not match');
	}
	return Object.freeze({ preloadBridge, handshake, ui, project });
}

export function validateFramescaperV27ArtifactMainEvidence(value, expectedProject) {
	const record = closedRecord(value, MAIN_FIELDS, 'Framescaper V27 main evidence');
	const hostRecord = closedRecord(record.host, HOST_FIELDS, 'Framescaper V27 main host evidence');
	if (hostRecord.product !== 'framescaper' || hostRecord.closed !== false
		|| hostRecord.fenced !== false || hostRecord.activePublication !== false) {
		throw new Error('Framescaper V27 main host was not active and quiescent');
	}
	const host = Object.freeze({
		product: 'framescaper', closed: false, fenced: false, activePublication: false,
	});
	const project = validateProject(record.project);
	const expected = validateProject(expectedProject);
	for (const field of PROJECT_FIELDS) {
		if (project[field] !== expected[field]) {
			throw new Error('Framescaper V27 renderer and main readback do not match');
		}
	}
	return Object.freeze({ host, project });
}

function validateProject(value) {
	const record = closedRecord(value, PROJECT_FIELDS, 'Framescaper V27 project evidence');
	const project = Object.freeze({
		projectId: text(record.projectId, 'Framescaper V27 project identity'),
		title: text(record.title, 'Framescaper V27 project title'),
		projectSchemaVersion: record.projectSchemaVersion,
		projectRevision: nonNegativeInteger(record.projectRevision, 'Framescaper V27 project revision'),
		metadataRevision: positiveInteger(record.metadataRevision, 'Framescaper V27 metadata revision'),
		byteLength: positiveInteger(record.byteLength, 'Framescaper V27 project byte length'),
		sha256: record.sha256,
		bodyCount: record.bodyCount,
	});
	if (project.projectSchemaVersion !== FRAMESCAPER_ARTIFACT_SMOKE_LIBRARY_IDENTITY.projectSchemaVersion
		|| typeof project.sha256 !== 'string'
		|| !DIGEST.test(project.sha256) || project.bodyCount !== 0) {
		throw new Error('Framescaper V27 project evidence is invalid');
	}
	return project;
}

function validateHandshake(value) {
	const record = closedRecord(value, HANDSHAKE_FIELDS, 'Framescaper V18 handshake evidence');
	if (record.kind !== 'framescaper-project-library-handshake' || record.version !== 1
		|| record.owner !== 'framescaper'
		|| record.projectSchemaVersion !== FRAMESCAPER_ARTIFACT_SMOKE_LIBRARY_IDENTITY.projectSchemaVersion
		|| record.attachedScapeFormatVersion !== 2
		|| record.storageDatabaseName !== FRAMESCAPER_ARTIFACT_SMOKE_LIBRARY_IDENTITY.storageDatabaseName
		|| record.desktopLibrarySchemaVersion !== FRAMESCAPER_ARTIFACT_SMOKE_LIBRARY_IDENTITY.desktopLibrarySchemaVersion
		|| record.desktopDatabaseUserVersion !== FRAMESCAPER_ARTIFACT_SMOKE_LIBRARY_IDENTITY.desktopDatabaseUserVersion) {
		throw new Error('Framescaper V18 handshake evidence is invalid');
	}
	return Object.freeze({
		kind: record.kind,
		version: record.version,
		owner: record.owner,
		projectSchemaVersion: record.projectSchemaVersion,
		scapeFormatVersions: exactNumberArray(
			record.scapeFormatVersions, [1, 2], 'Framescaper V18 Scape format versions',
		),
		attachedScapeFormatVersion: record.attachedScapeFormatVersion,
		storageDatabaseName: record.storageDatabaseName,
		desktopLibrarySchemaVersion: record.desktopLibrarySchemaVersion,
		desktopDatabaseUserVersion: record.desktopDatabaseUserVersion,
		desktopLibraryScope: exactStringArray(
			record.desktopLibraryScope,
			FRAMESCAPER_ARTIFACT_SMOKE_LIBRARY_IDENTITY.desktopLibraryScope,
			'Framescaper V18 library scope',
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
