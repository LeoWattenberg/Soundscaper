/* SPDX-License-Identifier: AGPL-3.0-only */

import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';

import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
	compileDesktopProjectLibraryRuntime,
	DESKTOP_RUNTIME_PACKAGE_IMPORTS,
	stageDesktopApplicationSources,
} from '../scripts/lib/desktop-project-library-runtime.mjs';
import { serializeScapeProjectDocument } from '../src/common/editor/scape-project-document.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('desktop runtime compilation emits importable JavaScript with rewritten extensions', async (context) => {
	const temporaryRoot = await mkdtemp(join(tmpdir(), 'scape-desktop-runtime-'));
	context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
	const outputRoot = join(temporaryRoot, 'runtime');
	const result = await compileDesktopProjectLibraryRuntime({ repositoryRoot: ROOT, outputRoot });
	assert.deepEqual(result.files, [
		'desktop/application-lifecycle.js',
		'desktop/assistance-main-ipc.js',
		'desktop/assistance-service.js',
		'desktop/assistance-sherpa-recognizer.js',
		'desktop/assistance-speech-runtime.js',
		'desktop/helper-contract.js',
		'desktop/helper-job-grant.js',
		'desktop/helper-probe-service.js',
		'desktop/helper-supervisor.js',
		'desktop/native-addon-payload.js',
		'desktop/plugin-scan-service.js',
		'desktop/plugin-scan-results.js',
		'desktop/plugin-registry.js',
		'desktop/plugin-quarantine.js',
		'desktop/plugin-consent.js',
		'desktop/native-helper-results.js',
		'desktop/native-helper-service.js',
		'desktop/helper-wire-admission.js',
		'desktop/linked-original-locator-validation.js',
		'desktop/linked-video-locator-registry.js',
		'desktop/linked-video-locator-store.js',
		'desktop/local-model-catalog.js',
		'desktop/local-model-download.js',
		'desktop/local-model-store.js',
		'desktop/main-window-recovery.js',
		'desktop/native-services-database.js',
		'desktop/project-library-abort.js',
		'desktop/project-library-api.js',
		'desktop/project-library-contract.js',
		'desktop/project-library-current-project.js',
		'desktop/project-library-database.js',
		'desktop/project-library-editor-managed-source.js',
		'desktop/project-library-editor-media-service.js',
		'desktop/project-library-editor-service.js',
		'desktop/project-library-file-inventory.js',
		'desktop/project-library-host.js',
		'desktop/project-library-media-binding.js',
		'desktop/project-library-media-body.js',
		'desktop/project-library-media-capacity.js',
		'desktop/project-library-media-inventory-reclamation.js',
		'desktop/project-library-media-inventory-schema.js',
		'desktop/project-library-media-inventory-store.js',
		'desktop/project-library-media-inventory.js',
		'desktop/project-library-media-reclamation.js',
		'desktop/project-library-media-reuse.js',
		'desktop/project-library-media.js',
		'desktop/project-library-persistence.js',
		'desktop/project-library-projects.js',
		'desktop/project-library-reclamation.js',
		'desktop/project-library-sequential-upload.js',
		'desktop/project-library-stage-inventory.js',
		'desktop/project-library-v10-catalog.js',
		'desktop/project-library-v10-contract.js',
		'desktop/project-library-v10-current-project.js',
		'desktop/project-library-v10-database.js',
		'desktop/project-library-v10-handshake-gate.js',
		'desktop/project-library-v10-ipc.js',
		'desktop/project-library-v10-lease-wait.js',
		'desktop/project-library-v10-lifecycle-contract.js',
		'desktop/project-library-v10-lifecycle-host.js',
		'desktop/project-library-v10-main-channels.js',
		'desktop/project-library-v10-main-ipc.js',
		'desktop/project-library-v10-main-session.js',
		'desktop/project-library-v10-main.js',
		'desktop/project-library-v10-media-binding.js',
		'desktop/project-library-v10-metadata.js',
		'desktop/project-library-v10-persistence-codecs.js',
		'desktop/project-library-v10-publication-contract.js',
		'desktop/project-library-v10-publication-files.js',
		'desktop/project-library-v10-publication-host.js',
		'desktop/project-library-v10-publication-persistence.js',
		'desktop/project-library-v10-publication-transport.js',
		'desktop/project-library-v10-transfer-contract.js',
		'desktop/project-library-v10-transfer-service.js',
		'desktop/project-library-writer-coordinator.js',
		'desktop/project-library.js',
		'src/common/editor/adm-project-metadata.js',
		'src/common/editor/audio-groove-template.js',
		'src/common/editor/audio-warp-clip-authority.js',
		'src/common/editor/audio-warp-domain.js',
		'src/common/editor/audio-warp-runtime-authority.js',
		'src/common/editor/broadcast-wave.js',
		'src/common/editor/cart-metadata.js',
		'src/common/editor/closed-domain-value.js',
		'src/common/editor/commands/protocol.js',
		'src/common/editor/ffmpeg-video-source-characteristics.js',
		'src/common/editor/ffmpeg-video-timing-probe.js',
		'src/common/editor/folder-bus-v13.js',
		'src/common/editor/frame-canonical-edge-trim-domain.js',
		'src/common/editor/indexed-tempo-projector.js',
		'src/common/editor/ixml.js',
		'src/common/editor/lower-only-seam.js',
		'src/common/editor/musical-map-contract.js',
		'src/common/editor/persisted-audio-effect-validation.js',
		'src/common/editor/project-bext-metadata.js',
		'src/common/editor/project-feature-capabilities.js',
		'src/common/editor/project-feature-capability-profile.js',
		'src/common/editor/project-feature-requirement-types.js',
		'src/common/editor/project-feature-requirements.js',
		'src/common/editor/project-owned-feature-requirements.js',
		'src/common/editor/project-revision-cas.js',
		'src/common/editor/project-runtime-profile-prerequisite.js',
		'src/common/editor/project-runtime-profile.js',
		'src/common/editor/project-schema-version.js',
		'src/common/editor/project-v10-foundation-validation.js',
		'src/common/editor/project-v12-validation.js',
		'src/common/editor/project-v15-validation.js',
		'src/common/editor/project-v17-validation.js',
		'src/common/editor/project-v9-document-validation.js',
		'src/common/editor/project-v9-media-validation.js',
		'src/common/editor/project-v9-validation-budget.js',
		'src/common/editor/project-v9-validation-primitives.js',
		'src/common/editor/retention.js',
		'src/common/editor/routing-cycle-v21.js',
		'src/common/editor/runtime-clip-projection.js',
		'src/common/editor/runtime-timeline-annotation-projection.js',
		'src/common/editor/scape-project-document.js',
		'src/common/editor/scape-project-json-preflight.js',
		'src/common/editor/sequence-timecode.js',
		'src/common/editor/source-characteristics-v14.js',
		'src/common/editor/stable-id.js',
		'src/common/editor/storage/project-storage-profile.js',
		'src/common/editor/take-comp-document-v17.js',
		'src/common/editor/take-comp-domain.js',
		'src/common/editor/take-group-source-references.js',
		'src/common/editor/terminal-channel-widths.js',
		'src/common/editor/timeline-annotation.js',
		'src/common/editor/timeline-coordinate-limits.js',
		'src/common/editor/timeline-tempo-inverse.js',
		'src/common/editor/timeline-time.js',
		'src/common/editor/track-folder-media-runtime.js',
		'src/common/editor/track-folder-state-projection.js',
		'src/common/editor/track-folder-v12.js',
		'src/common/editor/track-hierarchy-v12.js',
		'src/common/editor/video-clip-composition.js',
		'src/common/editor/video-display-geometry.js',
		'src/common/editor/video-effects.js',
		'src/common/editor/video-proxy-attachment-v18.js',
		'src/common/editor/video-render-description.js',
		'src/common/editor/video-retime-curve.js',
		'src/common/editor/video-retime-v16.js',
		'src/common/editor/video-source-characteristics.js',
		'src/common/editor/video-source-presentation.js',
		'src/common/editor/video-source-time.js',
		'src/common/editor/video-source-timing-view.js',
		'src/common/editor/video-source-timing-views.js',
		'src/common/editor/video-timeline.js',
		'src/common/editor/video-track-visibility.js',
		'src/common/editor/video-timing-asset-reference.js',
		'src/common/editor/video-timing-asset.js',
		'src/common/editor/wav-opaque-chunks.js',
		'src/framescaper/editor-project-feature-capability-profile-v18.js',
		'src/framescaper/editor-project-feature-requirements-v18.js',
		'src/framescaper/editor-project-runtime-profile-v18-prerequisite.js',
		'src/framescaper/editor-project-runtime-profile-v18.js',
		'src/framescaper/editor-project-storage-profile-v18.js',
		'src/framescaper/editor-project-v18-multicam.js',
		'src/framescaper/editor-project-v18-profile.js',
		'src/framescaper/editor-project-v18-sequence.js',
		'src/framescaper/editor-project-v18-subsequence.js',
		'src/framescaper/editor-project-v18-validation.js',
		'desktop/soundscaper-project-library-v10-catalog.js',
		'desktop/soundscaper-project-library-v10-contract.js',
		'desktop/soundscaper-project-library-v10-current-project.js',
		'desktop/soundscaper-project-library-v10-database.js',
		'desktop/soundscaper-project-library-v10-handshake-gate.js',
		'desktop/soundscaper-project-library-v10-ipc.js',
		'desktop/soundscaper-project-library-v10-lifecycle-contract.js',
		'desktop/soundscaper-project-library-v10-lifecycle-host.js',
		'desktop/soundscaper-project-library-v10-main-channels.js',
		'desktop/soundscaper-project-library-v10-main-ipc.js',
		'desktop/soundscaper-project-library-v10-main-session.js',
		'desktop/soundscaper-project-library-v10-main.js',
		'desktop/soundscaper-project-library-v10-media-binding.js',
		'desktop/soundscaper-project-library-v10-metadata.js',
		'desktop/soundscaper-project-library-v10-persistence-codecs.js',
		'desktop/soundscaper-project-library-v10-publication-contract.js',
		'desktop/soundscaper-project-library-v10-publication-files.js',
		'desktop/soundscaper-project-library-v10-publication-host.js',
		'desktop/soundscaper-project-library-v10-publication-persistence.js',
		'desktop/soundscaper-project-library-v10-publication-transport.js',
		'desktop/soundscaper-project-library-v10-transfer-contract.js',
		'desktop/soundscaper-project-library-v10-transfer-service.js',
		'src/common/editor/audacity-effects/live.js',
		'src/common/editor/audacity-effects/manifest.js',
		'src/common/editor/audacity-effects/spectral.js',
		'src/common/editor/audio-track-freeze-lifecycle-v21.js',
		'src/common/editor/audio-track-freeze-v21.js',
		'src/common/editor/automation-lane-v21.js',
		'src/common/editor/commands/audio-production.js',
		'src/common/editor/commands/command-projection-transients.js',
		'src/common/editor/commands/domain-registry.js',
		'src/common/editor/commands/video-keyframe-carrier.js',
		'src/common/editor/commands/video-keyframe-command-reconcile.js',
		'src/common/editor/effect-parameter-descriptors.js',
		'src/common/editor/effects.js',
		'src/common/editor/folder-mixer-graph-v21.js',
		'src/common/editor/inert-json-snapshot.js',
		'src/common/editor/interpolation-curve-math.js',
		'src/common/editor/interpolation-curve.js',
		'src/common/editor/mixer-graph-v21.js',
		'src/common/editor/parameter-address.js',
		'src/common/editor/pffft.js',
		'src/common/editor/project-current-runtime.js',
		'src/common/editor/project-v10-command-projection.js',
		'src/common/editor/project-v10-validation.js',
		'src/common/editor/project-v11-validation.js',
		'src/common/editor/project-v13-hierarchy-reconcile.js',
		'src/common/editor/project.js',
		'src/common/editor/reviewed-effects/catalog.js',
		'src/common/editor/reviewed-effects/errors.js',
		'src/common/editor/reviewed-effects/hash.js',
		'src/common/editor/reviewed-effects/manifest.js',
		'src/common/editor/reviewed-effects/offline-worker-client.js',
		'src/common/editor/reviewed-effects/offline-worker-runtime.js',
		'src/common/editor/reviewed-effects/runtime.js',
		'src/common/editor/reviewed-effects/selection-effect.js',
		'src/common/editor/reviewed-effects/utility-gain-package.js',
		'src/common/editor/reviewed-effects/wasm-abi.js',
		'src/common/editor/scape-abort.js',
		'src/common/editor/scape-archive-envelope.js',
		'src/common/editor/scape-archive-media.js',
		'src/common/editor/scape-expanded-byte-budget.js',
		'src/common/editor/track-hierarchy-mutation-v12.js',
		'src/common/editor/video-keyframe-curves.js',
		'src/common/editor/video-keyframe-time-domain.js',
		'src/common/editor/wavpack/pcm.js',
		'src/common/i18n/canonical-extras.js',
		'src/common/i18n/locale.js',
		'src/soundscaper/editor-project-feature-requirements-v21.js',
		'src/soundscaper/editor-project-v21-validation.js',
	].sort());
	for (const name of result.files) {
		const source = await readFile(join(outputRoot, name), 'utf8');
		assert.doesNotMatch(source, /from ['"].*\.ts['"]/u);
	}
	const packagedRuntimePrefix = './desktop/project-library-runtime/';
	for (const [specifier, target] of Object.entries(DESKTOP_RUNTIME_PACKAGE_IMPORTS)) {
		assert.ok(target.startsWith(packagedRuntimePrefix),
			`${specifier} must resolve inside the packaged desktop runtime`);
		assert.ok(result.files.includes(target.slice(packagedRuntimePrefix.length)),
			`${specifier} must resolve to a compiled desktop runtime member`);
	}
	assert.ok(result.files.includes('src/common/editor/project-v12-validation.js'));
	assert.ok(result.files.includes('src/common/editor/track-folder-v12.js'));
	assert.ok(result.files.includes('src/common/editor/track-hierarchy-v12.js'));
	assert.ok(result.files.includes('src/common/editor/timeline-annotation.js'));
	assert.equal(result.files.includes('src/common/editor/project-current.js'), false);
	assert.equal(result.files.includes('src/common/editor/project-v11.js'), false);
	assert.equal(result.files.includes('src/common/editor/pffft.js'), true);
	const runtime = await import(`${pathToFileURL(join(outputRoot, 'desktop/project-library-host.js')).href}?test=${Date.now()}`);
	const linkedVideoRegistry = await import(`${pathToFileURL(join(outputRoot, 'desktop/linked-video-locator-registry.js')).href}?test=${Date.now()}`);
	const linkedVideoStore = await import(`${pathToFileURL(join(outputRoot, 'desktop/linked-video-locator-store.js')).href}?test=${Date.now()}`);
	const editorService = await import(`${pathToFileURL(join(outputRoot, 'desktop/project-library-editor-service.js')).href}?test=${Date.now()}`);
	const editorMediaService = await import(`${pathToFileURL(join(outputRoot, 'desktop/project-library-editor-media-service.js')).href}?test=${Date.now()}`);
	const managedMedia = await import(`${pathToFileURL(join(outputRoot, 'desktop/project-library-media.js')).href}?test=${Date.now()}`);
	assert.equal(typeof runtime.DesktopProjectLibraryHost?.start, 'function');
	assert.equal(typeof linkedVideoRegistry.FileDesktopLinkedVideoLocatorRegistry, 'function');
	assert.equal(typeof linkedVideoStore.DesktopLinkedVideoLocatorStore, 'function');
	assert.equal(typeof editorService.DesktopSharedProjectLibraryService, 'function');
	assert.equal(typeof editorMediaService.DesktopSharedProjectMediaService, 'function');
	assert.equal(typeof managedMedia.DesktopLibraryManagedMediaStore, 'function');
	let commitCalls = 0;
	const unusedManagedMediaHost = {
		publishManagedMedia: async () => { throw new Error('Unexpected managed-media publication'); },
		readManagedMedia: async () => new Uint8Array(),
		readProjectBundleById: async () => null,
	};
	const service = new editorService.DesktopSharedProjectLibraryService({
		...unusedManagedMediaHost,
		commitProjectById: async ({ project }) => {
			commitCalls += 1;
			return { catalog: {}, project };
		},
		deleteProjectById: async () => false,
		readCatalog: () => ({ projects: [] }),
		readProjectById: async () => null,
		snapshot: () => ({ owner: { product: 'soundscaper' } }),
	}, {
		createEntryId: () => 'packaging-entry-0001',
		now: () => 10_000,
	});
	const project = createCurrentAudioEditorProject({
		id: 'packaging-project',
		title: 'Packaging project',
		now: '2026-07-30T12:00:00.000Z',
	});
	const validDocument = serializeScapeProjectDocument(project);
	assert.deepEqual(await service.commitSharedProject({ document: validDocument, expectedRevision: null }), {
		status: 'committed', document: validDocument,
	});
	const invalidDocument = serializeScapeProjectDocument({ ...project, tempo: { ...project.tempo, bpm: 0 } });
	await assert.rejects(() => service.commitSharedProject({
		document: invalidDocument, expectedRevision: null,
	}), /tempo\.bpm/u);
	assert.equal(commitCalls, 1);
	const boundedService = new editorService.DesktopSharedProjectLibraryService({
		...unusedManagedMediaHost,
		commitProjectById: async ({ project: committedProject }) => {
			commitCalls += 1;
			return { catalog: {}, project: committedProject };
		},
		deleteProjectById: async () => false,
		readCatalog: () => ({ projects: [] }),
		readProjectById: async () => null,
		snapshot: () => ({ owner: { product: 'soundscaper' } }),
	}, {
		createEntryId: () => 'packaging-entry-0002',
		documentLimits: {
			maximumPayloadCount: 1,
			maximumTraversalNodes: 80,
		},
		now: () => 10_000,
	});
	const overBudgetDocument = serializeScapeProjectDocument({
		...project,
		opaqueExtensions: { items: Array.from({ length: 16 }, (_, index) => index) },
	});
	await assert.rejects(
		() => boundedService.commitSharedProject({ document: overBudgetDocument, expectedRevision: null }),
		/JSON.*structural traversal node limit/iu,
	);
	assert.equal(commitCalls, 1, 'compiled structural admission must run before the host commit');
	await Promise.all([service.dispose(), boundedService.dispose()]);
});

