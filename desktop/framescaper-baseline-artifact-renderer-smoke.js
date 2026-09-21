/* SPDX-License-Identifier: AGPL-3.0-only */

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
