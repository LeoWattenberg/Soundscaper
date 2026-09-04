/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const matrixUrl = new URL('../config/production-licensing-matrix.json', import.meta.url);
const packageUrl = new URL('../package.json', import.meta.url);
const lockUrl = new URL('../package-lock.json', import.meta.url);
const noticesUrl = new URL('../THIRD_PARTY_LICENSES.md', import.meta.url);
const policyUrl = new URL('../docs/production-licensing-policy.md', import.meta.url);
const repositoryUrl = new URL('../', import.meta.url);

const SURFACE_IDS = [
	'web-pages-bundle',
	'web-runtime-assets',
	'electron-renderer',
	'electron-runtime-assets',
	'electron-shell',
	'desktop-release-assets',
];

const ENABLED_FFMPEG_LIBRARIES = [
	'x264',
	'x265',
	'libvpx',
	'libmp3lame',
	'libtheora',
	'libvorbis',
	'libopus',
	'zlib',
	'libwebp',
	'freetype',
	'fribidi',
	'libass',
	'zimg',
];

test('human licensing checks inform the owner without becoming an admission gate', async () => {
	const policy = await readFile(policyUrl, 'utf8');
	assert.match(
		policy,
		/human licensing checks inform the repository owner's release decision/iu,
	);
	assert.doesNotMatch(policy, /stable 1\.0 admission|notarization/iu);
	assert.doesNotMatch(policy, /config\/production-legal-review\.json/iu);
	assert.match(policy, /machine.*artifact.*payload.*platform.*containment.*consent.*fail closed/isu);
});

test('production licensing matrix is versioned and distinguishes every distribution surface', async () => {
	const matrix = await readJson(matrixUrl);
	assert.equal(Object.hasOwn(matrix, 'humanLegalReview'), false);
	assert.equal(Object.hasOwn(matrix, 'releaseGates'), false);
	assert.ok(Array.isArray(matrix.distributionChecks));

	assert.equal(matrix.schemaVersion, 1);
	assert.match(matrix.groundedAt, /^\d{4}-\d{2}-\d{2}$/u);
	assert.equal(matrix.policyDocument, 'docs/production-licensing-policy.md');
	assert.equal(matrix.lockfile.path, 'package-lock.json');
	assert.equal(matrix.lockfile.lockfileVersion, 3);
	assert.equal(
		matrix.lockfile.productionClosureRule,
		'packages[node_modules/**].dev !== true, excluding linked workspaces declared in root devDependencies',
	);
	assert.deepEqual(matrix.distributionSurfaces.map(({ id }) => id), SURFACE_IDS);

	for (const surface of matrix.distributionSurfaces) {
		assert.match(surface.artifactStatus, /^(distributed|build-only|blocked)$/u);
		assert.match(surface.noticeDeliveryStatus, /^(implemented|blocked|not-applicable)$/u);
		assert.ok(surface.evidence.length > 0, `${surface.id} needs evidence`);
		await assertEvidence(surface.evidence);
	}
});

