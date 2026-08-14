/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import {
	access,
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	rm,
	symlink,
	writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';

import {
	stageVerifiedFfmpegNotice,
	stageVerifiedFfmpegRuntime,
	verifyFfmpegRuntimeManifest,
} from '../scripts/lib/ffmpeg-runtime-manifest.mjs';
import { publishFfmpegRuntime } from '../scripts/lib/ffmpeg-runtime-publisher.mjs';
import verifyDesktopRuntimeBeforePack from '../scripts/desktop-before-pack.mjs';
import { admitDesktopFfmpegAssembly } from '../scripts/desktop-prepare.mjs';
import { validateDesktopRuntimeManifests } from '../scripts/desktop-release-assets.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const REQUIRED_LICENSING_GATES = [
	'ffmpeg-enabled-codec-patent-review', 'ffmpeg-enabled-library-corresponding-source', 'web-notice-delivery',
];
const ALL_LICENSING_GATES = [
	'dependency-notice-version-audit', 'desktop-notice-delivery', 'ffmpeg-enabled-codec-patent-review',
	'ffmpeg-enabled-library-corresponding-source', 'ffmpeg-runtime-manifest-integrity', 'web-notice-delivery',
];

test('a policy manifest stages and publishes only its verified buffered bytes', async (context) => {
	const fixture = await createFixture(context);
	const release = await verifyFfmpegRuntimeManifest({
		repositoryRoot: fixture.root,
		purpose: 'desktop-assembly',
	});
	assert.equal(release.manifest.id, 'ffmpeg-core-0.12.10');
	assert.deepEqual(release.runtimeFiles.map(({ name }) => name), [
		'ffmpeg-core.js',
		'ffmpeg-core.wasm',
	]);
	assert.deepEqual(Object.getOwnPropertySymbols(release), [], 'verification identity is not copyable from the release object');

	const outputRoot = join(fixture.root, 'desktop-runtime');
	const staging = stageVerifiedFfmpegRuntime({ release, outputRoot });
	queueMicrotask(() => { release.runtimeFiles[0].bytes[0] ^= 0xff; });
	await staging;
	assert.deepEqual(await readFile(join(outputRoot, 'ffmpeg-core.js')), fixture.javascript);
	assert.deepEqual(await readFile(join(outputRoot, 'ffmpeg-core.wasm')), fixture.wasm);
	assert.deepEqual(await readFile(join(outputRoot, 'manifest.json')), release.manifestBytes);
	release.runtimeFiles[0].bytes.set(fixture.javascript);

	await writeFile(fixture.javascriptPath, 'changed after validation');
	const calls = [];
	await publishFfmpegRuntime({
		repositoryRoot: fixture.root,
		executeWrangler(command) {
			calls.push(command);
			if (command.kind === 'put') {
				assert.ok(Buffer.isBuffer(command.bytes));
				return { status: 0 };
			}
			assert.deepEqual(
				readFileSync(command.file),
				fixture.cors,
				'CORS uses a verified temporary snapshot',
			);
			release.runtimeFiles[1].bytes[0] ^= 0xff;
			return { status: 0 };
		},
		loadRelease: async () => release,
	});
	const releasePrefix = `runtime/ffmpeg/0.12.10/releases/${release.manifestSha256}`;
	assert.deepEqual(calls.map(({ kind, key }) => [kind, key]), [
		['cors', undefined],
		['put', `${releasePrefix}/ffmpeg-core.js`],
		['put', `${releasePrefix}/ffmpeg-core.wasm`],
		['put', `${releasePrefix}/THIRD_PARTY_LICENSES.md`],
		['put', `${releasePrefix}/ffmpeg-corresponding-source.json`],
		['put', `${releasePrefix}/manifest.json`],
		['put', 'runtime/ffmpeg/0.12.10/latest.json'],
	]);
	assert.deepEqual(calls[1].bytes, fixture.javascript, 'publisher retains the validated JavaScript snapshot');
	assert.deepEqual(calls[2].bytes, fixture.wasm, 'publisher retains the validated WebAssembly snapshot');
	assert.equal(calls.at(-1).cacheControl, 'no-store');
	const pointer = JSON.parse(calls.at(-1).bytes);
	assert.equal(pointer.releaseId, release.manifestSha256);
	assert.equal(pointer.manifest.path, `${releasePrefix}/manifest.json`);
	assert.equal(pointer.manifest.sha256, release.manifestSha256);
	assert.equal(existsSync(calls[0].file), false, 'temporary CORS snapshot is removed');
});

