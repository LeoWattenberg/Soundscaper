/* SPDX-License-Identifier: AGPL-3.0-only */

import { spawn } from 'node:child_process';
import { cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';

import { build } from 'esbuild';

const FRAMESCAPER_V10_PRELOAD_BUNDLE = 'project-library-v10-sandbox-preload.cjs';
const FRAMESCAPER_CAPTURE_PRELOAD_BUNDLE = 'framescaper-capture-sandbox-preload.cjs';
const SOUNDSCAPER_V10_PRELOAD_BUNDLE = 'soundscaper-project-library-v10-sandbox-preload.cjs';

// Staged desktop sources may not import TypeScript specifiers: the packaged
// application ships no `src/` tree and no TypeScript loader. Modules that need
// a `src/common` member resolve it through a package-imports alias that the
// repository maps to the TypeScript source and the staged application
// manifest maps to the compiled runtime member that already ships.
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

const EXPECTED_RUNTIME_FILES = Object.freeze([
	'desktop/application-lifecycle.js',
	'desktop/assistance-main-ipc.js',
	'desktop/assistance-service.js',
	'desktop/assistance-sherpa-recognizer.js',
	'desktop/assistance-speech-runtime.js',
	'desktop/framescaper-capture-desktop-port.js',
	'desktop/framescaper-capture-main-channels.js',
	'desktop/framescaper-capture-session-security.js',
	'desktop/helper-contract.js',
	'desktop/helper-job-grant.js',
	'desktop/helper-probe-service.js',
	'desktop/helper-supervisor.js',
	'desktop/native-helper-service.js',
	'desktop/native-helper-results.js',
	'desktop/native-addon-payload.js',
	'desktop/plugin-scan-results.js',
	'desktop/plugin-scan-service.js',
	'desktop/plugin-registry.js',
	'desktop/plugin-quarantine.js',
	'desktop/plugin-consent.js',
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
	const files = await listRuntimeFiles(output);
	assertExpectedRuntime(files);
	for (const name of files) {
		const source = await readFile(join(output, name), 'utf8');
		assertNoTypeScriptImportSpecifiers(`Desktop runtime ${name}`, source);
	}
	return Object.freeze({ files: Object.freeze(files) });
}

async function bundleRuntimeHashModules(root, output) {
	for (const name of [
		'src/common/editor/audio-track-freeze-v21.js',
		'src/common/editor/pffft.js',
		'src/common/editor/scape-archive-media.js',
		'src/common/editor/video-timing-asset.js',
		'src/soundscaper/editor-project-feature-requirements-v21.js',
	]) {
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
}) {
	const sourceRoot = resolveRequiredPath(desktopSourceRoot, 'desktop source root');
	const applicationRoot = resolveRequiredPath(applicationDesktopRoot, 'application desktop root');
	const compiledRoot = resolveRequiredPath(runtimeRoot, 'compiled desktop runtime root');
	const runtimeFiles = await listRuntimeFiles(compiledRoot);
	assertExpectedRuntime(runtimeFiles);
	await cp(sourceRoot, applicationRoot, {
		recursive: true,
		filter: (source) => extname(source) !== '.ts',
	});
	await cp(compiledRoot, join(applicationRoot, 'project-library-runtime'), { recursive: true });
	await assertNoStagedTypeScriptImports(applicationRoot);
	assertRuntimePackageImportTargets();
	await bundleV10SandboxPreload({
		entryPoint: join(sourceRoot, 'project-library-v10-sandbox-preload.ts'),
		cryptoShim: join(sourceRoot, 'project-library-v10-sandbox-crypto.ts'),
		outputPath: join(applicationRoot, FRAMESCAPER_V10_PRELOAD_BUNDLE),
		productName: 'Framescaper',
	});
	await bundleV10SandboxPreload({
		entryPoint: join(sourceRoot, 'soundscaper-project-library-v10-sandbox-preload.ts'),
		cryptoShim: join(sourceRoot, 'project-library-v10-sandbox-crypto.ts'),
		outputPath: join(applicationRoot, SOUNDSCAPER_V10_PRELOAD_BUNDLE),
		productName: 'Soundscaper',
	});
	await bundleV10SandboxPreload({
		entryPoint: join(sourceRoot, 'framescaper-capture-sandbox-preload.ts'),
		cryptoShim: join(sourceRoot, 'project-library-v10-sandbox-crypto.ts'),
		outputPath: join(applicationRoot, FRAMESCAPER_CAPTURE_PRELOAD_BUNDLE),
		productName: 'Framescaper Capture',
	});
}

async function assertNoStagedTypeScriptImports(applicationRoot) {
	const staged = await listRuntimeFiles(applicationRoot);
	for (const name of staged) {
		if (!/\.[cm]?js$/u.test(name)) continue;
		const source = await readFile(join(applicationRoot, name), 'utf8');
		assertNoTypeScriptImportSpecifiers(`Staged desktop source ${name}`, source);
	}
}

function assertNoTypeScriptImportSpecifiers(label, source) {
	if (/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)['"][^'"]*\.[cm]?tsx?['"]/u.test(source)) {
		throw new Error(`${label} retained a TypeScript import`);
	}
}

function assertRuntimePackageImportTargets() {
	const runtimePrefix = './desktop/project-library-runtime/';
	for (const [alias, target] of Object.entries(DESKTOP_RUNTIME_PACKAGE_IMPORTS)) {
		if (!target.startsWith(runtimePrefix)
			|| !EXPECTED_RUNTIME_FILES.includes(target.slice(runtimePrefix.length))) {
			throw new Error(`Desktop package import ${alias} does not resolve to a shipped runtime member`);
		}
	}
}

async function bundleV10SandboxPreload({ entryPoint, cryptoShim, outputPath, productName }) {
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
		throw new Error(`${productName} V10 sandbox preload retained unsupported modules: ${required.join(', ')}`);
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
	if (files.length !== EXPECTED_RUNTIME_FILES.length
		|| files.some((name, index) => name !== EXPECTED_RUNTIME_FILES[index])) {
		throw new Error(`Desktop runtime output is incomplete or stale: ${files.join(', ')}`);
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