test('desktop staging excludes raw TypeScript and includes the compiled runtime', async (context) => {
	const temporaryRoot = await mkdtemp(join(tmpdir(), 'scape-desktop-stage-'));
	context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
	const runtimeRoot = join(temporaryRoot, 'runtime');
	const applicationDesktopRoot = join(temporaryRoot, 'application', 'desktop');
	await compileDesktopProjectLibraryRuntime({ repositoryRoot: ROOT, outputRoot: runtimeRoot });
	await stageDesktopApplicationSources({
		desktopSourceRoot: join(ROOT, 'desktop'),
		applicationDesktopRoot,
		runtimeRoot,
	});
	await access(join(applicationDesktopRoot, 'main.mjs'));
	await access(join(applicationDesktopRoot, 'desktop-smoke.js'));
	await access(join(applicationDesktopRoot, 'framescaper-v18-artifact-smoke.js'));
	await access(join(applicationDesktopRoot, 'direct-wav-smoke.js'));
	await access(join(applicationDesktopRoot, 'project-library-smoke-evidence.js'));
	await access(join(applicationDesktopRoot, 'project-library-smoke-project.js'));
	await access(join(applicationDesktopRoot, 'project-library-source-bearing-renderer-smoke.js'));
	await access(join(applicationDesktopRoot, 'project-library-source-bearing-smoke-session.js'));
	await access(join(applicationDesktopRoot, 'project-library-source-bearing-smoke.js'));
	await access(join(applicationDesktopRoot, 'linked-video-locator-ipc.js'));
	await access(join(applicationDesktopRoot, 'linked-video-locator-runtime.js'));
	await access(join(applicationDesktopRoot, 'project-library-ipc.js'));
	await access(join(applicationDesktopRoot, 'project-library-product-runtime.js'));
	await access(join(applicationDesktopRoot, 'project-library-v10-sandbox-preload.cjs'));
	await access(join(applicationDesktopRoot, 'soundscaper-project-library-v10-sandbox-preload.cjs'));
	await access(join(applicationDesktopRoot, 'read-selection-service.js'));
	await access(join(applicationDesktopRoot, 'renderer-save-owner.js'));
	await access(join(applicationDesktopRoot, 'project-library-runtime', 'desktop/project-library-editor-service.js'));
	await access(join(applicationDesktopRoot, 'project-library-runtime', 'desktop/linked-original-locator-validation.js'));
	await access(join(applicationDesktopRoot, 'project-library-runtime', 'desktop/linked-video-locator-registry.js'));
	await access(join(applicationDesktopRoot, 'project-library-runtime', 'desktop/linked-video-locator-store.js'));
	await access(join(applicationDesktopRoot, 'project-library-runtime', 'desktop/project-library-editor-media-service.js'));
	await access(join(applicationDesktopRoot, 'project-library-runtime', 'desktop/project-library-host.js'));
	await access(join(applicationDesktopRoot, 'project-library-runtime', 'desktop/project-library-v10-main.js'));
	await access(join(applicationDesktopRoot, 'project-library-runtime', 'desktop/project-library-v10-main-ipc.js'));
	await access(join(applicationDesktopRoot, 'project-library-runtime', 'desktop/soundscaper-project-library-v10-main.js'));
	await access(join(applicationDesktopRoot, 'project-library-runtime', 'desktop/soundscaper-project-library-v10-main-ipc.js'));
	await access(join(applicationDesktopRoot, 'project-library-runtime', 'desktop/project-library-media-binding.js'));
	await access(join(applicationDesktopRoot, 'project-library-runtime', 'desktop/project-library-media-body.js'));
	await access(join(applicationDesktopRoot, 'project-library-runtime', 'desktop/project-library-media-capacity.js'));
	await access(join(applicationDesktopRoot, 'project-library-runtime', 'desktop/project-library-media-inventory-store.js'));
	await access(join(applicationDesktopRoot, 'project-library-runtime', 'desktop/project-library-media-inventory.js'));
	await access(join(applicationDesktopRoot, 'project-library-runtime', 'desktop/project-library-media-reclamation.js'));
	await access(join(applicationDesktopRoot, 'project-library-runtime', 'desktop/project-library-media-reuse.js'));
	await access(join(applicationDesktopRoot, 'project-library-runtime', 'desktop/project-library-media.js'));
	await access(join(applicationDesktopRoot, 'project-library-runtime', 'desktop/project-library-reclamation.js'));
	await access(join(applicationDesktopRoot, 'project-library-runtime', 'desktop/project-library-projects.js'));
	await access(join(applicationDesktopRoot, 'project-library-runtime', 'desktop/project-library-sequential-upload.js'));
	await access(join(applicationDesktopRoot, 'project-library-runtime', 'desktop/project-library-stage-inventory.js'));
	await access(join(applicationDesktopRoot, 'project-library-runtime', 'src/common/editor/project-v12-validation.js'));
	await access(join(applicationDesktopRoot, 'project-library-runtime', 'src/common/editor/track-folder-v12.js'));
	await access(join(applicationDesktopRoot, 'project-library-runtime', 'src/common/editor/track-hierarchy-v12.js'));
	await access(join(applicationDesktopRoot, 'project-library-runtime', 'src/common/editor/timeline-annotation.js'));
	await access(join(applicationDesktopRoot, 'project-library-runtime', 'src/common/editor/runtime-timeline-annotation-projection.js'));
	await access(join(applicationDesktopRoot, 'project-library-runtime', 'src/common/editor/timeline-coordinate-limits.js'));
	await access(join(applicationDesktopRoot, 'project-library-runtime', 'src/common/editor/project-v9-validation-budget.js'));
	await access(join(applicationDesktopRoot, 'project-library-runtime', 'src/common/editor/retention.js'));
	await access(join(applicationDesktopRoot, 'project-library-runtime', 'src/common/editor/scape-project-document.js'));
	await access(join(applicationDesktopRoot, 'project-library-runtime', 'src/common/editor/scape-project-json-preflight.js'));
	await assert.rejects(() => access(join(applicationDesktopRoot, 'project-library-smoke-project-v10.js')), /ENOENT/u);
	const stagedMain = await readFile(join(applicationDesktopRoot, 'main.mjs'), 'utf8');
	const runtimeImports = [...stagedMain.matchAll(/from ['"]\.\/project-library-runtime\/([^'"]+)['"]/gu)];
	assert.ok(runtimeImports.length > 0, 'desktop main must import its compiled runtime');
	for (const [, relativePath] of runtimeImports) {
		await access(join(applicationDesktopRoot, 'project-library-runtime', relativePath));
	}
	const locatorRuntime = await readFile(join(applicationDesktopRoot, 'linked-video-locator-runtime.js'), 'utf8');
	assert.match(locatorRuntime, /project-library-runtime\/desktop\/linked-video-locator-registry\.js/u);
	assert.match(locatorRuntime, /project-library-runtime\/desktop\/linked-video-locator-store\.js/u);
	await assert.rejects(() => access(join(applicationDesktopRoot, 'project-library-host.ts')), /ENOENT/u);
});