test('tampered runtime bytes fail both gates before upload or desktop output mutation', async (context) => {
	const fixture = await createFixture(context);
	await writeFile(fixture.wasmPath, Buffer.from('tampered second artifact'));
	await assertNoSideEffects(fixture, /ffmpeg-core\.wasm.*(?:byte length|digest)/iu);
});

test('desktop packaging revalidates staged bytes and the retained policy summary', async (context) => {
	const fixture = await createFixture(context);
	const release = await verifyFfmpegRuntimeManifest({
		repositoryRoot: fixture.root,
		purpose: 'desktop-assembly',
	});
	const outputRoot = join(fixture.root, '.desktop-build/runtime/ffmpeg/0.12.10');
	const noticePath = join(fixture.root, '.desktop-build/licenses/THIRD_PARTY_LICENSES.md');
	const summary = await stageVerifiedFfmpegRuntime({ release, outputRoot });
	await stageVerifiedFfmpegNotice({ release, outputPath: noticePath });
	const stageManifestPath = join(fixture.root, '.desktop-build/stage-manifest.json');
	await writeJson(stageManifestPath, { schemaVersion: 1, ffmpeg: summary });
	await assert.doesNotReject(verifyDesktopRuntimeBeforePack({ packager: { projectDir: fixture.root } }));

	await writeFile(join(outputRoot, 'ffmpeg-core.wasm'), Buffer.from('post-prepare tamper'));
	await assert.rejects(
		verifyDesktopRuntimeBeforePack({ packager: { projectDir: fixture.root } }),
		/staged runtime file ffmpeg-core\.wasm.*(?:byte length|digest)/iu,
	);
	await writeFile(join(outputRoot, 'ffmpeg-core.wasm'), fixture.wasm);
	const stage = JSON.parse(await readFile(stageManifestPath, 'utf8'));
	stage.ffmpeg.runtimeManifest.sha256 = '0'.repeat(64);
	await writeJson(stageManifestPath, stage);
	await assert.rejects(
		verifyDesktopRuntimeBeforePack({ packager: { projectDir: fixture.root } }),
		/stage manifest.*verified FFmpeg runtime summary/iu,
	);
	await writeJson(stageManifestPath, { schemaVersion: 1, ffmpeg: summary });
	await writeFile(join(outputRoot, 'manifest.json'), Buffer.from('post-prepare manifest tamper'));
	await assert.rejects(
		verifyDesktopRuntimeBeforePack({ packager: { projectDir: fixture.root } }),
		/staged FFmpeg runtime manifest.*verified policy manifest/iu,
	);
	await writeFile(join(outputRoot, 'manifest.json'), release.manifestBytes);
	await writeFile(noticePath, Buffer.from('post-prepare notice tamper'));
	await assert.rejects(
		verifyDesktopRuntimeBeforePack({ packager: { projectDir: fixture.root } }),
		/staged FFmpeg notice.*(?:byte length|digest)/iu,
	);
	await rm(noticePath);
	await symlink(join(fixture.root, 'THIRD_PARTY_LICENSES.md'), noticePath);
	await assert.rejects(verifyDesktopRuntimeBeforePack({ packager: { projectDir: fixture.root } }),
		/staged FFmpeg notice is not a regular file/iu);
});

test('desktop staging refuses pre-existing output without mutation', async (context) => {
	const fixture = await createFixture(context);
	const release = await verifyFfmpegRuntimeManifest({
		repositoryRoot: fixture.root,
		purpose: 'desktop-assembly',
	});
	const outputRoot = join(fixture.root, 'existing-runtime');
	await writeBytes(join(outputRoot, 'manifest.json'), Buffer.from('pre-existing corrupt manifest'));
	await assert.rejects(
		stageVerifiedFfmpegRuntime({ release, outputRoot }),
		/FFmpeg runtime output already exists/iu,
	);
	assert.deepEqual((await readdirNames(outputRoot)), ['manifest.json']);
	assert.equal(String(await readFile(join(outputRoot, 'manifest.json'))), 'pre-existing corrupt manifest');
});

