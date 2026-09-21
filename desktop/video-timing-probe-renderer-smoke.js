/* SPDX-License-Identifier: AGPL-3.0-only */
/* global __SCAPE_RENDERER_SMOKE_PRODUCT__:readonly */

export async function runDesktopVideoTimingProbeRendererSmoke(scope, plan, storageProfileValue) {
	const storageProfile = validateStorageProfile(storageProfileValue, plan?.productId);
	const editor = scope.document?.querySelector?.('[data-audio-editor]');
	if (!editor || editor.getAttribute('data-audio-editor-bound') !== 'true') {
		throw new Error('Desktop video timing-probe editor is not ready');
	}
	const decline = [...scope.document.querySelectorAll('button')]
		.find((button) => button.textContent?.trim() === 'Decline');
	decline?.click();
	const readyDeadline = Date.now() + 15_000;
	let importButton = null, fileMenuOpened = false;
	while (Date.now() < readyDeadline) {
		const ready = editor.querySelector('[data-status]')?.getAttribute('data-state') === 'success';
		importButton = scope.document.querySelector('[data-project-bin-import] button')
			?? [...scope.document.querySelectorAll('[role="menu"] [role="menuitem"]')]
				.find((item) => item.querySelector('.context-menu-item-label')?.textContent?.trim() === 'Import');
		if (ready && importButton && !importButton.disabled && importButton.getAttribute?.('aria-disabled') !== 'true') break;
		if (ready && !importButton && !fileMenuOpened) {
			const file = [...scope.document.querySelectorAll('[role="menubar"] [role="menuitem"]')]
				.find((item) => item.textContent?.trim() === 'File');
			file?.click();
			fileMenuOpened = Boolean(file);
		}
		await new Promise((resolve) => scope.setTimeout(resolve, 50));
	}
	if (!importButton || importButton.disabled || importButton.getAttribute?.('aria-disabled') === 'true'
		|| editor.querySelector('[data-status]')?.getAttribute('data-state') !== 'success') {
		throw new Error('Desktop video timing-probe ordinary Import control is unavailable');
	}
	const activeProjectId = scope.document.querySelector('[data-project-id]')?.getAttribute('data-project-id') ?? null;
	const publicationBefore = await publicationSnapshot(scope, plan.productId);
	importButton.click();
	const sourceNames = plan.fixtures.map(({ name }) => name);
	const deadline = Date.now() + 75_000;
	let fixtures = [];
	let terminalStatus = null;
	while (Date.now() < deadline) {
		fixtures = await persistedTimingEvidence(scope, sourceNames);
		if (fixtures.length === sourceNames.length) break;
		const status = editor.querySelector('[data-status]');
		if (status?.getAttribute('data-state') === 'error') {
			terminalStatus = status.textContent || 'unknown error';
			break;
		}
		await new Promise((resolve) => scope.setTimeout(resolve, 50));
	}
	if (fixtures.length !== sourceNames.length) {
		const status = terminalStatus || editor.querySelector('[data-status]')?.textContent || 'no status';
		const publicationAfter = await publicationSnapshot(scope, plan.productId);
		const diagnostic = publicationDiagnostic(
			activeProjectId, publicationBefore, publicationAfter, status,
		);
		const storage = await storageDiagnostic(scope, sourceNames);
		throw new Error(`Desktop video timing-probe import did not persist both timing bodies: ${status}; publication diagnostic ${JSON.stringify(diagnostic)}; storage diagnostic ${JSON.stringify(storage)}`);
	}
	return {
		schemaVersion: 1,
		mode: plan.mode,
		productId: plan.productId,
		token: plan.token,
		fixtures: plan.fixtures.map(({ id, name }) => {
			const fixture = fixtures.find((candidate) => candidate.name === name);
			if (!fixture) throw new Error(`Desktop video timing-probe evidence is missing ${id}`);
			return { id, ...fixture };
		}),
	};

	// Desktop documents live in the project library; timing bodies stay local.
	async function desktopLibraryProject(globalScope, names) {
		const library = desktopProjectLibraryBridge(globalScope, plan.productId);
		if (typeof library?.readProjectBundle !== 'function' || !activeProjectId) return null;
		try {
			const bundle = await library.readProjectBundle(activeProjectId);
			if (!bundle || typeof bundle.document !== 'string') return null;
			const document = JSON.parse(bundle.document);
			return names.every((name) => (
				document?.sources?.some((source) => source?.name === name)
			)) ? document : null;
		} catch {
			return null;
		}
	}

	// Bounded counts only: which stores the product actually wrote, so a probe
	// that finds nothing says whether the import missed the database, the
	// project, or just the timing bodies. No keys, paths or bytes cross this.
	async function storageDiagnostic(globalScope, names) {
		const request = (input) => new Promise((resolve, reject) => {
			input.onsuccess = () => resolve(input.result);
			input.onerror = () => reject(input.error);
		});
		try {
			const database = await request(globalScope.indexedDB.open(storageProfile.databaseName));
			try {
				const stores = [...database.objectStoreNames];
				if (!['projects', 'mediaAssets', 'mediaAssetChunks'].every((name) => stores.includes(name))) {
					return { stores };
				}
				const transaction = database.transaction(['projects', 'mediaAssets', 'mediaAssetChunks'], 'readonly');
				const [projects, mediaAssets, mediaChunks] = await Promise.all([
					request(transaction.objectStore('projects').getAll()),
					request(transaction.objectStore('mediaAssets').getAll()),
					request(transaction.objectStore('mediaAssetChunks').getAll()),
				]);
				const sources = projects.flatMap((project) => (
					Array.isArray(project?.sources) ? project.sources : []
				));
				return {
					stores,
					projects: projects.length,
					sources: sources.length,
					matchedSources: sources.filter((source) => names.includes(source?.name)).length,
					sourcesWithTimingAsset: sources.filter((source) => Boolean(source?.timingAsset)).length,
					mediaAssets: mediaAssets.length,
					mediaAssetChunks: mediaChunks.length,
				};
			} finally {
				database.close();
			}
		} catch (error) {
			const message = typeof error?.message === 'string' ? error.message : String(error);
			return { error: message.slice(0, 256) };
		}
	}

	async function persistedTimingEvidence(globalScope, names) {
		const request = (input) => new Promise((resolve, reject) => {
			input.onsuccess = () => resolve(input.result);
			input.onerror = () => reject(input.error);
		});
		const database = await request(globalScope.indexedDB.open(storageProfile.databaseName));
		try {
			const transaction = database.transaction(['projects', 'mediaAssets', 'mediaAssetChunks'], 'readonly');
			const [projects, mediaAssets, mediaChunks] = await Promise.all([
				request(transaction.objectStore('projects').getAll()),
				request(transaction.objectStore('mediaAssets').getAll()),
				request(transaction.objectStore('mediaAssetChunks').getAll()),
			]);
			const project = projects.find((candidate) => names.every((name) => (
				candidate.sources?.some((source) => source.name === name)
			))) ?? await desktopLibraryProject(globalScope, names);
			if (!project) return [];
			const evidence = [];
			for (const source of project.sources.filter(({ name }) => names.includes(name))) {
				const record = mediaAssets.find(({ sourceId }) => sourceId === source.timingAsset?.storageKey);
				if (!record) continue;
				const timingBytes = await readMediaAssetBytes(globalScope, record, mediaChunks);
				evidence.push({
					name: source.name,
					sourceSha256: source.contentSha256,
					frameRate: source.frameRate,
					sourceFrameCount: source.sourceFrameCount,
					timingDecision: source.timingDecision,
					timingAsset: {
						sha256: source.timingAsset.sha256,
						sourceSha256: source.timingAsset.sourceSha256,
						frameCount: source.timingAsset.frameCount,
						timescale: source.timingAsset.timescale,
						finalFrameDurationTicks: source.timingAsset.finalFrameDurationTicks,
						byteLength: source.timingAsset.byteLength,
					},
					timingBytes: [...timingBytes],
				});
			}
			return evidence;
		} finally {
			database.close();
		}
	}

	async function readMediaAssetBytes(globalScope, record, mediaChunks) {
		if (record.storage === 'opfs') {
			const root = await globalScope.navigator.storage.getDirectory();
			const directory = await root.getDirectoryHandle(storageProfile.opfsDirectoryName);
			const handle = await directory.getFileHandle(record.path);
			return new Uint8Array(await (await handle.getFile()).arrayBuffer());
		}
		if (record.blob instanceof globalScope.Blob) return new Uint8Array(await record.blob.arrayBuffer());
		const chunks = mediaChunks
			.filter(({ mediaChunkToken }) => mediaChunkToken === record.mediaChunkToken)
			.sort((left, right) => left.index - right.index);
		const bytes = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.payload.size, 0));
		let offset = 0;
		for (const chunk of chunks) {
			const payload = new Uint8Array(await chunk.payload.arrayBuffer());
			bytes.set(payload, offset);
			offset += payload.byteLength;
		}
		return bytes;
	}

	function desktopProjectLibraryBridge(globalScope, productId) {
		return (typeof __SCAPE_RENDERER_SMOKE_PRODUCT__ === 'undefined'
			? productId : __SCAPE_RENDERER_SMOKE_PRODUCT__) === 'soundscaper'
			? globalScope.soundscaperProjectLibraryDesktop?.v1
			: globalScope.framescaperDesktop?.v1?.projectLibrary;
	}

	async function publicationSnapshot(globalScope, productId) {
		const bridge = desktopProjectLibraryBridge(globalScope, productId);
		if (typeof bridge?.listProjects !== 'function') return null;
		try {
			const snapshot = await bridge.listProjects();
			return {
				metadataRevision: Number.isSafeInteger(snapshot?.metadataRevision)
					? snapshot.metadataRevision : null,
				projects: Array.isArray(snapshot?.projects) ? snapshot.projects.slice(0, 32).map((project) => ({
					id: typeof project?.id === 'string' ? project.id.slice(0, 256) : null,
					revision: Number.isSafeInteger(project?.revision) ? project.revision : null,
				})) : [],
			};
		} catch (error) {
			const message = typeof error?.message === 'string' ? error.message : String(error);
			return { error: message.slice(0, 512) };
		}
	}

	function publicationDiagnostic(projectId, before, after, status) {
		const prior = before?.projects?.find((project) => project.id === projectId) ?? null;
		const current = after?.projects?.find((project) => project.id === projectId) ?? null;
		const desktopLibraryVersion = 'v1';
		const normalizedStatus = status.toLowerCase();
		const witnessFailure = normalizedStatus.includes(
			`authoritative desktop ${desktopLibraryVersion} load witness`,
		);
		const stalePublication = normalizedStatus.includes(
			`desktop ${desktopLibraryVersion} publication is stale`,
		);
		let classification = 'publication-state-unavailable';
		if (before && after && !before.error && !after.error) {
			if (!prior) classification = 'initial-save-missing';
			else if (after.metadataRevision === before.metadataRevision
				&& current?.revision === prior.revision) {
				classification = stalePublication
					? 'revision-jump-refused-before-first-import-publication'
					: witnessFailure
						? 'witness-missing-before-first-import-publication'
						: 'no-import-publication-committed';
			} else if (after.metadataRevision === before.metadataRevision + 1
				&& current?.revision === prior.revision + 1) {
				classification = witnessFailure
					? 'witness-missing-after-one-import-publication'
					: 'one-import-publication-committed';
			} else classification = 'publication-revision-jump';
		}
		return { activeProjectId: projectId, classification, before, after };
	}

	function validateStorageProfile(value, productId) {
		const fields = ['databaseName', 'opfsDirectoryName', 'productId'];
		if (!value || typeof value !== 'object' || Array.isArray(value)
			|| Object.getPrototypeOf(value) !== Object.prototype
			|| Reflect.ownKeys(value).length !== fields.length) {
			throw new TypeError('Desktop video timing-probe storage profile must be a closed object');
		}
		const profile = {};
		for (const field of fields) {
			const descriptor = Object.getOwnPropertyDescriptor(value, field);
			if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
				throw new TypeError(`Desktop video timing-probe storage profile ${field} is invalid`);
			}
			profile[field] = descriptor.value;
		}
		const framescaper = productId === 'framescaper';
		if ((!framescaper && productId !== 'soundscaper') || profile.productId !== productId
			|| profile.databaseName !== (framescaper
				? 'kw-media-framescaper-editor-v1' : 'kw-media-soundscaper-editor-v1')
			|| profile.opfsDirectoryName !== (framescaper
				? 'framescaper-editor-v1-sources' : 'soundscaper-editor-v1-sources')) {
			throw new TypeError('Desktop video timing-probe storage profile does not match its product');
		}
		return Object.freeze(profile);
	}
}
