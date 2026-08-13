/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { EditorControllerLifetime } from '../src/common/editor/controller/lifecycle.ts';
import { createScapeProjectFileService } from '../src/common/editor/controller/scape-project-file-service.ts';
import {
	createCurrentAudioEditorProject,
	loadCurrentAudioEditorProject,
	validateCurrentAudioEditorProject,
} from '../src/common/editor/project-current.ts';
import { request, transact } from '../src/common/editor/storage/indexeddb-backend.ts';
import { FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v18.ts';
import {
	createFramescaperSessionClipboardV18,
	prepareFramescaperMulticameraCrossProductCopyV18,
	prepareFramescaperNestedSequenceCrossProductCopyV18,
} from '../src/framescaper/editor-project-v18-interchange.ts';
import { FramescaperScapeProjectFileV18 } from '../src/framescaper/scape-project-file-v18.ts';
import {
	ARCHIVE_ORIGINAL_BYTES,
	ARCHIVE_ORIGINAL_SHA,
	ARCHIVE_PROJECT_ID,
	ARCHIVE_PROXY_BYTES,
	ARCHIVE_SOURCE_ID,
	ARCHIVE_TIMING,
	archiveCopy,
	archiveManifest,
	archiveProject,
	seedFramescaperV18ArchiveBodies,
	storedValue,
} from './helpers/framescaper-v18-archive-fixture.ts';
import {
	archiveClipboardDescriptor,
	multicameraArchiveProject,
	nestedArchiveProject,
	rawArchive,
	seedMulticameraArchiveOriginal,
	setupFramescaperScapeFileV18 as setup,
	trackingReaderFactory,
	videoFallbackProject,
	zipPayloads,
	zipProjectDocument,
} from './helpers/framescaper-v18-scape-file-test-support.ts';

const PROFILE = FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE;

test('V18 file authority authenticates its exact archive and store composition', async (context) => {
	const fixture = await setup(context);
	assert.throws(() => new FramescaperScapeProjectFileV18(PROFILE, {
		archive: fixture.archive,
		store: Object.create(fixture.storage.store) as unknown,
	}), /exact.*archive|archive.*composition|exact.*store/iu);
	assert.doesNotThrow(() => fixture.file);
});

test('V18 export writes complete format-1 and format-2 ZIPs that its inspector accepts', async (context) => {
	const fixture = await setup(context);
	await seedFramescaperV18ArchiveBodies(fixture.storage);

	const attached = await fixture.file.exportProject(archiveProject());
	assert.ok(attached.blob instanceof Blob);
	assert.equal(attached.manifest.formatVersion, 2);
	assert.deepEqual((attached.manifest.assets as ReadonlyArray<Record<string, unknown>>)
		.map(({ kind }) => kind), ['video', 'video-proxy', 'video-timing']);
	assert.deepEqual(await zipPayloads(attached.blob), new Map([
		['project.json', null],
		[`media/archive-video/original`, [...ARCHIVE_ORIGINAL_BYTES]],
		[`proxy/${String((attached.manifest.assets as readonly Record<string, unknown>[])[1]!.sha256)}/body`, [...ARCHIVE_PROXY_BYTES]],
		[`timing/${ARCHIVE_TIMING.reference.sha256}.scti`, [...ARCHIVE_TIMING.bytes]],
		['manifest.json', null],
	]));
	const inspection = await fixture.file.inspectScapeProject(
		attached.blob!, null, { signal: new AbortController().signal }, { retain() {} },
	);
	assert.deepEqual({
		id: inspection.id,
		schemaVersion: inspection.schemaVersion,
		readOnly: inspection.readOnly,
		exists: inspection.exists,
		formatVersion: inspection.manifest.formatVersion,
		compatible: inspection.featureRequirementsCompatibility?.compatible,
	}, {
		id: ARCHIVE_PROJECT_ID,
		schemaVersion: 18,
		readOnly: true,
		exists: false,
		formatVersion: 2,
		compatible: false,
	});

	const allNull = await fixture.file.exportProject(archiveProject({ attached: false }));
	assert.equal(allNull.manifest.formatVersion, 1);
	assert.deepEqual((allNull.manifest.assets as ReadonlyArray<Record<string, unknown>>)
		.map(({ kind }) => kind), ['video']);
	assert.equal((await fixture.file.inspectScapeProject(
		allNull.blob!, null, { signal: new AbortController().signal }, { retain() {} },
	)).readOnly, false);

	await assert.rejects(
		fixture.file.exportProject(videoFallbackProject('ff'.repeat(32))),
		/fallback.*(?:binding|digest)|descriptor.*fallback/iu,
	);
});

test('V18 import keeps the exact inspected envelope alive through canonical staging and atomic publication', async (context) => {
	const fixture = await setup(context);
	await seedFramescaperV18ArchiveBodies(fixture.storage);
	const exported = await fixture.file.exportProject(archiveProject());
	let archiveRequest: Record<string, unknown> | undefined;
	const archiveImport = fixture.archive.importProject.bind(fixture.archive);
	Object.defineProperty(fixture.archive, 'importProject', {
		value: async (request: Record<string, unknown>) => {
			archiveRequest = request;
			return archiveImport(request);
		},
	});

	const result = await fixture.file.importProject(exported.blob!, {
		decision: 'continue',
		operationId: 'file-import-create',
		publication: { mode: 'create' },
	});

	assert.equal(result.status, 'published');
	assert.equal(result.publicationOwner, 'framescaper-v18-archive');
	assert.equal(result.canonicalStage, 'staged');
	assert.ok(archiveRequest?.manifest);
	assert.deepEqual(archiveRequest?.project, archiveProject());
	assert.ok(Array.isArray(archiveRequest?.entries));
	assert.deepEqual(archiveRequest?.publication, { mode: 'create' });
	assert.deepEqual(
		await storedValue(fixture.storage.database, 'projects', ARCHIVE_PROJECT_ID),
		archiveProject(),
	);
});

test('V18 file import owns canonical body staging and roots it with format-2 publication', async (context) => {
	const fixture = await setup(context);
	await seedFramescaperV18ArchiveBodies(fixture.storage);
	const exported = await fixture.file.exportProject(archiveProject());
	const original = await storedValue(
		fixture.storage.database,
		'mediaAssets',
		'archive-video',
	) as Record<string, unknown>;
	await transact(fixture.storage.database, 'mediaAssets', 'readwrite', ({ mediaAssets }) => (
		request(mediaAssets.delete('archive-video'))
	));
	if (typeof original.path === 'string') fixture.storage.files.delete(original.path);
	fixture.storage.store.calls.metadata = 0;
	fixture.storage.store.calls.load = 0;
	fixture.storage.store.calls.begin = 0;

	const result = await fixture.file.importProject(exported.blob!, {
		decision: 'continue',
		operationId: 'file-owned-canonical-stage',
		publication: { mode: 'create' },
	});

	assert.equal(result.status, 'published');
	assert.equal(result.publicationOwner, 'framescaper-v18-archive');
	assert.equal(result.canonicalStage, 'staged');
	const storedOriginal = await storedValue(
		fixture.storage.database,
		'mediaAssets',
		'archive-video',
	) as Record<string, unknown>;
	assert.equal(storedOriginal.sha256, ARCHIVE_ORIGINAL_SHA);
	assert.equal(storedOriginal.size, ARCHIVE_ORIGINAL_BYTES.byteLength);
	assert.equal(Object.hasOwn(storedOriginal, 'pendingProjectUntil'), false);
	assert.equal(fixture.storage.store.calls.begin, 1);
});

test('V18 inspector plugs into the shared file service without surrendering product compatibility', async (context) => {
	const fixture = await setup(context);
	await seedFramescaperV18ArchiveBodies(fixture.storage);
	const exported = await fixture.file.exportProject(archiveProject());
	const service = createScapeProjectFileService({
		lifetime: new EditorControllerLifetime(),
		store: null,
		productCapabilities: {},
		inspectScapeProject: fixture.file.inspectScapeProject,
		openScape: () => { throw new Error('Inspection must not import the archive.'); },
	});
	const inspected = await service.inspectScape(exported.blob!, {
		projectFeatureCompatibility: {
			evaluate() { throw new Error('Caller compatibility must remain untrusted.'); },
		},
	});
	assert.equal(inspected.schemaVersion, 18);
	assert.equal(inspected.featureRequirementsCompatibility?.compatible, false);
});

test('format-1 import uses the same product-owned canonical stage and archive publication', async (context) => {
	const fixture = await setup(context);
	await seedFramescaperV18ArchiveBodies(fixture.storage, false);
	const project = archiveProject({ attached: false });
	const exported = await fixture.file.exportProject(project);
	const result = await fixture.file.importProject(exported.blob!, {
		decision: 'continue',
		operationId: 'file-format-1',
		publication: { mode: 'create' },
	});
	assert.deepEqual(result, {
		status: 'published',
		formatVersion: 1,
		project,
		publicationMode: 'create',
		publicationOwner: 'framescaper-v18-archive',
		canonicalStage: 'staged',
	});
});

test('nonempty subsequences survive complete format-1 and format-2 JSON, ZIP, and publication roundtrips', async (context) => {
	for (const attached of [false, true]) {
		const fixture = await setup(context);
		await seedFramescaperV18ArchiveBodies(fixture.storage, attached);
		const project = nestedArchiveProject({ attached });
		const exported = await fixture.file.exportProject(project);
		assert.ok(exported.blob);
		assert.equal(exported.manifest.formatVersion, attached ? 2 : 1);
		assert.deepEqual(await zipProjectDocument(exported.blob), project);
		assert.deepEqual((await fixture.file.inspectScapeProject(
			exported.blob, null, { signal: new AbortController().signal }, { retain() {} },
		)).project, project);

		const imported = await fixture.file.importProject(exported.blob, {
			decision: 'continue',
			operationId: `nested-${attached ? 'format-2' : 'format-1'}-create`,
			publication: { mode: 'create' },
		});
		assert.deepEqual(imported.project, project);
		assert.deepEqual(
			await storedValue(fixture.storage.database, 'projects', String(project.id)),
			project,
		);
	}
});

test('nonempty multicamera groups survive complete format-1 and format-2 JSON, ZIP, and publication roundtrips', async (context) => {
	for (const attached of [false, true]) {
		const fixture = await setup(context);
		await seedFramescaperV18ArchiveBodies(fixture.storage, attached);
		await seedMulticameraArchiveOriginal(fixture.storage);
		const project = multicameraArchiveProject({ attached });
		const exported = await fixture.file.exportProject(project);
		assert.ok(exported.blob);
		assert.equal(exported.manifest.formatVersion, attached ? 2 : 1);
		assert.deepEqual(await zipProjectDocument(exported.blob), project);
		const inspected = await fixture.file.inspectScapeProject(
			exported.blob, null, { signal: new AbortController().signal }, { retain() {} },
		);
		assert.deepEqual(inspected.project.multicameraGroups, project.multicameraGroups);

		const imported = await fixture.file.importProject(exported.blob, {
			decision: 'continue',
			operationId: `multicamera-${attached ? 'format-2' : 'format-1'}-create`,
			publication: { mode: 'create' },
		});
		assert.deepEqual(imported.project, project);
		assert.deepEqual(
			await storedValue(fixture.storage.database, 'projects', String(project.id)),
			project,
		);
	}
});

test('nested V18 cross-product transfer is explicit copy-only preservation and V17 never authors or activates it', async (context) => {
	const fixture = await setup(context);
	await seedFramescaperV18ArchiveBodies(fixture.storage, false);
	const project = nestedArchiveProject({ attached: false });
	const exported = await fixture.file.exportProject(project);
	assert.ok(exported.blob);
	const copy = archiveCopy(project, 'nested-copy-only-preservation');
	const imported = await fixture.file.importProject(exported.blob, {
		decision: 'continue',
		operationId: 'nested-copy-only-preservation',
		publication: { mode: 'copy', project: copy },
	});
	assert.equal(imported.publicationMode, 'copy');
	assert.deepEqual(imported.project.subsequences, project.subsequences);

	const transfer = prepareFramescaperNestedSequenceCrossProductCopyV18(PROFILE, project, {
		targetProduct: 'soundscaper',
		mode: 'copy-only-preservation',
	});
	assert.deepEqual(transfer, {
		kind: 'framescaper-nested-sequence-cross-product-copy',
		targetProduct: 'soundscaper',
		mode: 'copy-only-preservation',
		activation: 'forbidden',
		editable: false,
		project,
	});
	assert.notEqual(transfer.project, project);
	assert.equal(Object.isFrozen(transfer), true);
	assert.throws(() => prepareFramescaperNestedSequenceCrossProductCopyV18(PROFILE, project, {
		targetProduct: 'framescaper',
		mode: 'copy-only-preservation',
	} as never), /cross-product.*soundscaper/iu);

	const loadedByDefault = loadCurrentAudioEditorProject(transfer.project);
	assert.deepEqual(loadedByDefault, {
		project,
		readOnly: true,
		reason: 'newer-schema',
	});
	assert.throws(() => validateCurrentAudioEditorProject(transfer.project), /schema version|schemaVersion/iu);
	const authored = (createCurrentAudioEditorProject as (
		options: Readonly<Record<string, unknown>>,
	) => Record<string, unknown>)({
		id: 'soundscaper-default-v17',
		title: 'Default V17',
		now: '2026-08-13T12:00:00.000Z',
		subsequences: project.subsequences,
	});
	assert.equal(authored.schemaVersion, 17);
	assert.equal(Object.hasOwn(authored, 'subsequences'), false);
});

test('the V18 session clipboard refuses a nested graph before generic clipboard projection can drop it', () => {
	const project = nestedArchiveProject({ attached: false });
	let optionReads = 0;
	const options = new Proxy({}, {
		get() { optionReads += 1; throw new Error('clipboard option read'); },
	});
	assert.throws(
		() => createFramescaperSessionClipboardV18(PROFILE, project, options),
		/session clipboard.*cannot preserve.*nested.*\.scape/iu,
	);
	assert.equal(optionReads, 0);

	const flat = archiveProject({ attached: false });
	const clipboard = createFramescaperSessionClipboardV18(PROFILE, flat, {
		descriptor: archiveClipboardDescriptor(),
	});
	assert.equal(clipboard.originProjectId, flat.id);
	assert.deepEqual(clipboard.sources.map(({ id }) => id), [ARCHIVE_SOURCE_ID]);
});

test('multicamera interchange is copy-only for Soundscaper and refuses lossy session clipboard projection', () => {
	const project = multicameraArchiveProject({ attached: false });
	const transfer = prepareFramescaperMulticameraCrossProductCopyV18(PROFILE, project, {
		targetProduct: 'soundscaper',
		mode: 'copy-only-preservation',
	});
	assert.deepEqual(transfer, {
		kind: 'framescaper-multicamera-cross-product-copy',
		targetProduct: 'soundscaper',
		mode: 'copy-only-preservation',
		activation: 'forbidden',
		editable: false,
		project,
	});
	assert.notEqual(transfer.project, project);
	assert.equal(Object.isFrozen(transfer), true);
	assert.deepEqual(loadCurrentAudioEditorProject(transfer.project), {
		project,
		readOnly: true,
		reason: 'newer-schema',
	});
	assert.throws(() => validateCurrentAudioEditorProject(transfer.project), /schema version|schemaVersion/iu);

	let optionReads = 0;
	const options = new Proxy({}, {
		get() { optionReads += 1; throw new Error('clipboard option read'); },
	});
	assert.throws(
		() => createFramescaperSessionClipboardV18(PROFILE, project, options),
		/session clipboard.*cannot preserve.*multicamera.*\.scape/iu,
	);
	assert.equal(optionReads, 0);
});

test('cancel reads only metadata, skips storage and stage hooks, and closes its reader', async (context) => {
	const fixture = await setup(context);
	await seedFramescaperV18ArchiveBodies(fixture.storage);
	const exported = await fixture.file.exportProject(archiveProject());
	fixture.storage.store.calls.metadata = 0;
	fixture.storage.store.calls.load = 0;
	fixture.storage.store.calls.begin = 0;
	let closeCalls = 0;
	const bodyReads: string[] = [];
	const result = await fixture.file.importProject(exported.blob!, {
		decision: 'cancel',
		operationId: 'file-cancel',
		publication: { mode: 'create' },
		archiveReaderFactory: trackingReaderFactory(
			() => { closeCalls += 1; },
			(filename) => { bodyReads.push(filename); },
		),
	});
	assert.deepEqual(result, {
		status: 'cancelled',
		formatVersion: 2,
		project: archiveProject(),
		publicationMode: null,
		publicationOwner: null,
		canonicalStage: 'not-requested',
	});
	assert.equal(closeCalls, 1);
	assert.deepEqual(bodyReads, []);
	assert.deepEqual(fixture.storage.store.calls, { metadata: 0, load: 0, begin: 0 });
});

test('project digest rejection closes the strict reader before any canonical body read', async (context) => {
	const fixture = await setup(context);
	const project = archiveProject({ attached: false });
	const manifest = archiveManifest(project);
	manifest.formatVersion = 1;
	manifest.assets = (manifest.assets as unknown[]).slice(0, 1);
	manifest.project = {
		...(manifest.project as Record<string, unknown>),
		size: new TextEncoder().encode(JSON.stringify(project)).byteLength,
		sha256: '00'.repeat(32),
	};
	const input = await rawArchive(project, manifest);
	let closeCalls = 0;
	const bodyReads: string[] = [];
	await assert.rejects(fixture.file.inspectScapeProject(
		input,
		null,
		{
			signal: new AbortController().signal,
			archiveReaderFactory: trackingReaderFactory(
				() => { closeCalls += 1; },
				(filename) => { bodyReads.push(filename); },
			),
		},
		{ retain() {} },
	), /project document.*SHA-256|SHA-256.*project/iu);
	assert.equal(closeCalls, 1);
	assert.deepEqual(bodyReads, []);
});