test('publisher rejects fabricated, mutated, or post-validation-corrupted releases before commands', async (context) => {
	const fixture = await createFixture(context);
	const release = await verifyFfmpegRuntimeManifest({
		repositoryRoot: fixture.root,
		purpose: 'desktop-assembly',
	});
	assert.throws(
		() => { release.manifest.authorizations.runtimePublication.status = 'blocked'; },
		/readonly|read only|Cannot assign/iu,
	);
	let calls = 0;
	await assert.rejects(
		publishFfmpegRuntime({
			repositoryRoot: fixture.root,
			loadRelease: async () => ({
				manifest: release.manifest,
				manifestBytes: release.manifestBytes,
				manifestSha256: release.manifestSha256,
				runtimeFiles: release.runtimeFiles,
				evidence: release.evidence,
				corsBytes: release.corsBytes,
			}),
			executeWrangler() { calls += 1; return { status: 0 }; },
		}),
		/verified FFmpeg runtime release/iu,
	);
	assert.equal(calls, 0);
	release.runtimeFiles[0].bytes[0] ^= 0xff;
	await assert.rejects(
		publishFfmpegRuntime({
			repositoryRoot: fixture.root,
			loadRelease: async () => release,
			executeWrangler() { calls += 1; return { status: 0 }; },
		}),
		/buffered runtime file ffmpeg-core\.js digest mismatch/iu,
	);
	assert.equal(calls, 0);
});

test('desktop release assembly rejects identically corrupted platform manifests', async (context) => {
	const fixture = await createFixture(context);
	const release = await verifyFfmpegRuntimeManifest({
		repositoryRoot: fixture.root,
		purpose: 'desktop-assembly',
	});
	const summary = await stageVerifiedFfmpegRuntime({
		release,
		outputRoot: join(fixture.root, 'release-fixture-runtime'),
	});
	const corrupted = structuredClone(summary);
	corrupted.files['ffmpeg-core.wasm'].sha256 = '0'.repeat(64);
	const manifests = Array.from({ length: 6 }, (_, index) => ({
		name: `runtime-manifest-${index}.json`,
		value: { ffmpeg: structuredClone(corrupted) },
	}));
	assert.throws(
		() => validateDesktopRuntimeManifests(manifests, release),
		/does not match the verified FFmpeg runtime policy manifest/iu,
	);
	assert.throws(() => validateDesktopRuntimeManifests([{
		name: 'runtime-manifest-soundscaper-linux-x64.json',
		value: { ffmpeg: summary, productId: 'framescaper', target: { platform: 'linux', arch: 'x64' } },
	}], release), /invalid product or target identity/iu);
});

test('incomplete runtime evidence fails both gates before side effects', async (context) => {
	const fixture = await createFixture(context);
	delete fixture.manifest.evidence.releaseSeverityPolicy;
	await writeManifest(fixture);
	await assertNoSideEffects(fixture, /evidence.*releaseSeverityPolicy/iu);
	const mismatch = await createFixture(context);
	const notice = Buffer.from('`@ffmpeg/core` 0.12.10 https://github.com/ffmpegwasm/ffmpeg.wasm/tree/v0.12.10\n');
	await writeFile(join(mismatch.root, 'THIRD_PARTY_LICENSES.md'), notice);
	mismatch.manifest.evidence.notices = descriptor('THIRD_PARTY_LICENSES.md', notice);
	await writeManifest(mismatch);
	await assertNoSideEffects(mismatch, /does not identify the pinned ffmpeg\.wasm build source/iu);
});

test('stale or pending self-declared review markers fail both gates before side effects', async (context) => {
	const stale = await createFixture(context);
	stale.manifest.evidence.notices.sha256 = '0'.repeat(64);
	await writeJson(stale.manifestPath, stale.manifest);
	await assertNoSideEffects(stale, /review payload digest/iu);

	const pending = await createFixture(context);
	pending.manifest.review.status = 'pending';
	await writeJson(pending.manifestPath, pending.manifest);
	await assertNoSideEffects(pending, /review status.*approved/iu);
});

test('the line-ending policy covers every digest-bound text input', async (context) => {
	const fixture = await createFixture(context);
	const attributesPath = join(fixture.root, '.gitattributes');
	const attributes = String(await readFile(attributesPath))
		.replace('/config/production-security-matrix.json text eol=lf\n', '')
		.replaceAll('\n', '\r\n');
	const bytes = Buffer.from(attributes);
	await writeFile(attributesPath, bytes);
	fixture.manifest.evidence.lineEndings = descriptor('.gitattributes', bytes);
	await writeManifest(fixture);
	await assertNoSideEffects(fixture, /must pin LF for config\/production-security-matrix\.json/iu);
});

