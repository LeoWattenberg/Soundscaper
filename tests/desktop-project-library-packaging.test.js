/* SPDX-License-Identifier: AGPL-3.0-only */

import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
	compileDesktopProjectLibraryRuntime,
	DESKTOP_RUNTIME_PACKAGE_IMPORTS,
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
		'src/common/editor/adm-authored-objects.js',
		'src/common/editor/adm-bed-layout.js',
		'src/common/editor/adm-normalization-guards.js',
		'src/common/editor/adm-project-metadata.js',
		'src/common/editor/audio-groove-template.js',
		'src/common/editor/audio-warp-clip-authority.js',
		'src/common/editor/audio-warp-domain.js',
		'src/common/editor/audio-warp-runtime-authority.js',
		'src/common/editor/broadcast-wave.js',
		'src/common/editor/cart-metadata.js',
		'src/common/editor/closed-domain-value.js',
		'src/common/editor/commands/mastering-sequence.js',
		'src/common/editor/commands/protocol.js',
		'src/common/editor/commands/protocol-values.js',
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
		'src/common/editor/video-canvas-fit.js',
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
		'src/common/editor/mastering-sequence.js',
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
		'src/soundscaper/editor-project-feature-requirements-v23.js',
		'src/soundscaper/editor-project-production-validation.js',
		'src/soundscaper/editor-project-v23-validation.js',
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

