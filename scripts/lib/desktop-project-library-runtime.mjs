/* SPDX-License-Identifier: AGPL-3.0-only */

import { spawn } from 'node:child_process';
import { cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { build } from 'esbuild';
import { DESKTOP_5B_TRANSITIVE_RUNTIME_FILES, DESKTOP_RUNTIME_BUNDLED_LEAF_FILES } from './desktop-5b-transitive-runtime-files.mjs';
import { DESKTOP_ASSISTANCE_RUNTIME_FILES } from './desktop-assistance-runtime-files.mjs';
import { stageDesktopBundledAudioRuntime } from './desktop-bundled-audio-runtime.mjs';
import { DESKTOP_EXTERNAL_FFMPEG_RUNTIME_FILES } from './desktop-external-ffmpeg-runtime-files.mjs';
import { DESKTOP_PROJECT_LIBRARY_BASELINE_RUNTIME_FILES } from './desktop-project-library-baseline-runtime-files.mjs';
import { DESKTOP_SOUNDSCAPER_RUNTIME_FILES } from './desktop-soundscaper-runtime-files.mjs';
import {
	assertNoTypeScriptImportSpecifiers,
	assertStagedDesktopImportsResolve,
} from './desktop-staged-import-hygiene.mjs';
import { stageBundledAudioCodecRuntimeManifest } from './desktop-bundled-audio-codec-runtime-closure.mjs';
import {
	assertDesktopProductPackageIsolation,
	desktopProductRuntimePackageImports,
	desktopProductSourceIncluded,
} from './desktop-product-package-files.mjs';
import {
	collectApplicationDesktopRuntimeReferences,
	collectDesktopProductRuntimeClosure,
	desktopProductRuntimeTransform,
	stageSoundscaperDesktopEntrySources,
} from './desktop-product-runtime-staging.mjs';

const FRAMESCAPER_CAPTURE_PRELOAD_BUNDLE = 'framescaper-capture-sandbox-preload.cjs';
const FRAMESCAPER_WEB_VCR_PRELOAD_BUNDLE = 'framescaper-web-vcr-sandbox-preload.cjs';
const SOUNDSCAPER_PRELOAD_BUNDLE = 'soundscaper-project-library-sandbox-preload.cjs';
const DESKTOP_ONLY_EXCLUDED_SOURCES = Object.freeze(new Set(['bundled-audio-codec-runtime-manifest.json', 'ffmpeg-corresponding-source.json']));
// Staged sources ship no TypeScript loader. Package aliases resolve to source
// TypeScript in the repository and compiled runtime members in the application.
export const DESKTOP_RUNTIME_PACKAGE_IMPORTS = Object.freeze({
	'#desktop-runtime/ffmpeg-video-source-characteristics':
		'./desktop/project-library-runtime/src/common/editor/ffmpeg-video-source-characteristics.js',
	'#desktop-runtime/ffmpeg-video-timing-probe':
		'./desktop/project-library-runtime/src/common/editor/ffmpeg-video-timing-probe.js',
	'#desktop-runtime/helper-contract':
		'./desktop/project-library-runtime/desktop/helper-contract.js',
	'#desktop-runtime/video-source-characteristics':
		'./desktop/project-library-runtime/src/common/editor/video-source-characteristics.js',
	'#desktop-runtime/video-timing-asset':
		'./desktop/project-library-runtime/src/common/editor/video-timing-asset.js',
});

export const DESKTOP_EXPECTED_RUNTIME_FILES = Object.freeze([
	...DESKTOP_5B_TRANSITIVE_RUNTIME_FILES,
	'desktop/application-lifecycle.js',
	...DESKTOP_ASSISTANCE_RUNTIME_FILES,
	...DESKTOP_EXTERNAL_FFMPEG_RUNTIME_FILES,
	'desktop/framescaper-capture-desktop-port.js',
	'desktop/framescaper-capture-main-channels.js',
	'desktop/framescaper-capture-session-security.js',
	'desktop/framescaper-media-host-payload.js',
	'desktop/framescaper-openfx-host-payload.js',
	'desktop/framescaper-openfx-runtime.js',
	'desktop/framescaper-web-vcr-capture-authority.js',
	'desktop/framescaper-web-vcr-contract.js',
	'desktop/framescaper-web-vcr-electron-window.js',
	'desktop/framescaper-web-vcr-guest-security.js',
	'desktop/framescaper-web-vcr-host.js',
	'desktop/framescaper-web-vcr-main-channels.js',
	'desktop/framescaper-web-vcr-preload-registration.js',
	'desktop/framescaper-web-vcr-registration.js',
	'desktop/framescaper-web-vcr-runtime-capture-state.js',
	'desktop/framescaper-web-vcr-runtime-snapshot.js',
	'desktop/framescaper-web-vcr-runtime-support.js',
	'desktop/framescaper-web-vcr-runtime.js',
	'desktop/framescaper-web-vcr-security-policy.js',
	'desktop/framescaper-web-vcr-target-observer.js',
	'desktop/framescaper-web-vcr-target-tracker.js',
	'desktop/helper-admission-gate.js',
	'desktop/helper-contract.js',
	'desktop/helper-data-plane-io.js',
	'desktop/helper-data-plane-transfer.js',
	'desktop/helper-data-plane.js',
	'desktop/helper-job-grant.js',
	'desktop/helper-job-subcontract.js',
	'desktop/helper-persistent-port.js',
	'desktop/helper-native-image-sequence-grant.js',
	'desktop/helper-native-job-contract.js',
	'desktop/helper-native-job-result.js',
	'desktop/helper-native-media-file-roles.js',
	'desktop/helper-native-ofx-host-grant.js',
	'desktop/helper-probe-service.js',
	'desktop/helper-resource-policy.js',
	'desktop/helper-supervision-state.js',
	'desktop/helper-supervisor-contracts.js',
	'desktop/helper-supervisor.js',
	'desktop/native-helper-service.js',
	'desktop/native-helper-results.js',
	'desktop/native-image-sequence-selection.js',
	'desktop/native-addon-payload.js',
	'desktop/native-tier-controls.js',
	'desktop/plugin-scan-results.js',
	'desktop/plugin-scan-service.js',
	'desktop/plugin-registry.js',
	'desktop/plugin-quarantine.js',
	'desktop/plugin-consent.js',
	'desktop/helper-wire-admission.js',
	'desktop/linked-original-locator-validation.js',
	'desktop/linked-video-locator-registry.js',
	'desktop/linked-video-locator-store.js',
	'desktop/main-window-recovery.js',
	'desktop/external-display-controller.js',
	'desktop/external-display-frame-port.js',
	'desktop/native-media-capability-report.js',
	'desktop/native-media-execution.js',
	'desktop/native-media-file-auth.js',
	'desktop/native-media-helper-job.js',
	'desktop/native-media-helper-pool.js',
	'desktop/native-media-helper-worker.js',
	'desktop/native-media-host-result.js',
	'desktop/native-media-host-self-test.js',
	'desktop/native-media-queue-dispatcher.js',
	'desktop/native-media-runtime.js',
	'desktop/native-queue-capacity-provider.js',
	'desktop/native-realtime-broker.js',
	'desktop/native-services-checkpoint-recovery.js',
	'desktop/native-services-controller.js',
	'desktop/native-services-database.js',
	'desktop/native-services-external-display-port.js',
	'desktop/native-services-lease-coordinator.js',
	'desktop/native-services-lifecycle.js',
	'desktop/native-services-main-ipc.js',
	'desktop/native-services-main-preload.js',
	'desktop/native-services-node-ports.js',
	'desktop/native-services-publication.js',
	'desktop/native-services-project-authority.js',
	'desktop/native-services-queue-repository.js',
	'desktop/native-services-root-repository.js',
	'desktop/native-services-runtime.js',
	'desktop/native-services-scratch-repository.js',
	'desktop/native-services-watch-coordinator.js',
	'desktop/native-services-watch-import-broker.js',
	'desktop/native-services-watch-repository.js',
	'desktop/openfx-isolated-host-manager.js',
	'desktop/openfx-helper-job.js',
	'desktop/openfx-helper-plugin-staging.js',
	'desktop/openfx-helper-worker.js',
	'desktop/openfx-main-attempt.js',
	'desktop/openfx-main-execution-request.js',
	'desktop/openfx-main-plugin-binary.js',
	'desktop/openfx-main-service.js',
	'desktop/openfx-unified-render-execution.js',
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
	'src/common/editor/chunk-stream.js',
	'src/common/editor/code-unit-order.js',
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
	'src/common/editor/pcm-chunks.js',
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
	'src/common/editor/project-audio-warp-validation.js',
	'src/common/editor/project-foundation-validation.js',
	'src/common/editor/project-hierarchy-document-validation.js',
	'src/common/editor/project-track-lock-validation.js',
	'src/common/editor/project-v17-validation.js',
	'src/common/editor/project-document-validation.js',
	'src/common/editor/project-media-validation.js',
	'src/common/editor/project-media-types.js',
	'src/common/editor/project-validation-budget.js',
	'src/common/editor/project-validation-primitives.js',
	'src/common/editor/required-array-entry.js',
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
	'src/common/editor/terminal-channel-widths.js',
	'src/common/editor/timeline-annotation.js',
	'src/common/editor/timeline-coordinate-limits.js',
	'src/common/editor/timeline-rounding-policy.js',
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
	'src/common/editor/video-transition-preview-opacity.js',
	'src/common/editor/wav-opaque-chunks.js',
	'src/common/editor/web-vcr-domain.js',
	'src/common/editor/web-vcr-geometry.js',
	...DESKTOP_SOUNDSCAPER_RUNTIME_FILES,
	'src/common/editor/audacity-effects/live.js',
	'src/common/editor/audacity-effects/live-capabilities.js',
	'src/common/editor/audacity-effects/live-capability-policy.js',
	'src/common/editor/audacity-effects/live-classic-filter-coefficients.js',
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
	'src/common/editor/effect-explicit-sidechain-capability.js',
	'src/common/editor/effect-parameter-descriptors.js',
	'src/common/editor/effects.js',
	'src/common/editor/first-party-effects/bitcrusher/definition.js',
	'src/common/editor/first-party-effects/parametric-eq/definition.js',
	'src/common/editor/folder-mixer-graph-v21.js',
	'src/common/editor/inert-json-snapshot.js',
	'src/common/editor/interpolation-curve-math.js',
	'src/common/editor/interpolation-curve.js',
	'src/common/editor/mastering-sequence.js',
	'src/common/editor/mixer-graph-v21.js',
	'src/common/editor/parameter-address.js',
	'src/common/editor/pcm-dither.js',
	'src/common/editor/pffft.js',
	'src/common/editor/project-current-runtime.js',
	'src/common/editor/project-command-projection.js',
	'src/common/editor/project-effect-tail-v21.js',
	'src/common/editor/project-hierarchy-reconcile.js',
	'src/common/editor/project.js',
	'src/common/editor/reviewed-effects/catalog.js',
	'src/common/editor/reviewed-effects/errors.js',
	'src/common/editor/reviewed-effects/hash.js',
	'src/common/editor/reviewed-effects/manifest.js',
	'src/common/editor/reviewed-effects/selection-effect-contract.js',
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
	'src/common/editor/wavpack/client.js',
	'src/common/editor/wavpack/index.js',
	'src/common/editor/wavpack/operations.js',
	'src/common/editor/wavpack/runtime.js',
	'src/common/editor/worker-protocol.js',
	'src/common/editor/worker-request-broker.js',
	'src/common/i18n/canonical-extras.js',
	'src/common/i18n/canonical-extras-audacity-effects.js',
	'src/common/i18n/locale.js',
	...DESKTOP_PROJECT_LIBRARY_BASELINE_RUNTIME_FILES,
	'src/common/editor/native-durable-root-grant.js',
	'src/common/editor/native-external-display.js',
	'src/common/editor/native-media-atomic-publication.js',
	'src/common/editor/native-media-backend-policy.js',
	'src/common/editor/native-media-capability-snapshot.js',
	'src/common/editor/native-media-graph-plan-admission.js',
	'src/common/editor/native-media-image-sequence-pack-v25.js',
	'src/common/editor/native-media-image-sequence-v25.js',
	'src/common/editor/native-media-image-sequence.js',
	'src/common/editor/native-media-plan-canonical-form.js',
	'src/common/editor/native-media-plan-envelope.js',
	'src/common/editor/native-media-professional-profiles.js',
	'src/common/editor/native-media-proxy-recipe.js',
	'src/common/editor/native-ofx-binding.js',
	'src/common/editor/native-ofx-descriptor.js',
	'src/common/editor/native-ofx-host-contract.js',
	'src/common/editor/native-ofx-packaging.js',
	'src/common/editor/native-ofx-retimer-source-time.js',
	'src/common/editor/native-ofx-state-v26.js',
	'src/common/editor/native-queue-admission.js',
	'src/common/editor/native-queue-record.js',
	'src/common/editor/native-queue-state-machine.js',
	'src/common/editor/native-realtime-client.js',
	'src/common/editor/native-realtime-protocol.js',
	'src/common/editor/native-scratch-policy.js',
	'src/common/editor/native-validation.js',
	'src/common/editor/native-watch-reconciliation.js',
	'src/common/editor/native-watch-rule.js',
	'src/common/editor/platform/bounded-transfer.js',
	'src/common/editor/project-publication-admission.js',
	'src/common/editor/publication-byte-estimates.js',
	'src/common/editor/sequence-frame-navigation.js',
	'src/common/editor/unified-exact-render-identity-authority.js',
	'src/common/editor/unified-exact-render-output-admission.js',
	'src/common/editor/unified-exact-render-plan-v10.js',
	'src/common/editor/unified-exact-render-plan-v11.js',
	'src/common/editor/unified-exact-render-plan-v12.js',
	'src/common/editor/unified-exact-render-plan-v9.js',
	'src/common/editor/unified-exact-render-plan.js',
	'src/common/editor/unified-exact-render-timing-authority.js',
	'src/common/editor/unified-exact-retime-authority.js',
	'src/common/editor/video-freeze-v24.js',
	'src/common/editor/video-mask-matte-v24.js',
	'src/common/editor/video-source-professional-characteristics-v25.js',
	'src/common/editor/video-transition-registry.js',
	'src/common/editor/video-transition-resolution.js',
	'src/common/editor/video-transition-v1.js',
	'src/common/editor/video-visual-model-v24.js',
	'src/common/editor/video-visual-preset-v24.js',
	'src/common/editor/video-burn-in-font-subsets.js',
	'src/common/editor/video-caption-burn-in.js',
	'src/common/editor/video-caption-cues.js',
	'src/common/editor/video-delivery-audio-layout.js',
	'src/common/editor/video-delivery-color.js',
	'src/common/editor/video-delivery-quality.js',
	'src/common/editor/video-export-plan-version.js',
	'src/common/editor/video-keyframe-encoder-admission.js',
	'src/common/editor/video-keyframe-export-frame-source.js',
	'src/common/editor/video-keyframe-export-plan-v7-values.js',
	'src/common/editor/video-keyframe-export-plan-v7.js',
	'src/common/editor/video-keyframe-preview-state.js',
	'src/common/editor/video-keyframe-render-state-provider.js',
	'src/common/editor/video-keyframe-state.js',
	'src/common/editor/video-retime-frame-binding.js',
	'src/common/editor/video-retime-frame-dispatch.js',
	'src/common/editor/video-retime-exact-ordinal-authority.js',
	'src/common/editor/video-retime-exact-ordinal-oracle.js',
	'src/common/editor/video-retime-export-domain.js',
	'src/common/editor/video-retime-export-json.js',
	'src/common/editor/video-retime-export-plan.js',
	'src/common/editor/video-retime-output-cadence.js',
	'src/common/editor/video-retime-runtime-mapping.js',
	'src/common/editor/waveform-peak-contract.js',
	'src/common/editor/wavpack/container.js',
].sort());

export async function compileDesktopProjectLibraryRuntime({ repositoryRoot, outputRoot }) {
	const root = resolveRequiredPath(repositoryRoot, 'repository root');
	const output = resolveRequiredPath(outputRoot, 'desktop runtime output');
	if (output === root) throw new TypeError('Desktop runtime output cannot overwrite the repository root');
	await mkdir(output, { recursive: true });
	await run(process.execPath, [
		resolve(root, 'node_modules/typescript/bin/tsc'),
		'--project', resolve(root, 'tsconfig.desktop-runtime.json'),
		'--outDir', output,
	], root);
	await bundleRuntimeHashModules(root, output);
	await stageDesktopBundledAudioRuntime({ repositoryRoot: root, outputRoot: output });
	const files = await listRuntimeFiles(output);
	assertExpectedRuntime(files);
	for (const name of files.filter((file) => /\.[cm]?js$/u.test(file))) {
		assertNoTypeScriptImportSpecifiers(`Desktop runtime ${name}`, await readFile(join(output, name), 'utf8'));
	}
	return Object.freeze({ files: Object.freeze(files) });
}

async function bundleRuntimeHashModules(root, output) {
	for (const name of DESKTOP_RUNTIME_BUNDLED_LEAF_FILES) {
		const outputPath = join(output, name);
		const result = await build({
			entryPoints: [outputPath],
			bundle: true,
			platform: 'node',
			format: 'esm',
			target: 'node26',
			write: false,
			nodePaths: [join(root, 'node_modules')],
			logLevel: 'silent',
		});
		if (result.outputFiles?.length !== 1) {
			throw new Error(`Desktop runtime hash bundling produced an unexpected output set for ${name}`);
		}
		await writeFile(outputPath, result.outputFiles[0].contents);
	}
}

export async function stageDesktopApplicationSources({
	desktopSourceRoot,
	applicationDesktopRoot,
	runtimeRoot,
	productId = 'framescaper',
}) {
	const sourceRoot = resolveRequiredPath(desktopSourceRoot, 'desktop source root');
	const applicationRoot = resolveRequiredPath(applicationDesktopRoot, 'application desktop root');
	const compiledRoot = resolveRequiredPath(runtimeRoot, 'compiled desktop runtime root');
	const runtimeFiles = await listRuntimeFiles(compiledRoot);
	assertExpectedRuntime(runtimeFiles);
	await cp(sourceRoot, applicationRoot, {
		recursive: true,
		filter: (source) => {
			const relativePath = source.slice(sourceRoot.length + 1).replaceAll('\\', '/');
			return source === sourceRoot || extname(source) !== '.ts'
				&& !DESKTOP_ONLY_EXCLUDED_SOURCES.has(relativePath)
				&& desktopProductSourceIncluded(productId, relativePath);
		},
	});
	if (productId === 'soundscaper') {
		await stageSoundscaperDesktopEntrySources(sourceRoot, applicationRoot);
	}
	const stagedSourceFiles = await listRuntimeFiles(applicationRoot);
	const runtimeRoots = productId === 'soundscaper'
		? [...DESKTOP_SOUNDSCAPER_RUNTIME_FILES,
			...await collectApplicationDesktopRuntimeReferences({
				applicationRoot,
				applicationFiles: stagedSourceFiles,
				completeFiles: runtimeFiles,
			})]
		: runtimeFiles;
	const packagedRuntimeFiles = await collectDesktopProductRuntimeClosure({
		compiledRoot,
		completeFiles: runtimeFiles,
		rootFiles: runtimeRoots,
		productId,
	});
	for (const name of packagedRuntimeFiles) {
		const output = join(applicationRoot, 'project-library-runtime', name);
		await mkdir(dirname(output), { recursive: true });
		const transform = desktopProductRuntimeTransform(productId, name);
		if (transform) await writeFile(output,
			transform(await readFile(join(compiledRoot, name), 'utf8')), { flag: 'wx' });
		else await cp(join(compiledRoot, name), output, { errorOnExist: true });
	}
	await stageBundledAudioCodecRuntimeManifest({ desktopRoot: applicationRoot });
	await assertStagedDesktopImportsResolve(applicationRoot);
	assertRuntimePackageImportTargets(productId, packagedRuntimeFiles);
	await bundleSandboxPreload({
		entryPoint: join(sourceRoot, 'soundscaper-project-library-sandbox-preload.ts'),
		cryptoShim: join(sourceRoot, 'soundscaper-project-library-sandbox-crypto.ts'),
		outputPath: join(applicationRoot, SOUNDSCAPER_PRELOAD_BUNDLE),
		productName: 'Soundscaper 1.0',
	});
	if (productId === 'framescaper') {
		await bundleSandboxPreload({
			entryPoint: join(sourceRoot, 'framescaper-capture-sandbox-preload.ts'),
			cryptoShim: join(sourceRoot, 'project-library-sandbox-crypto.ts'),
			outputPath: join(applicationRoot, FRAMESCAPER_CAPTURE_PRELOAD_BUNDLE),
			productName: 'Framescaper Capture',
		});
		await bundleSandboxPreload({
			entryPoint: join(sourceRoot, 'framescaper-web-vcr-sandbox-preload.ts'),
			cryptoShim: join(sourceRoot, 'project-library-sandbox-crypto.ts'),
			outputPath: join(applicationRoot, FRAMESCAPER_WEB_VCR_PRELOAD_BUNDLE),
			productName: 'Framescaper Web VCR',
		});
	}
	if (productId === 'soundscaper') {
		const applicationFiles = await listRuntimeFiles(applicationRoot);
		const textFiles = applicationFiles.filter((name) => /\.(?:c?js|mjs)$/u.test(name));
		assertDesktopProductPackageIsolation(productId, applicationFiles,
			new Map(await Promise.all(textFiles.map(async (name) => [
				name, await readFile(join(applicationRoot, name), 'utf8'),
			]))));
	}
	return Object.freeze({ files: packagedRuntimeFiles });
}

function assertRuntimePackageImportTargets(productId, packagedFiles) {
	const runtimePrefix = './desktop/project-library-runtime/';
	const imports = desktopProductRuntimePackageImports(productId, DESKTOP_RUNTIME_PACKAGE_IMPORTS);
	for (const [alias, target] of Object.entries(imports)) {
		if (!target.startsWith(runtimePrefix)
			|| !packagedFiles.includes(target.slice(runtimePrefix.length))) {
			throw new Error(`Desktop package import ${alias} does not resolve to a shipped runtime member`);
		}
	}
}

async function bundleSandboxPreload({ entryPoint, cryptoShim, outputPath, productName }) {
	await build({
		entryPoints: [entryPoint],
		outfile: outputPath,
		bundle: true,
		platform: 'node',
		format: 'cjs',
		target: 'node26',
		external: ['electron'],
		alias: { 'node:crypto': cryptoShim },
		logLevel: 'silent',
	});
	const source = await readFile(outputPath, 'utf8');
	const required = [...source.matchAll(/require\(["']([^"']+)["']\)/gu)].map((match) => match[1]);
	if (required.length !== 1 || required[0] !== 'electron') {
		throw new Error(`${productName} sandbox preload retained unsupported modules: ${required.join(', ')}`);
	}
}

async function listRuntimeFiles(root, relativeRoot = '') {
	const entries = await readdir(join(root, relativeRoot), { withFileTypes: true });
	const files = [];
	for (const entry of entries) {
		const relativePath = relativeRoot ? `${relativeRoot}/${entry.name}` : entry.name;
		if (entry.isDirectory()) files.push(...await listRuntimeFiles(root, relativePath));
		else if (entry.isFile()) files.push(relativePath);
	}
	return files.sort();
}

function assertExpectedRuntime(files) {
	if (files.length !== DESKTOP_EXPECTED_RUNTIME_FILES.length
		|| files.some((name, index) => name !== DESKTOP_EXPECTED_RUNTIME_FILES[index])) {
		const expected = new Set(DESKTOP_EXPECTED_RUNTIME_FILES);
		const actual = new Set(files);
		const missing = DESKTOP_EXPECTED_RUNTIME_FILES.filter((name) => !actual.has(name));
		const unexpected = files.filter((name) => !expected.has(name));
		throw new Error(
			`Desktop runtime output is incomplete or stale; missing: ${missing.join(', ') || '(none)'}; unexpected: ${unexpected.join(', ') || '(none)'}`,
		);
	}
}

function resolveRequiredPath(value, label) {
	if (typeof value !== 'string' || !value.trim()) throw new TypeError(`Desktop runtime ${label} is required`);
	return resolve(value);
}

function run(command, args, cwd) {
	return new Promise((resolvePromise, reject) => {
		const child = spawn(command, args, { cwd, stdio: 'inherit' });
		child.once('error', reject);
		child.once('exit', (code, signal) => {
			if (code === 0) resolvePromise();
			else reject(new Error(`Desktop runtime compiler exited with ${signal ? `signal ${signal}` : `code ${String(code)}`}`));
		});
	});
}