test('unsafe and symbolic runtime inputs are rejected before side effects', async (context) => {
	const unsafe = await createFixture(context);
	unsafe.manifest.evidence.notices.path = '../THIRD_PARTY_LICENSES.md';
	await writeManifest(unsafe);
	await assertNoSideEffects(unsafe, /evidence\.notices\.path/iu);

	const linked = await createFixture(context);
	await rm(linked.javascriptPath);
	await symlink(join(linked.root, 'real-ffmpeg-core.js'), linked.javascriptPath);
	await writeFile(join(linked.root, 'real-ffmpeg-core.js'), linked.javascript);
	await assertNoSideEffects(linked, /symbolic link.*ffmpeg-core\.js/iu);
});

test('case-insensitive release sidecar collisions fail before side effects', async (context) => {
	const fixture = await createFixture(context);
	const sourcePath = join(fixture.root, 'desktop/ffmpeg-corresponding-source.json');
	const source = JSON.parse(await readFile(sourcePath, 'utf8'));
	source.source.fileName = 'sha256sums';
	const bytes = Buffer.from(JSON.stringify(source));
	await writeFile(sourcePath, bytes);
	fixture.manifest.evidence.correspondingSource = descriptor('desktop/ffmpeg-corresponding-source.json', bytes);
	await writeManifest(fixture);
	await assertNoSideEffects(fixture, /source archive filename is reserved: sha256sums/iu);
});

test('the checked-in manifest permits verification and desktop staging but blocks public release paths offline', async () => {
	const release = await verifyFfmpegRuntimeManifest({
		repositoryRoot: ROOT,
		purpose: 'desktop-assembly',
	});
	assert.equal(release.manifest.authorizations.desktopAssembly.status, 'approved');
	assert.equal(release.manifest.authorizations.runtimePublication.status, 'blocked');
	assert.deepEqual(
		release.manifest.authorizations.runtimePublication.blockedBy,
		REQUIRED_LICENSING_GATES,
	);

	let calls = 0;
	await assert.rejects(
		publishFfmpegRuntime({
			repositoryRoot: ROOT,
			executeWrangler() {
				calls += 1;
				return { status: 0 };
			},
		}),
		/runtime publication is blocked.*web-notice-delivery/iu,
	);
	assert.equal(calls, 0);
	await assert.rejects(
		verifyFfmpegRuntimeManifest({ repositoryRoot: ROOT, purpose: 'desktop-release' }),
		/desktop release is blocked.*ffmpeg-enabled/iu,
	);
});