test('desktop main initializes, exposes, and disposes the shared library through bounded IPC', async () => {
	const [mainSource, preloadSource, prepareSource, packageMetadata] = await Promise.all([
		readFile(join(ROOT, 'desktop', 'main.mjs'), 'utf8'),
		readFile(join(ROOT, 'desktop', 'preload.mjs'), 'utf8'),
		readFile(join(ROOT, 'scripts', 'desktop-prepare.mjs'), 'utf8'),
		readFile(join(ROOT, 'package.json'), 'utf8').then(JSON.parse),
	]);
	const readyIndex = mainSource.indexOf('await app.whenReady()');
	const appDataIndex = mainSource.indexOf("app.getPath('appData')");
	assert.ok(readyIndex >= 0 && appDataIndex > readyIndex, 'shared appData is resolved only after Electron is ready');
	assert.match(mainSource, /startDesktopProjectLibraryProductRuntime/u);
	assert.match(mainSource, /productId:\s*PRODUCT_ID/u);
	assert.match(mainSource, /createDesktopSmokeProbe\(\{/u);
	assert.match(mainSource, /projectLibraryEvidence: projectLibrarySmokeEvidence/u);
	assert.match(mainSource, /desktopSmokeProbe\.attach\(mainWindow\)/u);
	assert.match(mainSource, /on\(IPC\.rendererReady.*desktopSmokeProbe\.rendererReady\(\)/su);
	assert.match(mainSource, /projectLibrarySmokeEvidence.*projectLibraryRuntime\.smokeEvidence/su);
	assert.doesNotMatch(mainSource, /webContents\.executeJavaScript/u);
	assert.match(mainSource, /projectLibraryRuntime\.registerRendererBridge\(\{/u);
	assert.match(mainSource, /ownerFor:\s*rendererSaveOwnerFor/u);
	assert.match(mainSource, /new DesktopApplicationShutdown/u);
	assert.match(mainSource, /name: 'project library', run: closeProjectLibraryHost/u);
	assert.match(mainSource, /nativeTier = registerDesktopNativeTier\(\{ channels: IPC, handle, ownerFor: rendererSaveOwnerFor, readCapabilities, settings/u,
		'the native tier must register through the trusted IPC wrapper with main-owned seams');
	assert.match(mainSource, /name: 'native tier', run: \(\) => disposeDesktopNativeTier\(nativeTier\)/u,
		'every native helper must join the ordered shutdown barrier together');
	assert.match(mainSource, /revokeNativeTier: \(owner\) => revokeDesktopNativeTierOwner\(nativeTier, owner\)/u,
		'renderer ownership cleanup must drain every native surface together when a renderer goes away');
	assert.match(mainSource, /\.\.\.desktopNativeTierMenu\(settings\)/u,
		'the native surfaces must stay menu-reached');
	assert.match(mainSource, /name: 'read capabilities'.*readCapabilities\.dispose\(\)/su);
	assert.match(mainSource, /name: 'save sessions'.*saves\.dispose\(\)/su);
	const startIndex = mainSource.indexOf('void startApplication()');
	const beforeQuitIndex = mainSource.indexOf("app.on('before-quit'");
	const willQuitIndex = mainSource.indexOf("app.on('will-quit'");
	assert.ok(beforeQuitIndex >= 0 && beforeQuitIndex < startIndex, 'quit intent is observed before startup begins');
	assert.ok(willQuitIndex >= 0 && willQuitIndex < startIndex, 'async shutdown is installed before startup begins');
	const willQuit = mainSource.slice(willQuitIndex, mainSource.indexOf('\n});', willQuitIndex));
	assert.match(willQuit, /event\.preventDefault\(\)/u, 'Electron waits for the explicit async shutdown path');
	assert.match(willQuit, /void exitApplication\(0\)/u);
	assert.match(mainSource, /resolveDesktopProjectLibraryAppData/u);
	assert.doesNotMatch(preloadSource, /projectLibrary|libraryRoot|appData/u);
	assert.match(prepareSource, /compileDesktopProjectLibraryRuntime/u);
	assert.match(prepareSource, /stageDesktopApplicationSources/u);
	assert.match(prepareSource, /desktopRuntime/u);
	assert.match(prepareSource, /imports: DESKTOP_RUNTIME_PACKAGE_IMPORTS/u,
		'the staged application manifest must map the desktop package-imports aliases to shipped runtime members');
	assert.equal(packageMetadata.scripts['desktop:dev'], 'npm run desktop:prepare && electron .desktop-build/app');
});

test('desktop main owns file capabilities by committed renderer document', async () => {
	const mainSource = await readFile(join(ROOT, 'desktop', 'main.mjs'), 'utf8');
	const cleanupSource = await readFile(join(ROOT, 'desktop', 'renderer-ownership-cleanup.js'), 'utf8');
	assert.match(
		mainSource,
		/webContents\.on\('did-start-navigation'.*details\.isMainFrame && !details\.isSameDocument.*revokeRendererSaveOwner\(webContents\)/su,
	);
	assert.match(mainSource, /webContents\.on\('did-frame-navigate'.*frameProcessId.*frameRoutingId.*activateRendererSaveOwner/su);
	assert.match(mainSource, /attachDesktopMainWindowRecovery\(\{.*rendererOwnershipCleanup\.drain\(webContents\)/su);
	assert.match(mainSource, /mainWindow\.on\('closed'.*revokeRendererSaveOwner\(webContents\)/su);

	const chooseStart = mainSource.indexOf('async function chooseSaveTarget');
	const chooseEnd = mainSource.indexOf('\nfunction ', chooseStart);
	const chooseSource = mainSource.slice(chooseStart, chooseEnd);
	const captureIndex = chooseSource.indexOf('rendererSaveOwnerFor(event)');
	const validationIndex = chooseSource.indexOf('validateSaveChoice(value)');
	const smokeTargetIndex = chooseSource.indexOf('await desktopSmokeProbe.resolveSavePath(choice)');
	const dialogIndex = chooseSource.indexOf('await dialog.showSaveDialog');
	assert.ok(captureIndex >= 0 && captureIndex < dialogIndex, 'save-dialog ownership is captured before awaiting user input');
	assert.ok(
		validationIndex >= 0 && smokeTargetIndex > validationIndex && smokeTargetIndex < dialogIndex,
		'validated packaged-smoke targets bypass the native dialog before any user-selected path is admitted',
	);
	assert.match(chooseSource, /registerPath\(smokeFilePath, \{ owner, purpose: choice\.purpose \}\)/u);
	assert.match(chooseSource, /registerPath\(result\.filePath, \{ owner,/u);

	for (const channel of ['beginWrite', 'writeChunk', 'patchFinalPrefix', 'finishWrite', 'abortWrite']) {
		const handlerStart = mainSource.indexOf(`handle(IPC.${channel}`);
		const handlerEnd = mainSource.indexOf('\n\thandle(', handlerStart + 1);
		assert.ok(handlerStart >= 0, `missing ${channel} handler`);
		assert.match(
			mainSource.slice(handlerStart, handlerEnd),
			/rendererSaveOwnerFor\(event\)/u,
			`${channel} must receive its owner from trusted main-process state`,
		);
	}

	const revokeStart = mainSource.indexOf('function revokeRendererSaveOwner');
	const revokeEnd = mainSource.indexOf('\nfunction ', revokeStart + 1);
	const revokeSource = mainSource.slice(revokeStart, revokeEnd);
	assert.ok(revokeStart >= 0);
	assert.ok(
		revokeSource.indexOf('rendererReady = false') < revokeSource.indexOf('rendererOwnershipCleanup.revoke'),
		'revocation closes document admission synchronously before asynchronous cleanup',
	);
	assert.match(cleanupSource, /const owner = this\.#ownership\.revoke\(webContents\)/u);
	assert.match(cleanupSource, /this\.#revokeNativeTier\?\.\(owner\)/u);
	assert.match(cleanupSource, /this\.#projectLibraryIpc\(\)\?\.revokeOwner\(owner\)/u);
	assert.match(cleanupSource, /this\.#readCapabilities\.revokeOwner\(owner\)/u);
	assert.match(cleanupSource, /this\.#saves\.revokeOwner\(owner\)/u);

	const chooseReadStart = mainSource.indexOf('async function chooseFiles');
	const chooseReadEnd = mainSource.indexOf('\nfunction ', chooseReadStart);
	const chooseReadSource = mainSource.slice(chooseReadStart, chooseReadEnd);
	const readCaptureIndex = chooseReadSource.indexOf('rendererSaveOwnerFor(event)');
	const readDialogIndex = chooseReadSource.indexOf('await dialog.showOpenDialog');
	assert.ok(readCaptureIndex >= 0 && readCaptureIndex < readDialogIndex,
		'read-dialog ownership is captured before awaiting user input');
	assert.match(
		chooseReadSource,
		/registerSelectedReadCapability\(readCapabilities, filePath, \{ owner, purpose: choice\.purpose \}\)/u,
	);
	assert.match(chooseReadSource, /throwAfterReadCapabilityRollback\(readCapabilities, descriptors, owner, error\)/u);

	const chooseReadHandler = mainSource.slice(
		mainSource.indexOf('handle(IPC.chooseFiles'),
		mainSource.indexOf('\n\thandle(', mainSource.indexOf('handle(IPC.chooseFiles') + 1),
	);
	assert.match(chooseReadHandler, /\(event, value\).*chooseFiles\(event, value\)/su);
	const releaseReadHandler = mainSource.slice(
		mainSource.indexOf('handle(IPC.releaseRead'),
		mainSource.indexOf('\n\thandle(', mainSource.indexOf('handle(IPC.releaseRead') + 1),
	);
	assert.match(releaseReadHandler, /rendererSaveOwnerFor\(event\)/u);
	assert.match(releaseReadHandler, /redispatchPendingProjectsAfterReadRelease/u);

	assert.match(mainSource, /new PendingProjectQueue\(createPendingProjectDelivery\(\{/u);
	const dispatchStart = mainSource.indexOf('createPendingProjectDelivery({');
	const dispatchEnd = mainSource.indexOf('}));', dispatchStart);
	const dispatchSource = mainSource.slice(dispatchStart, dispatchEnd);
	assert.match(dispatchSource, /currentOwnerFor\(mainWindow\.webContents\)/u);
	assert.match(
		dispatchSource,
		/registerSelectedReadCapability\(readCapabilities, filePath, \{ owner, purpose: 'project' \}\)/u,
	);
	assert.match(dispatchSource, /isOwnerCurrent: isRendererSaveOwnerCurrent/u,
		'owner replacement is checked by the serialized delivery service');
	assert.match(dispatchSource, /release: \(id, owner\) => readCapabilities\.release\(id, \{ owner \}\)/u);
	assert.match(
		dispatchSource,
		/desktopSmokeProbe\.observeProjectDescriptor\(descriptor, \(id\) => readCapabilities\.get\(id\)\)/u,
	);
	assert.match(dispatchSource, /return sendToRenderer\(IPC\.openProject, descriptor\)/u);

	const ownerForStart = mainSource.indexOf('function rendererSaveOwnerFor');
	const ownerForEnd = mainSource.indexOf('\nfunction ', ownerForStart + 1);
	const ownerForSource = mainSource.slice(ownerForStart, ownerForEnd);
	assert.match(ownerForSource, /event\.processId/u);
	assert.match(ownerForSource, /event\.frameId/u);

	const trustStart = mainSource.indexOf('function assertTrustedIpc');
	const trustEnd = mainSource.indexOf('\nfunction ', trustStart + 1);
	const trustSource = mainSource.slice(trustStart, trustEnd);
	assert.match(trustSource, /!event\.senderFrame/u);
	assert.match(trustSource, /event\.sender\.mainFrame/u);
});