test('matrix exactly covers the package-lock v3 non-development runtime closure', async () => {
	const [matrix, packageMetadata, lock, notices] = await Promise.all([
		readJson(matrixUrl),
		readJson(packageUrl),
		readJson(lockUrl),
		readFile(noticesUrl, 'utf8'),
	]);
	const expected = productionClosure(lock, packageMetadata);
	const actual = matrix.npmProductionClosure.map((entry) => ({
		lockPath: entry.lockPath,
		name: entry.name,
		version: entry.version,
		license: entry.license,
		direct: entry.direct,
	}));

	assert.equal(lock.lockfileVersion, 3);
	assert.deepEqual(actual, expected);
	assert.equal(new Set(actual.map(({ lockPath }) => lockPath)).size, actual.length);
	for (const dependency of matrix.npmProductionClosure) {
		assert.ok(notices.includes(dependency.noticeMarker), `${dependency.name} notice marker is missing`);
		assert.ok(Array.isArray(dependency.artifactSurfaces));
		for (const surface of dependency.artifactSurfaces) assert.ok(SURFACE_IDS.includes(surface));
		await assertEvidence(dependency.evidence);
	}

	for (const name of ['@ffmpeg/core', '@ffmpeg/ffmpeg', '@ffmpeg/types']) {
		assert.equal(lock.packages[`node_modules/${name}`].dev, true, `${name} must stay development-only`);
		assert.equal(matrix.npmProductionClosure.some((dependency) => dependency.name === name), false);
	}
	for (const name of ['@ffmpeg/core', '@ffmpeg/ffmpeg']) {
		assert.equal(packageMetadata.devDependencies[name], lock.packages[`node_modules/${name}`].version);
	}
	const mediabunny = matrix.npmProductionClosure.find(({ name }) => name === 'mediabunny');
	assert.equal(mediabunny.role, 'browser-media-container-runtime');
	assert.deepEqual(mediabunny.artifactSurfaces, ['web-pages-bundle', 'electron-renderer']);
	const nobleHashes = matrix.npmProductionClosure.find(({ name }) => name === '@noble/hashes');
	assert.equal(nobleHashes.role, 'application-runtime');
	assert.deepEqual(nobleHashes.artifactSurfaces, [
		'web-pages-bundle', 'electron-renderer', 'electron-shell',
	]);
	for (const name of [
		'sherpa-onnx-node', 'sherpa-onnx-darwin-arm64', 'sherpa-onnx-linux-arm64',
		'sherpa-onnx-linux-x64', 'sherpa-onnx-win-x64',
	]) {
		const runtime = matrix.npmProductionClosure.find((dependency) => dependency.name === name);
		assert.deepEqual(runtime.artifactSurfaces, ['electron-runtime-assets', 'desktop-release-assets'], name);
	}
	for (const name of ['sherpa-onnx-darwin-x64', 'sherpa-onnx-win-ia32']) {
		const unsupported = matrix.npmProductionClosure.find((dependency) => dependency.name === name);
		assert.deepEqual(unsupported.artifactSurfaces, [], name);
	}
	for (const id of ['electron-runtime-assets', 'desktop-release-assets']) {
		const surface = matrix.distributionSurfaces.find((candidate) => candidate.id === id);
		assert.match(surface.description, /sherpa-onnx/iu);
		assert.ok(surface.evidence.includes('config/assistance-native-runtime-manifest.json'));
	}
	for (const name of ['@types/dom-mediacapture-transform', '@types/dom-webcodecs']) {
		const types = matrix.npmProductionClosure.find((dependency) => dependency.name === name);
		assert.equal(types.role, 'transitive-types-only');
		assert.deepEqual(types.artifactSurfaces, []);
	}
});

test('shipped Electron is tracked separately from the non-development npm closure', async () => {
	const [matrix, packageMetadata, lock, builderConfig] = await Promise.all([
		readJson(matrixUrl),
		readJson(packageUrl),
		readJson(lockUrl),
		readFile(new URL('../electron-builder.config.cjs', import.meta.url), 'utf8'),
	]);
	const electron = lock.packages['node_modules/electron'];

	assert.deepEqual(matrix.shippedDevelopmentDependencies, [{
		name: 'electron',
		lockPath: 'node_modules/electron',
		version: electron.version,
		license: electron.license,
		declaredVersion: packageMetadata.devDependencies.electron,
		role: 'packaged-desktop-runtime',
		artifactSurfaces: ['electron-shell'],
		noticeMarker: `Electron ${electron.version}`,
		evidence: [
			'package-lock.json',
			'electron-builder.config.cjs',
			'THIRD_PARTY_LICENSES.md',
		],
	}]);
	assert.equal(electron.dev, true);
	assert.match(builderConfig, /!node_modules\/\*\*\/\*/u);
	assert.match(builderConfig, /THIRD_PARTY_LICENSES\.md/u);
	await assertEvidence(matrix.shippedDevelopmentDependencies[0].evidence);
});

