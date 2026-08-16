/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { access, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
	REQUIRED_LICENSING_GATES,
	createFixture,
	descriptor,
	writeBytes,
	writeJson,
	writeManifest,
} from './helpers/ffmpeg-runtime-fixture.mjs';

import {
	stageVerifiedFfmpegNotice,
	stageVerifiedFfmpegRuntime,
	verifyFfmpegRuntimeManifest,
} from '../scripts/lib/ffmpeg-runtime-manifest.mjs';
import { publishFfmpegRuntime } from '../scripts/lib/ffmpeg-runtime-publisher.mjs';
import {
	nativeAddonPayloadStageSummary,
	stageVerifiedNativeAddonPayload,
	verifyNativeAddonPayloadManifest,
} from '../scripts/lib/native-addon-payload-manifest.mjs';
import verifyDesktopRuntimeBeforePack from '../scripts/desktop-before-pack.mjs';
import { admitDesktopFfmpegAssembly } from '../scripts/desktop-prepare.mjs';
import { validateDesktopRuntimeManifests } from '../scripts/desktop-release-assets.mjs';

const ROOT = resolve(import.meta.dirname, '..');

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
	const nativeRelease = await verifyNativeAddonPayloadManifest({ repositoryRoot: fixture.root, target: 'linux-x64' });
	const nativeAddons = await stageVerifiedNativeAddonPayload({
		release: nativeRelease,
		outputRoot: join(fixture.root, '.desktop-build/runtime/native/linux-x64'),
	});
	const stageManifestPath = join(fixture.root, '.desktop-build/stage-manifest.json');
	await writeJson(stageManifestPath, { schemaVersion: 1, ffmpeg: summary, nativeAddons });
	await assert.doesNotReject(verifyDesktopRuntimeBeforePack({ packager: { projectDir: fixture.root } }));

	const nativePayloadPath = join(fixture.root, '.desktop-build/runtime/native/linux-x64/soundscaper_helper.node');
	const nativePayload = await readFile(nativePayloadPath);
	await writeFile(nativePayloadPath, Buffer.from('post-prepare native tamper'));
	await assert.rejects(
		verifyDesktopRuntimeBeforePack({ packager: { projectDir: fixture.root } }),
		/staged native addon payload linux-x64.*(?:byte length|digest)/iu,
	);
	await writeFile(nativePayloadPath, nativePayload);

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
	await writeJson(stageManifestPath, { schemaVersion: 1, ffmpeg: summary, nativeAddons });
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
	const nativeRelease = await verifyNativeAddonPayloadManifest({ repositoryRoot: fixture.root, target: 'linux-x64' });
	const nativeAddons = nativeAddonPayloadStageSummary(nativeRelease);
	const corrupted = structuredClone(summary);
	corrupted.files['ffmpeg-core.wasm'].sha256 = '0'.repeat(64);
	const manifests = Array.from({ length: 6 }, (_, index) => ({
		name: `runtime-manifest-${index}.json`,
		value: { ffmpeg: structuredClone(corrupted), nativeAddons: structuredClone(nativeAddons) },
	}));
	assert.throws(
		() => validateDesktopRuntimeManifests(manifests, release),
		/does not match the verified FFmpeg runtime policy manifest/iu,
	);
	assert.throws(() => validateDesktopRuntimeManifests([{
		name: 'runtime-manifest-soundscaper-linux-x64.json',
		value: { ffmpeg: summary, nativeAddons, productId: 'framescaper', target: { platform: 'linux', arch: 'x64' } },
	}], release), /invalid product or target identity/iu);

	const identified = (value) => [{
		name: 'runtime-manifest-soundscaper-linux-x64.json',
		value: { ffmpeg: summary, productId: 'soundscaper', target: { platform: 'linux', arch: 'x64' }, ...value },
	}];
	assert.doesNotThrow(() => validateDesktopRuntimeManifests(identified({ nativeAddons }), release));
	assert.throws(() => validateDesktopRuntimeManifests(identified({}), release),
		/does not record a staged native addon payload summary/iu);
	assert.throws(
		() => validateDesktopRuntimeManifests(identified({ nativeAddons: { ...nativeAddons, target: 'win-x64' } }), release),
		/records the native addon payload for win-x64 rather than linux-x64/iu,
	);
	assert.throws(
		() => validateDesktopRuntimeManifests(identified({ nativeAddons: { ...nativeAddons, targetSource: 'build-host' } }), release),
		/build-host native addon target; release evidence requires a declared target/iu,
	);
	assert.throws(
		() => validateDesktopRuntimeManifests(identified({ nativeAddons: { ...nativeAddons, payload: null } }), release),
		/status that disagrees with its payload/iu,
	);
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

test('manifest-relative paths stay safe under Windows path semantics', async (context) => {
	// Windows packaging runners resolve with the win32 flavour from a
	// drive-rooted working directory, where resolving a relative path against
	// the root separator yields "D:\\config\\..." rather than "\\config\\...".
	// Bind node:path to win32 for one module instance and report a drive-rooted
	// working directory so a platform-coupled guard fails here rather than only
	// on a Windows runner.
	const marker = '?path-flavour=win32';
	const hooks = registerHooks({
		resolve(specifier, hookContext, nextResolve) {
			if (specifier === 'node:path' && hookContext.parentURL?.endsWith(marker)) {
				return nextResolve('node:path/win32', hookContext);
			}
			return nextResolve(specifier, hookContext);
		},
	});
	context.after(() => hooks.deregister());
	const { assertSafeRelativePath } = await import(`../scripts/lib/ffmpeg-runtime-manifest.mjs${marker}`);

	const realCwd = process.cwd;
	process.cwd = () => 'D:\\a\\Soundscaper\\Soundscaper';
	context.after(() => { process.cwd = realCwd; });

	for (const safePath of [
		'config/ffmpeg-runtime-manifest.json',
		'desktop/ffmpeg-corresponding-source.json',
		'THIRD_PARTY_LICENSES.md',
	]) {
		assert.doesNotThrow(() => assertSafeRelativePath(safePath, 'FFmpeg runtime manifest path'));
	}
	for (const unsafePath of ['/config/manifest.json', 'config\\manifest.json', '../manifest.json', 'config//manifest.json', '']) {
		assert.throws(
			() => assertSafeRelativePath(unsafePath, 'FFmpeg runtime manifest path'),
			/FFmpeg runtime manifest path is invalid/u,
		);
	}
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

async function readdirNames(path) {
	return (await readdir(path)).sort();
}
