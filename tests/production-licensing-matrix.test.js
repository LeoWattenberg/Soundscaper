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
	for (const gateId of ['desktop-notice-delivery', 'ffmpeg-runtime-manifest-integrity']) {
		for (const path of ['scripts/desktop-after-pack.mjs', 'tests/desktop-packaged-ffmpeg-runtime.test.js']) {
			assert.ok(gates.get(gateId).evidence.includes(path), `${gateId} must retain post-copy verification evidence`);
		}
	}
	assert.deepEqual(matrix.ffmpeg.enabledExternalLibraries, ENABLED_FFMPEG_LIBRARIES);
	assert.equal(matrix.ffmpeg.runtimeManifest, 'config/ffmpeg-runtime-manifest.json');
	assert.equal(matrix.ffmpeg.correspondingSourceManifest, 'desktop/ffmpeg-corresponding-source.json');
	assert.match(gates.get('ffmpeg-enabled-library-corresponding-source').blocker, /every enabled library/u);
	assert.match(gates.get('ffmpeg-enabled-codec-patent-review').blocker, /jurisdiction/u);
	assert.match(gates.get('web-notice-delivery').blocker, /web route|web artifact/u);
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