test('runtime provenance entries and distribution checks fail closed without claiming legal clearance', async () => {
	const matrix = await readJson(matrixUrl);
	const checks = new Map(matrix.distributionChecks.map((check) => [check.id, check]));
	const provenance = new Map(matrix.runtimeProvenance.map((artifact) => [artifact.id, artifact]));

	assert.equal(checks.size, matrix.distributionChecks.length, 'distribution check IDs must be unique');
	assert.equal(checks.get('desktop-notice-delivery').status, 'implemented');
	assert.equal(checks.get('desktop-bundled-codec-corresponding-source').status, 'implemented');
	assert.equal(checks.get('web-bundled-codec-corresponding-source').status, 'blocked');
	assert.equal(checks.get('ffmpeg-runtime-manifest-integrity').status, 'implemented');
	assert.equal(checks.get('web-notice-delivery').status, 'blocked');
	assert.equal(checks.get('ffmpeg-enabled-library-corresponding-source').status, 'blocked');
	assert.equal(checks.get('ffmpeg-enabled-codec-patent-review').status, 'blocked');
	for (const path of ['scripts/desktop-after-pack.mjs', 'tests/desktop-packaged-ffmpeg-runtime.test.js']) {
		assert.ok(checks.get('desktop-notice-delivery').evidence.includes(path),
			'desktop-notice-delivery must retain post-copy verification evidence');
	}
	for (const path of [
		'config/desktop-bundled-codec-corresponding-source.json',
		'scripts/lib/desktop-bundled-codec-corresponding-source.mjs',
		'tests/desktop-bundled-codec-corresponding-source.test.js',
	]) {
		assert.ok(checks.get('desktop-bundled-codec-corresponding-source').evidence.includes(path),
			'desktop source delivery must retain exact assembly evidence');
	}
	const desktopRelease = matrix.distributionSurfaces.find(({ id }) => id === 'desktop-release-assets');
	assert.match(desktopRelease.description, /preferred corresponding-source ZIP/iu);
	assert.ok(checks.get('ffmpeg-runtime-manifest-integrity').evidence.includes('scripts/publish-runtime-assets.mjs'));
	assert.equal(checks.get('ffmpeg-runtime-manifest-integrity').evidence.includes('scripts/desktop-prepare.mjs'), false);
	assert.deepEqual(matrix.ffmpeg.enabledExternalLibraries, ENABLED_FFMPEG_LIBRARIES);
	assert.equal(matrix.ffmpeg.runtimeManifest, 'config/ffmpeg-runtime-manifest.json');
	assert.equal(matrix.ffmpeg.correspondingSourceManifest, 'desktop/ffmpeg-corresponding-source.json');
	assert.match(checks.get('ffmpeg-enabled-library-corresponding-source').blocker, /every enabled library/u);
	assert.match(checks.get('ffmpeg-enabled-codec-patent-review').blocker, /jurisdiction/u);
	assert.match(checks.get('web-notice-delivery').blocker, /web route|web artifact/u);
	assert.match(checks.get('web-bundled-codec-corresponding-source').blocker,
		/preferred corresponding source.*relink/iu);
	assert.equal(matrix.npmProductionClosure.some(({ name }) => name.startsWith('@ffmpeg/')), false);
	assert.deepEqual(provenance.get('ffmpeg-core-wasm').artifactSurfaces, []);
	assert.equal(
		provenance.get('ffmpeg-core-wasm').provenanceKind,
		'retained-legacy-publication-audit-tooling-not-browser-runtime',
	);
	assert.equal(matrix.ffmpeg.dependencyScope, 'development-only-legacy-publication-audit-tooling');
	assert.deepEqual(matrix.ffmpeg.artifactSurfaces, []);
	const codecPolicy = matrix.desktopCodecPolicy;
	assert.equal(codecPolicy.scope,
		'soundscaper-general-codec-provider-layer-excluding-electron-framework-internals-and-the-exact-authenticated-framescaper-media-host');
	assert.deepEqual(codecPolicy.artifactSurfaces,
		['electron-renderer', 'electron-runtime-assets', 'electron-shell', 'desktop-release-assets']);
	assert.deepEqual(
		[codecPolicy.bundledFfmpeg, codecPolicy.bundledLibav, codecPolicy.bundledFfmpegWasm],
		[false, false, false],
	);
	assert.deepEqual(codecPolicy.providerOrder, ['bundled-reviewed-codecs', 'os', 'external-user-install']);
	assert.deepEqual(Object.keys(codecPolicy.bundledProviders), [
		'flac', 'opus', 'vorbis', 'wavpack', 'mpg123', 'lame', 'twolame',
	]);
	const expectedAudioPayloads = {
		flac: ['1.5.0', 'BSD-3-Clause', 153076, '0f703571f95e37c24ad68577163ea56b4a9dd7d5576760700b482369e924f986'],
		opus: ['libopus-1.6.1+libogg-1.3.6', 'BSD-3-Clause', 385914, 'c972c5019a7f56dfe9c712cb15c25ebb54b55b16b19b3b99a5b02c31ef311685'],
		vorbis: ['libvorbis-1.3.7+libogg-1.3.6', 'BSD-3-Clause', 523227, 'c03037c33f35dbf85e1e963058156399b995b2dedb5479f6eb3f3b30148eeee5'],
		wavpack: ['5.9.0', 'BSD-3-Clause', 145537, 'c547aca2d5584d643cea4a9d856f9672b9f621fae518ef99444d94500c31f908'],
		mpg123: ['1.33.7', 'LGPL-2.1-only', 172329, 'd2b5686a16141ec97dbeb4e4f2a1ce28b756dd3eaf6438b31379356c8dd958ae'],
		lame: ['4.0', 'LGPL-2.0-or-later', 213293, 'd624f2202ce5a560ca38bc156cb80441fe93ec799e59a35d0f9379a990256123'],
		twolame: ['0.4.0', 'LGPL-2.1-or-later', 146820, 'b4b166bed688504b548adcee02cda391d4d8b25a44aec914c3fe1082f466ed1b'],
	};
	for (const [id, [version, license, byteLength, sha256]] of Object.entries(expectedAudioPayloads)) {
		const provider = codecPolicy.bundledProviders[id];
		assert.equal(provider.status, 'admitted', id);
		assert.deepEqual([provider.version, provider.license, provider.byteLength, provider.sha256],
			[version, license, byteLength, sha256], id);
		assert.deepEqual(provider.targets, ['linux-x64', 'linux-arm64', 'mac-arm64', 'win-x64', 'win-arm64']);
		assert.equal(provider.targets.includes('mac-x64'), false, id);
		assert.equal(provider.verification, 'exact-reviewed-slice-no-patent-clearance', id);
	}
	assert.deepEqual(codecPolicy.firstPartyPcm.containers, ['wav', 'bwf', 'bw64', 'aiff']);
	assert.match(codecPolicy.firstPartyPcm.libsndfile, /not-bundled-redundant/u);
	assert.equal(codecPolicy.operatingSystemProvider.payloadStatus,
		'target-native-ci-build-required-mac-arm64-win-x64-win-arm64');
	assert.equal(codecPolicy.operatingSystemProvider.payloadManifest,
		'runtime/native/soundscaper-os-audio-codec/<target>/os-audio-codec-native-payload-manifest.json');
	assert.deepEqual(codecPolicy.operatingSystemProvider.windows.targets, ['win-x64', 'win-arm64']);
	assert.deepEqual(codecPolicy.operatingSystemProvider.macos.targets, ['mac-arm64']);
	assert.match(codecPolicy.externalFfmpegProvider.versionRange, />=4\.4\.0 <10\.0\.0/u);
	assert.equal(codecPolicy.externalFfmpegProvider.redistributed, false);
	assert.deepEqual(codecPolicy.externalFfmpegProvider.audioRequestLimits,
		{ inputBytes: 32 * 1024 * 1024, outputBytes: 128 * 1024 * 1024 });
	assert.deepEqual(codecPolicy.bundledExecution, {
		process: 'fresh-one-shot-electron-utility-process-per-canary-preflight-and-execute',
		authenticatedClosure: 'complete-transitive-javascript-module-closure-and-exact-wasm-bytes',
		maximumActiveJobs: 4,
		startupCanaryBatchSize: 4,
		requestScratch: 'private-main-owned-sibling-input-output-files',
		defaultDurationMs: 30_000,
		maximumDurationMs: 5 * 60_000,
		canaryDurationMs: 5_000,
		cancellation: 'kill-utility-process-and-await-exit-or-kill-deadline',
		residualLimit: 'whole-buffer-copies-wasm-memory-rss-and-cpu-are-not-one-aggregate-reservation',
	});
	assert.deepEqual(codecPolicy.externalFfmpegProvider.video.formats, {
		mp4: 'keyed-rgba-h264-libx264-aac',
		webm: 'keyed-rgba-vp9-libvpx-vp9-opus-libopus',
	});
	assert.equal(codecPolicy.externalFfmpegProvider.video.maximumSessions, 2);
	assert.equal(codecPolicy.externalFfmpegProvider.video.maximumSessionsPerOwner, 1);
	assert.equal(codecPolicy.externalFfmpegProvider.video.maximumIpcChunkBytes, 1024 * 1024);
	assert.equal(codecPolicy.externalFfmpegProvider.video.maximumOutputBytes, 512 * 1024 * 1024);
	assert.equal(codecPolicy.externalFfmpegProvider.video.maximumContractOutputBytes, 2 * 1024 ** 3);
	assert.match(codecPolicy.externalFfmpegProvider.video.compatibilityCanary,
		/live-16x16-one-frame-rgba-plus-48khz-stereo-audio.*finite-container.*exact-ffprobe-two-track-codec-geometry-inspection/u);
	assert.equal(codecPolicy.videoProvider.bundled.status, 'disabled');
	assert.equal(codecPolicy.videoProvider.operatingSystem.status, 'disabled');
	assert.match(codecPolicy.videoProvider.external.webm, /VP9\/Opus.*not-AV1/iu);
	assert.match(codecPolicy.videoProvider.av1, /no-dav1d.*execution-path.*fail-closed/iu);
	assert.deepEqual(codecPolicy.videoProvider.candidateResearch, ['dav1d', 'svt-av1', 'libaom']);
	assert.match(codecPolicy.executionStatus.bundledExecutionModel,
		/authenticated.*one-shot.*utility.*max-four/iu);
	assert.match(codecPolicy.executionStatus.externalFfmpeg,
		/audio.*keyed-RGBA.*H264\/AAC MP4.*VP9\/Opus WebM/iu);
	assert.equal(codecPolicy.executionStatus.receiptTiming, 'null-no-timing-claim');
	assert.equal(codecPolicy.patentPosition,
		'No patent clearance or non-infringement representation is made for any codec, provider, use, or territory.');
	for (const path of [
		'desktop/bundled-audio-codec-helper-process.ts',
		'desktop/bundled-audio-codec-operation-runner.ts',
		'desktop/bundled-audio-codec-runtime-payload.mjs',
		'desktop/external-ffmpeg-video-operation-service.ts',
		'desktop/external-ffmpeg-video-verification.ts',
		'desktop/external-ffmpeg-video-canary-inspection.ts',
		'desktop/desktop-video-codec-main-ipc.ts',
		'src/common/editor/desktop-video-codec-runtime.ts',
		'tests/desktop-bundled-audio-codec-operation-runner.test.ts',
		'tests/external-ffmpeg-video-verification.test.ts',
		'tests/external-ffmpeg-video-canary-inspection.test.ts',
	]) assert.ok(codecPolicy.evidence.includes(path), `desktop codec evidence needs ${path}`);
	await assertEvidence(codecPolicy.evidence);
	for (const id of [
		'flac-1-5-0-desktop-wasm', 'opus-1-6-1-ogg-1-3-6-desktop-wasm',
		'vorbis-1-3-7-ogg-1-3-6-desktop-wasm', 'mpg123-1-33-7-desktop-wasm',
		'lame-4-0-desktop-wasm', 'twolame-0-4-0-desktop-wasm',
	]) {
		assert.equal(provenance.get(id).status, 'documented', id);
		assert.deepEqual(provenance.get(id).artifactSurfaces,
			['web-pages-bundle', 'electron-renderer', 'electron-runtime-assets', 'desktop-release-assets'], id);
	}
	assert.deepEqual(provenance.get('wavpack-wasm'), {
		id: 'wavpack-wasm',
		status: 'documented',
		artifactSurfaces: ['web-pages-bundle', 'electron-renderer', 'electron-runtime-assets', 'desktop-release-assets'],
		provenanceKind: 'pinned-in-tree-wasm-and-desktop-bundled-codec-provider',
		upstream: 'WavPack 5.9.0 commit 5803634a030e2a11dba602ba057b89cc34486c67',
		license: 'BSD-3-Clause',
		byteLength: 145537,
		sha256: 'c547aca2d5584d643cea4a9d856f9672b9f621fae518ef99444d94500c31f908',
		providerRole: 'soundscaper-bundled-wavpack-float32-encode-decode',
		compressionLevel: 2,
		targets: ['linux-x64', 'linux-arm64', 'mac-arm64', 'win-x64', 'win-arm64'],
		verification: 'Exact reviewed float32 WavPack encode/decode slice with strict bounded parsing, startup canary, and a narrow stock WavPack 5.9.0 decoder witness. No patent-clearance or non-infringement claim is made.',
		evidence: [
			'src/common/editor/wavpack/source-manifest.json',
			'src/common/editor/wavpack/NOTICE.md',
			'src/common/editor/desktop-wavpack-codec-profile.ts',
			'src/common/editor/controller/desktop-audio-export-capability.ts',
			'scripts/audit-wavpack-wasm.mjs',
			'scripts/lib/desktop-bundled-wavpack-runtime.mjs',
			'desktop/bundled-wavpack-audio-codec-runtime.ts',
			'desktop/bundled-wavpack-stream.ts',
			'desktop/desktop-audio-codec-registration.mjs',
			'tests/audio-editor-wavpack.test.js',
			'tests/audio-editor-desktop-export-capability.test.ts',
			'tests/audio-editor-desktop-export-codec-model.test.ts',
			'tests/audio-editor-desktop-export-dialog-capability.test.js',
			'tests/desktop-bundled-wavpack-audio-codec-runtime.test.ts',
			'tests/desktop-audio-codec-runtime-staging.test.js',
			'docs/desktop-codec-provider-plan.md',
			'THIRD_PARTY_LICENSES.md',
		],
	});
	assert.deepEqual(provenance.get('electron-alternate-ffmpeg-framework-43-1-1'), {
		id: 'electron-alternate-ffmpeg-framework-43-1-1',
		status: 'documented',
		artifactSurfaces: ['electron-shell', 'desktop-release-assets'],
		provenanceKind: 'electron-upstream-alternate-framework-library-verified-after-pack',
		upstreamIntent: "Electron's matching alternate release asset is intended upstream to omit proprietary codec support.",
		providerRole: 'electron-chromium-framework-internal-not-soundscaper-codec-provider',
		verification: 'Exact target, file type, byte length, and SHA-256 are verified. No complete codec inventory, behavior, absence-of-patent-exposure, or patent-clearance claim is made.',
		targets: ['linux-x64', 'linux-arm64', 'mac-arm64', 'win-x64', 'win-arm64'],
		evidence: [
			'electron-builder.config.cjs',
			'config/electron-alternate-ffmpeg-manifest.json',
			'scripts/lib/electron-alternate-ffmpeg.mjs',
			'scripts/desktop-after-pack.mjs',
			'tests/desktop-electron-alternate-ffmpeg.test.js',
			'THIRD_PARTY_LICENSES.md',
		],
	});
	assert.equal(matrix.desktopCodecPolicy.electronFrameworkFfmpeg.targets.includes('mac-x64'), false);
	assert.deepEqual(provenance.get('reviewed-effect-utility-gain-wasm'), {
		id: 'reviewed-effect-utility-gain-wasm',
		status: 'documented',
		artifactSurfaces: ['web-pages-bundle', 'electron-renderer'],
		provenanceKind: 'repository-owned-inline-conformance-bytes',
		license: 'AGPL-3.0-only',
		evidence: [
			'package.json',
			'LICENSE',
			'src/common/editor/reviewed-effects/utility-gain-package.ts',
			'tests/audio-editor-reviewed-effects.test.ts',
		],
	});

	for (const artifact of matrix.runtimeProvenance) {
		assert.match(artifact.status, /^(documented|blocked)$/u);
		assert.ok(artifact.evidence.length > 0, `${artifact.id} needs evidence`);
		await assertEvidence(artifact.evidence);
	}
	for (const check of matrix.distributionChecks) await assertEvidence(check.evidence);
	assert.doesNotMatch(JSON.stringify(matrix), /legally[- ]cleared|legal approval|patent[- ]free/iu);
});

function productionClosure(lock, packageMetadata) {
	const directDependencies = new Set(Object.keys(packageMetadata.dependencies || {}));
	const developmentDependencies = new Set(Object.keys(packageMetadata.devDependencies || {}));
	return Object.entries(lock.packages)
		.filter(([path, entry]) => {
			if (!path.startsWith('node_modules/') || entry.dev === true) return false;
			const name = packageNameFromLockPath(path);
			return entry.link !== true || !developmentDependencies.has(name);
		})
		.map(([lockPath, entry]) => {
			const name = packageNameFromLockPath(lockPath);
			return {
				lockPath,
				name,
				version: entry.version,
				license: entry.license,
				direct: directDependencies.has(name),
			};
		})
		.sort((left, right) => left.lockPath.localeCompare(right.lockPath));
}

function packageNameFromLockPath(lockPath) {
	return lockPath.slice(lockPath.lastIndexOf('node_modules/') + 'node_modules/'.length);
}

async function assertEvidence(references) {
	for (const reference of references) {
		const [path] = reference.split('#');
		await assert.doesNotReject(access(new URL(path, repositoryUrl)), `Missing evidence: ${reference}`);
	}
}

async function readJson(url) {
	return JSON.parse(await readFile(url, 'utf8'));
}
