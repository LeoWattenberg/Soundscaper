/* SPDX-License-Identifier: AGPL-3.0-only */

import { spawn } from 'node:child_process';
import { cp, mkdir, readdir, readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';

import { build } from 'esbuild';

const FRAMESCAPER_V10_PRELOAD_BUNDLE = 'project-library-v10-sandbox-preload.cjs';

const EXPECTED_RUNTIME_FILES = Object.freeze([
	'desktop/application-lifecycle.js',
	'desktop/linked-original-locator-validation.js',
	'desktop/linked-video-locator-registry.js',
	'desktop/linked-video-locator-store.js',
	'desktop/main-window-recovery.js',
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
	'src/common/editor/folder-bus-v13.js',
	'src/common/editor/indexed-tempo-projector.js',
	'src/common/editor/ixml.js',
	'src/common/editor/musical-map-contract.js',
	'src/common/editor/persisted-audio-effect-validation.js',
	'src/common/editor/project-bext-metadata.js',
	'src/common/editor/project-feature-capabilities.js',
	'src/common/editor/project-feature-capability-profile.js',
	'src/common/editor/project-feature-requirement-types.js',
	'src/common/editor/project-feature-requirements.js',
	'src/common/editor/project-owned-feature-requirements.js',
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
	'src/common/editor/video-effects.js',
	'src/common/editor/video-proxy-attachment-v18.js',
	'src/common/editor/video-retime-curve.js',
	'src/common/editor/video-retime-v16.js',
	'src/common/editor/video-source-characteristics.js',
	'src/common/editor/video-source-time.js',
	'src/common/editor/video-timeline.js',
	'src/common/editor/video-timing-asset-reference.js',
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
]);

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
	const files = await listRuntimeFiles(output);
	assertExpectedRuntime(files);
	for (const name of files) {
		const source = await readFile(join(output, name), 'utf8');
		if (/from ['"].*\.ts['"]/u.test(source)) throw new Error(`Desktop runtime ${name} retained a TypeScript import`);
	}
	return Object.freeze({ files: Object.freeze(files) });
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
	await bundleFramescaperV10SandboxPreload({
		entryPoint: join(sourceRoot, 'project-library-v10-sandbox-preload.ts'),
		cryptoShim: join(sourceRoot, 'project-library-v10-sandbox-crypto.ts'),
		outputPath: join(applicationRoot, FRAMESCAPER_V10_PRELOAD_BUNDLE),
	});
}

async function bundleFramescaperV10SandboxPreload({ entryPoint, cryptoShim, outputPath }) {
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
		throw new Error(`Framescaper V10 sandbox preload retained unsupported modules: ${required.join(', ')}`);
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
