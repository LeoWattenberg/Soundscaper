/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const matrixUrl = new URL('../config/production-licensing-matrix.json', import.meta.url);
const packageUrl = new URL('../package.json', import.meta.url);
const lockUrl = new URL('../package-lock.json', import.meta.url);
const noticesUrl = new URL('../THIRD_PARTY_LICENSES.md', import.meta.url);
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

const FUTURE_GATE_IDS = [
	'local-models',
	'native-audio',
	'native-codecs',
	'native-plugins',
	'web-effect-packages',
];

test('production licensing matrix is versioned and distinguishes every distribution surface', async () => {
	const matrix = await readJson(matrixUrl);

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

	const types = matrix.npmProductionClosure.find(({ name }) => name === '@ffmpeg/types');
	assert.equal(types.role, 'transitive-types-only');
	assert.deepEqual(types.artifactSurfaces, []);
	assert.equal(matrix.npmProductionClosure.some(({ name }) => name === '@ffmpeg/util'), false);
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

test('runtime provenance entries and release gates fail closed without claiming legal clearance', async () => {
	const matrix = await readJson(matrixUrl);
	const gates = new Map(matrix.releaseGates.map((gate) => [gate.id, gate]));
	const provenance = new Map(matrix.runtimeProvenance.map((artifact) => [artifact.id, artifact]));

	assert.equal(gates.size, matrix.releaseGates.length, 'release gate IDs must be unique');
	assert.equal(gates.get('desktop-notice-delivery').status, 'implemented');
	assert.equal(gates.get('ffmpeg-runtime-manifest-integrity').status, 'implemented');
	assert.equal(gates.get('web-notice-delivery').status, 'blocked');
	assert.equal(gates.get('ffmpeg-enabled-library-corresponding-source').status, 'blocked');
	assert.equal(gates.get('ffmpeg-enabled-codec-patent-review').status, 'blocked');
	for (const path of ['scripts/desktop-after-pack.mjs', 'tests/desktop-packaged-ffmpeg-runtime.test.js']) {
		assert.ok(gates.get('desktop-notice-delivery').evidence.includes(path),
			'desktop-notice-delivery must retain post-copy verification evidence');
	}
	assert.ok(gates.get('ffmpeg-runtime-manifest-integrity').evidence.includes('scripts/publish-runtime-assets.mjs'));
	assert.equal(gates.get('ffmpeg-runtime-manifest-integrity').evidence.includes('scripts/desktop-prepare.mjs'), false);
	assert.deepEqual(matrix.ffmpeg.enabledExternalLibraries, ENABLED_FFMPEG_LIBRARIES);
	assert.equal(matrix.ffmpeg.runtimeManifest, 'config/ffmpeg-runtime-manifest.json');
	assert.equal(matrix.ffmpeg.correspondingSourceManifest, 'desktop/ffmpeg-corresponding-source.json');
	assert.match(gates.get('ffmpeg-enabled-library-corresponding-source').blocker, /every enabled library/u);
	assert.match(gates.get('ffmpeg-enabled-codec-patent-review').blocker, /jurisdiction/u);
	assert.match(gates.get('web-notice-delivery').blocker, /web route|web artifact/u);
	const ffmpegCore = matrix.npmProductionClosure.find(({ name }) => name === '@ffmpeg/core');
	const ffmpegWrapper = matrix.npmProductionClosure.find(({ name }) => name === '@ffmpeg/ffmpeg');
	assert.deepEqual(ffmpegCore.artifactSurfaces, ['web-runtime-assets']);
	assert.deepEqual(ffmpegWrapper.artifactSurfaces, ['web-pages-bundle']);
	assert.deepEqual(provenance.get('ffmpeg-core-wasm').artifactSurfaces, ['web-runtime-assets']);
	assert.deepEqual(matrix.desktopCodecPolicy, {
		scope: 'soundscaper-application-codec-provider-layer-excluding-electron-framework-internals',
		artifactSurfaces: ['electron-renderer', 'electron-runtime-assets', 'electron-shell', 'desktop-release-assets'],
		bundledFfmpeg: false,
		bundledLibav: false,
		bundledFfmpegWasm: false,
		electronFrameworkFfmpeg: {
			status: 'distributed-verified-framework-exception',
			electronVersion: '43.1.1',
			profile: 'electron-alternate-without-proprietary-codecs',
			upstreamIntent: 'omit-proprietary-codec-support',
			providerTier: false,
			manifest: 'config/electron-alternate-ffmpeg-manifest.json',
			targets: ['linux-x64', 'linux-arm64', 'mac-arm64', 'win-x64', 'win-arm64'],
			qualification: 'exact-bytes-only-no-codec-or-patent-clearance',
		},
		providerOrder: ['bundled-open-codecs', 'os', 'external-user-install'],
		bundledProviders: {
			wavpack: {
				status: 'admitted',
				version: '5.9.0',
				license: 'BSD-3-Clause',
				directions: ['encode', 'decode'],
				container: 'wavpack',
				codec: 'wavpack',
				sampleFormat: 'f32',
				compressionLevel: 2,
				byteLength: 145537,
				sha256: 'c547aca2d5584d643cea4a9d856f9672b9f621fae518ef99444d94500c31f908',
				targets: ['linux-x64', 'linux-arm64', 'mac-arm64', 'win-x64', 'win-arm64'],
				startupAdmission: ['exact-byte-length', 'sha256', 'encode-parse-decode-canary'],
				streamValidation: 'strict-bounded-reviewed-float32-profile',
				interoperability: 'narrow-stock-wvunpack-5-9-0-witness',
				qualification: 'exact-reviewed-slice-no-patent-clearance',
			},
		},
		executionStatus: {
			firstPartyPcmReaders: 'existing-application-code',
			bundledCompressedCodecs: 'wavpack-f32-admitted-all-others-unqualified-fail-closed',
			operatingSystemCodecs: 'unqualified-fail-closed',
			externalFfmpeg: 'user-installed-no-redistribution',
		},
		patentPosition: 'No patent clearance or non-infringement representation is made for any codec, provider, use, or territory.',
		evidence: [
			'scripts/lib/desktop-codec-policy.mjs',
			'scripts/lib/desktop-renderer-codec-audit.mjs',
			'scripts/desktop-prepare.mjs',
			'scripts/desktop-before-pack.mjs',
			'scripts/desktop-after-pack.mjs',
			'scripts/desktop-release-assets.mjs',
			'electron-builder.config.cjs',
			'config/electron-alternate-ffmpeg-manifest.json',
			'scripts/lib/electron-alternate-ffmpeg.mjs',
			'tests/desktop-electron-alternate-ffmpeg.test.js',
			'src/common/editor/wavpack/source-manifest.json',
			'src/common/editor/wavpack/NOTICE.md',
			'src/common/editor/desktop-wavpack-codec-profile.ts',
			'src/common/editor/controller/desktop-audio-export-capability.ts',
			'scripts/audit-wavpack-wasm.mjs',
			'scripts/lib/desktop-bundled-wavpack-runtime.mjs',
			'desktop/bundled-wavpack-audio-codec-runtime.ts',
			'desktop/bundled-wavpack-stream.ts',
			'tests/desktop-bundled-wavpack-audio-codec-runtime.test.ts',
			'tests/desktop-audio-codec-runtime-staging.test.js',
			'tests/audio-editor-desktop-export-capability.test.ts',
			'tests/audio-editor-desktop-export-codec-model.test.ts',
			'tests/audio-editor-desktop-export-dialog-capability.test.js',
			'desktop/desktop-audio-codec-registration.mjs',
			'desktop/external-ffmpeg-registration.mjs',
			'THIRD_PARTY_LICENSES.md',
		],
	});
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
		qualification: 'Exact reviewed float32 WavPack encode/decode slice with strict bounded parsing, startup canary, and a narrow stock WavPack 5.9.0 decoder witness. No patent-clearance or non-infringement claim is made.',
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
	assert.equal(matrix.desktopCodecPolicy.bundledProviders.wavpack.targets.includes('mac-x64'), false);
	assert.deepEqual(provenance.get('electron-alternate-ffmpeg-framework-43-1-1'), {
		id: 'electron-alternate-ffmpeg-framework-43-1-1',
		status: 'documented',
		artifactSurfaces: ['electron-shell', 'desktop-release-assets'],
		provenanceKind: 'electron-upstream-alternate-framework-library-verified-after-pack',
		upstreamIntent: "Electron's matching alternate release asset is intended upstream to omit proprietary codec support.",
		providerRole: 'electron-chromium-framework-internal-not-soundscaper-codec-provider',
		qualification: 'Exact target, file type, byte length, and SHA-256 are verified. No complete codec inventory, behavior, absence-of-patent-exposure, or patent-clearance claim is made.',
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
	for (const gate of matrix.releaseGates) await assertEvidence(gate.evidence);
	assert.doesNotMatch(JSON.stringify(matrix), /legally[- ]cleared|legal approval|patent[- ]free/iu);
});

test('future third-party execution and model surfaces remain disabled behind explicit gates', async () => {
	const matrix = await readJson(matrixUrl);
	const gates = new Map(matrix.futureDistributionGates.map((gate) => [gate.id, gate]));

	assert.deepEqual(matrix.futureDistributionGates.map(({ id }) => id).sort(), FUTURE_GATE_IDS);
	for (const gate of matrix.futureDistributionGates) {
		assert.equal(gate.status, 'disabled');
		assert.ok(gate.enableRequires.length >= 3, `${gate.id} needs concrete enablement requirements`);
		await assertEvidence(gate.evidence);
	}
	assert.equal(gates.get('web-effect-packages').scope, 'externally-authored-or-non-repository-owned-packages');
	assert.match(gates.get('web-effect-packages').blocker, /Utility Gain.*repository-owned.*does not admit/iu);
	assert.equal(gates.get('native-codecs').scope,
		'additional-bundled-native-and-operating-system-codec-execution');
	assert.match(gates.get('native-codecs').blocker,
		/exact reviewed WavPack 5\.9\.0 float32 WebAssembly provider is admitted.*no other bundled compressed-codec execution factory.*no operating-system codec execution factory.*fail closed.*Electron.*not a provider tier.*user-installed external FFmpeg.*outside/iu);
	for (const path of [
		'src/common/editor/reviewed-effects/catalog.ts',
		'src/common/editor/reviewed-effects/utility-gain-package.ts',
		'tests/audio-editor-reviewed-effects.test.ts',
	]) assert.ok(gates.get('web-effect-packages').evidence.includes(path));
});

test('native plug-in format and codec policy rows stay fail-closed with named blockers', async () => {
	const matrix = await readJson(matrixUrl);

	assert.deepEqual(matrix.nativeFormatPolicies.map(({ id }) => id), [
		'plugin-format-soundscaper-fixture',
		'native-audio-stack',
		'audio-backend-coreaudio',
		'audio-backend-wasapi',
		'audio-backend-asio',
		'audio-backend-pipewire',
		'audio-backend-alsa',
		'plugin-format-vst3',
		'plugin-format-clap',
		'plugin-format-audio-units',
		'plugin-format-lv2',
		'plugin-format-ofx',
		'codec-native-ffmpeg-current-set',
		'codec-hardware-acceleration',
		'codec-decode-h264-mp4',
		'codec-decode-h264-mov',
		'codec-decode-hevc-mp4',
		'codec-decode-hevc-mov',
		'codec-decode-vp9-webm',
		'codec-decode-av1-mp4',
		'codec-decode-av1-webm',
		'codec-decode-prores-mov',
		'codec-decode-dnxhr-mxf',
		'codec-decode-png-image-sequence',
		'codec-decode-tiff-image-sequence',
		'codec-decode-openexr-image-sequence',
		'codec-encode-h264-mp4',
		'codec-encode-vp9-webm',
		'codec-encode-hevc-mp4-main10-hdr10',
		'codec-encode-hevc-mp4-main10-sdr',
		'codec-encode-prores-mov-proxy',
		'codec-encode-prores-mov-422-hq',
		'codec-encode-prores-mov-4444',
		'codec-encode-dnxhr-mxf-hqx',
		'codec-encode-ffv1-matroska',
		'codec-encode-png-image-sequence',
		'codec-encode-tiff-image-sequence',
		'codec-encode-openexr-image-sequence',
	]);
	for (const row of matrix.nativeFormatPolicies) {
		assert.match(row.kind, /^(?:plugin-format|native-audio-stack|audio-backend|codec-capability)$/u, row.id);
		if (row.id === 'plugin-format-soundscaper-fixture') {
			// The one implemented row is this project's own fixture format: no
			// third-party code, so no gate to wait on. It is named explicitly
			// rather than exempted by a pattern, so a future row cannot become
			// implemented by resembling it.
			assert.equal(row.status, 'implemented');
			assert.equal(row.blocker, null);
			await assertEvidence(row.evidence);
			continue;
		}
		assert.equal(row.status, 'blocked', `${row.id} must stay fail-closed until its review is recorded`);
		assert.ok(row.blocker.length > 0, `${row.id} needs a named blocker`);
		assert.ok(row.upstreamLicensing.length > 0, `${row.id} needs its upstream licensing form`);
		assert.ok(row.agplCompatibilityDirection.length > 0, `${row.id} needs its compatibility direction`);
		assert.ok(row.redistribution.length > 0, `${row.id} needs its redistribution posture`);
		await assertEvidence(row.evidence);
	}
	for (const row of matrix.nativeFormatPolicies.filter(({ kind }) =>
		kind === 'native-audio-stack' || kind === 'audio-backend')) {
		assert.ok(row.evidence.includes('config/milestone-5-native-source-acquisitions.json'),
			`${row.id} must bind the authenticated Milestone 5 source register`);
		assert.match(row.blocker, /native-audio/u, row.id);
	}
	const ffmpegRow = matrix.nativeFormatPolicies.find(({ id }) => id === 'codec-native-ffmpeg-current-set');
	assert.match(ffmpegRow.blocker, /ffmpeg-enabled-library-corresponding-source/u);
	assert.match(ffmpegRow.blocker, /ffmpeg-enabled-codec-patent-review/u);
	const exactCodecRows = matrix.nativeFormatPolicies.filter(({ id }) => /^codec-(?:decode|encode)-/u.test(id));
	assert.equal(exactCodecRows.length, 24);
	assert.equal(new Set(exactCodecRows.map((row) => [
		row.operation, row.codec, row.container, row.profile, row.execution,
	].join(':'))).size, exactCodecRows.length, 'every operation tuple must be unique');
	for (const row of exactCodecRows) {
		assert.match(row.operation, /^(?:decode|encode)$/u, row.id);
		assert.match(row.codec, /^[a-z0-9][a-z0-9-]*$/u, row.id);
		assert.match(row.container, /^(?:mp4|mov|webm|mxf|matroska|image-sequence)$/u, row.id);
		assert.match(row.profile, /^(?:decode|encode)-[a-z0-9-]+$/u, row.id);
		assert.equal(row.execution, 'software', row.id);
	}
	assert.equal(matrix.nativeFormatPolicies.some(({ id }) => [
		'codec-mezzanine-and-longform',
		'codec-hevc-and-av1',
		'codec-image-sequence-still-formats',
		'container-mov-mxf-matroska',
	].includes(id)), false, 'grouped professional-media blockers must not survive');
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