test('desktop entry points verify the policy runtime before assembly and recheck before packing', async () => {
	const [releaseAssets, builderConfig, packageMetadata] = await Promise.all([
		readFile(join(ROOT, 'scripts/desktop-release-assets.mjs'), 'utf8'),
		readFile(join(ROOT, 'electron-builder.config.cjs'), 'utf8'),
		readFile(join(ROOT, 'package.json'), 'utf8').then(JSON.parse),
	]);
	const releaseVerification = releaseAssets.indexOf('await verifyFfmpegRuntimeManifest');
	const releaseRead = releaseAssets.indexOf('await readdir(ASSET_ROOT');
	const platformValidation = releaseAssets.indexOf('validateDesktopRuntimeManifests(manifests');
	const packagePreflight = releaseAssets.indexOf('validateDesktopReleasePackageInventory(packageFiles');
	const sourceFetch = releaseAssets.indexOf('await fetchVerified(');
	assert.ok(releaseVerification >= 0 && releaseRead >= 0 && releaseVerification < releaseRead,
		'public desktop release validates its policy before reading assembly inputs');
	assert.ok(
		platformValidation >= 0 && sourceFetch >= 0 && platformValidation < sourceFetch,
		'public desktop release validates every runtime manifest before network fetches',
	);
	assert.ok(
		packagePreflight >= 0 && sourceFetch >= 0 && packagePreflight < sourceFetch,
		'public desktop release validates its Soundscaper package inventory before network fetches',
	);
	assert.match(builderConfig, /beforePack: ['"]\.\/scripts\/desktop-before-pack\.mjs['"]/u);
	assert.match(builderConfig, /from: ['"]\.desktop-build\/licenses\/THIRD_PARTY_LICENSES\.md['"]/u);
	assert.match(packageMetadata.scripts['audit:ci'], /audit:ffmpeg-runtime/u);
});

async function assertNoSideEffects(fixture, expectedError) {
	for (const purpose of ['desktop-assembly', 'runtime-publication']) {
		await assert.rejects(
			verifyFfmpegRuntimeManifest({ repositoryRoot: fixture.root, purpose }),
			expectedError,
		);
	}

	const outputRoot = join(fixture.root, 'unwritten-desktop-runtime');
	let assemblies = 0;
	await assert.rejects(
		admitDesktopFfmpegAssembly({
			repositoryRoot: fixture.root,
			assemble: async () => {
				assemblies += 1;
				await mkdir(outputRoot, { recursive: true });
			},
		}),
		expectedError,
	);
	assert.equal(assemblies, 0, 'invalid desktop manifest never enters assembly');
	let calls = 0;
	await assert.rejects(
		publishFfmpegRuntime({
			repositoryRoot: fixture.root,
			executeWrangler() {
				calls += 1;
				return { status: 0 };
			},
		}),
		expectedError,
	);
	assert.equal(calls, 0, 'invalid publication constructs no Wrangler operation');
	await assert.rejects(access(outputRoot), /ENOENT/u);
}

async function createFixture(context) {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-ffmpeg-runtime-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const javascript = Buffer.from('fixture ffmpeg JavaScript');
	const wasm = Buffer.from('fixture ffmpeg WebAssembly');
	const cors = Buffer.from(JSON.stringify({
		rules: [{
			allowed: {
				origins: ['https://soundscaper.org'],
				methods: ['GET', 'HEAD'],
				headers: ['Range'],
			},
			exposeHeaders: ['Content-Length', 'Content-Range', 'ETag'],
			maxAgeSeconds: 86_400,
		}],
	}));
	const packageEntry = {
		version: '0.12.10',
		resolved: 'https://registry.npmjs.org/@ffmpeg/core/-/core-0.12.10.tgz',
		integrity: 'sha512-fixture-integrity',
		license: 'GPL-2.0-or-later',
	};
	const paths = {
		lineEndings: '.gitattributes',
		correspondingSource: 'desktop/ffmpeg-corresponding-source.json',
		notices: 'THIRD_PARTY_LICENSES.md',
		releaseSeverityPolicy: 'config/release-severity-policy.json',
		licensingPolicy: 'docs/production-licensing-policy.md',
		licensingMatrix: 'config/production-licensing-matrix.json',
		securityMatrix: 'config/production-security-matrix.json',
		threatModel: 'docs/production-threat-model.md',
	};
	const sourceDescriptor = {
		url: 'https://example.test/ffmpeg-source.tar.gz',
		fileName: 'ffmpeg-source.tar.gz',
		byteLength: 12,
		sha256: '1'.repeat(64),
	};
	const buildSourceDescriptor = {
		url: 'https://github.com/ffmpegwasm/ffmpeg.wasm/archive/refs/tags/v12.15.tar.gz',
		fileName: 'ffmpeg-build-source.tar.gz',
		byteLength: 13,
		sha256: '2'.repeat(64),
	};
	const securityMatrix = {
		schemaVersion: 1,
		risks: [{
			id: 'runtime-supply-chain',
			currentControls: [{ id: 'validated-ffmpeg-runtime-publication' }],
		}],
	};
	const lineEndings = Buffer.from([
		'/.gitattributes text eol=lf',
		'/THIRD_PARTY_LICENSES.md text eol=lf',
		'/config/ffmpeg-runtime-manifest.json text eol=lf',
		'/config/production-licensing-matrix.json text eol=lf',
		'/config/production-security-matrix.json text eol=lf',
		'/config/release-severity-policy.json text eol=lf',
		'/desktop/ffmpeg-corresponding-source.json text eol=lf',
		'/docs/production-licensing-policy.md text eol=lf',
		'/docs/production-threat-model.md text eol=lf',
		'/r2-cors.json text eol=lf',
		'',
	].join('\n'));
	const evidenceBytes = {
		lineEndings,
		correspondingSource: Buffer.from(JSON.stringify({
			schemaVersion: 1,
			runtime: {
				package: '@ffmpeg/core',
				version: '0.12.10',
				javascriptSha256: sha256(javascript),
				wasmSha256: sha256(wasm),
			},
			source: sourceDescriptor,
			buildSource: buildSourceDescriptor,
		})),
		notices: Buffer.from('Fixture notices for `@ffmpeg/core` 0.12.10 from https://github.com/ffmpegwasm/ffmpeg.wasm/tree/v12.15\n'),
		releaseSeverityPolicy: Buffer.from(JSON.stringify({
			schemaVersion: 1,
			releaseGate: { maximumOpen: { critical: 0, high: 0 } },
		})),
		licensingPolicy: Buffer.from('# Fixture licensing policy\n'),
		licensingMatrix: Buffer.from(JSON.stringify({
			schemaVersion: 1,
			releaseGates: ALL_LICENSING_GATES.map((id) => ({ id, status: 'implemented' })),
		})),
		securityMatrix: Buffer.from(JSON.stringify(securityMatrix)),
		threatModel: Buffer.from('# Fixture threat model\n'),
	};
	await Promise.all([
		writeJson(join(root, 'package.json'), {
			name: 'soundscaper',
			dependencies: { '@ffmpeg/core': '0.12.10' },
		}),
		writeJson(join(root, 'package-lock.json'), {
			lockfileVersion: 3,
			packages: { 'node_modules/@ffmpeg/core': packageEntry },
		}),
		writeJson(join(root, 'node_modules/@ffmpeg/core/package.json'), {
			name: '@ffmpeg/core',
			version: '0.12.10',
			license: 'GPL-2.0-or-later',
		}),
		writeBytes(join(root, 'node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.js'), javascript),
		writeBytes(join(root, 'node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.wasm'), wasm),
		...Object.entries(evidenceBytes).map(([id, bytes]) => writeBytes(join(root, paths[id]), bytes)),
		writeBytes(join(root, 'r2-cors.json'), cors),
	]);
	const manifestPath = join(root, 'config/ffmpeg-runtime-manifest.json');
	const manifest = {
		schemaVersion: 1,
		id: 'ffmpeg-core-0.12.10',
		package: {
			name: '@ffmpeg/core',
			version: '0.12.10',
			lockPath: 'node_modules/@ffmpeg/core',
			resolved: packageEntry.resolved,
			integrity: packageEntry.integrity,
			license: packageEntry.license,
		},
		runtime: {
			publicPrefix: 'runtime/ffmpeg/0.12.10',
			cacheControl: 'public, max-age=31536000, immutable',
			files: [
				fileDescriptor('ffmpeg-core.js', javascript, 'text/javascript; charset=utf-8'),
				fileDescriptor('ffmpeg-core.wasm', wasm, 'application/wasm'),
			],
		},
		publication: {
			bucket: 'soundscaper-assets',
			jurisdiction: 'eu',
			manifestName: 'manifest.json',
			noticeName: 'THIRD_PARTY_LICENSES.md',
			correspondingSourceName: 'ffmpeg-corresponding-source.json',
			corsOrigins: ['https://soundscaper.org'],
			cors: descriptor('r2-cors.json', cors),
		},
		evidence: Object.fromEntries(Object.entries(paths).map(([id, path]) => [
			id,
			descriptor(path, evidenceBytes[id]),
		])),
		security: {
			matrixPath: 'config/production-security-matrix.json',
			riskId: 'runtime-supply-chain',
			controlId: 'validated-ffmpeg-runtime-publication',
		},
		authorizations: {
			desktopAssembly: { status: 'approved', blockedBy: [] },
			runtimePublication: { status: 'approved', blockedBy: [] },
			desktopRelease: { status: 'approved', blockedBy: [] },
		},
		review: {
			status: 'approved',
			reviewedAt: '2026-07-29',
			reviewer: 'Fixture release reviewer',
			scopes: ['desktop-assembly', 'desktop-release-policy', 'runtime-publication-policy'],
			payloadSha256: '',
		},
	};
	const fixture = {
		root,
		manifest,
		manifestPath,
		javascript,
		wasm,
		cors,
		javascriptPath: join(root, 'node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.js'),
		wasmPath: join(root, 'node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.wasm'),
	};
	await writeManifest(fixture);
	return fixture;
}

async function writeManifest(fixture) {
	fixture.manifest.review.payloadSha256 = sha256(Buffer.from(canonicalJson(
		Object.fromEntries(Object.entries(fixture.manifest).filter(([key]) => key !== 'review')),
	)));
	await writeJson(fixture.manifestPath, fixture.manifest);
}

function fileDescriptor(name, bytes, contentType) {
	return { name, byteLength: bytes.byteLength, sha256: sha256(bytes), contentType };
}

function descriptor(path, bytes) {
	return { path, byteLength: bytes.byteLength, sha256: sha256(bytes) };
}

function canonicalJson(value) {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
	if (value && typeof value === 'object') {
		return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
	}
	return JSON.stringify(value);
}

function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

async function writeJson(path, value) {
	await writeBytes(path, Buffer.from(`${JSON.stringify(value, null, 2)}\n`));
}

async function writeBytes(path, bytes) {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, bytes);
}

async function readdirNames(path) {
	return (await readdir(path)).sort();
}
