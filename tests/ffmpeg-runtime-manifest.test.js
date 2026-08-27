/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { join, resolve } from 'node:path';
import test from 'node:test';

import assistanceNativeRuntimeManifest from '../config/assistance-native-runtime-manifest.json' with { type: 'json' };
import { assistanceNativeRuntimeStageSummary } from '../desktop/assistance-native-runtime-payload.mjs';
import {
	REQUIRED_LICENSING_GATES,
	createFixture,
	descriptor,
	writeBytes,
	writeJson,
	writeManifest,
} from './helpers/ffmpeg-runtime-fixture.mjs';

import {
	stageVerifiedFfmpegRuntime,
	verifyFfmpegRuntimeManifest,
} from '../scripts/lib/ffmpeg-runtime-manifest.mjs';
import { publishFfmpegRuntime } from '../scripts/lib/ffmpeg-runtime-publisher.mjs';
import {
	nativeAddonPayloadStageSummary,
	verifyNativeAddonPayloadManifest,
} from '../scripts/lib/native-addon-payload-manifest.mjs';
import { DESKTOP_CODEC_POLICY } from '../scripts/lib/desktop-codec-policy.mjs';
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
	const transport = runtimePublicationTransport();
	let corsBytes = null;
	await publishFfmpegRuntime({
		repositoryRoot: fixture.root,
		client: transport.client,
		applyCors: async ({ bytes }) => {
			corsBytes = Buffer.from(bytes);
			release.runtimeFiles[1].bytes[0] ^= 0xff;
		},
		purgeUrls: async (urls) => { transport.purges.push(urls); },
		publicFetch: transport.publicFetch,
		loadRelease: async () => release,
	});
	const releasePrefix = `runtime/ffmpeg/0.12.10/releases/${release.manifestSha256}`;
	assert.deepEqual(transport.puts.map(({ key }) => key), [
		`${releasePrefix}/ffmpeg-core.js`,
		`${releasePrefix}/ffmpeg-core.wasm`,
		`${releasePrefix}/THIRD_PARTY_LICENSES.md`,
		`${releasePrefix}/ffmpeg-corresponding-source.json`,
		`${releasePrefix}/manifest.json`,
		'runtime/ffmpeg/0.12.10/latest.json',
	]);
	assert.deepEqual(transport.puts[0].bytes, fixture.javascript, 'publisher retains the validated JavaScript snapshot');
	assert.deepEqual(transport.puts[1].bytes, fixture.wasm, 'publisher retains the validated WebAssembly snapshot');
	assert.equal(transport.puts.at(-1).options.cacheControl, 'no-store');
	assert.ok(transport.puts.slice(0, -1).every(({ options }) => options.ifNoneMatch === '*'));
	const pointer = JSON.parse(transport.puts.at(-1).bytes);
	assert.equal(pointer.releaseId, release.manifestSha256);
	assert.equal(pointer.manifest.path, `${releasePrefix}/manifest.json`);
	assert.equal(pointer.manifest.sha256, release.manifestSha256);
	assert.deepEqual(corsBytes, fixture.cors, 'CORS uses a verified snapshot');
	assert.equal(transport.purges.length, 2, 'cached 404s and the promoted pointer are purged exactly');
	release.runtimeFiles[1].bytes.set(fixture.wasm);
	transport.objects.get(`${releasePrefix}/ffmpeg-core.js`).bytes = Buffer.from('different immutable object');
	await assert.rejects(
		() => publishFfmpegRuntime({
			repositoryRoot: fixture.root,
			client: transport.client,
			applyCors: async () => undefined,
			purgeUrls: async () => undefined,
			publicFetch: transport.publicFetch,
			loadRelease: async () => release,
		}),
		/Immutable R2 object.*readback does not match/iu,
		'a 412 response is reusable only after exact byte and metadata readback',
	);
});

test('tampered runtime bytes fail both gates before upload or desktop output mutation', async (context) => {
	const fixture = await createFixture(context);
	await writeFile(fixture.wasmPath, Buffer.from('tampered second artifact'));
	await assertNoSideEffects(fixture, /ffmpeg-core\.wasm.*(?:byte length|digest)/iu);
});

test('the central runtime file MIME policy cannot drift from the release manifest', async (context) => {
	const fixture = await createFixture(context);
	fixture.manifest.runtime.files[0].contentType = 'application/javascript';
	await writeManifest(fixture);
	await assertNoSideEffects(fixture, /publication policy ffmpeg-core\.js contentType disagrees/iu);
});

test('the central release-metadata MIME policy rejects drift before publication', async (context) => {
	const fixture = await createFixture(context);
	const policyPath = join(fixture.root, 'config/ffmpeg-runtime-publication-policy.json');
	const policy = JSON.parse(await readFile(policyPath, 'utf8'));
	policy.releaseMetadata.notice.contentType = 'text/plain; charset=utf-8';
	const policyBytes = Buffer.from(`${JSON.stringify(policy, null, 2)}\n`);
	await writeFile(policyPath, policyBytes);
	fixture.manifest.publication.policy = descriptor(
		'config/ffmpeg-runtime-publication-policy.json', policyBytes,
	);
	await writeManifest(fixture);
	await assertNoSideEffects(fixture, /notice metadata contentType is invalid/iu);
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

test('desktop release assembly requires the immutable no-FFmpeg provider policy', async (context) => {
	const fixture = await createFixture(context);
	const nativeRelease = await verifyNativeAddonPayloadManifest({ repositoryRoot: fixture.root, target: 'linux-x64' });
	const nativeAddons = nativeAddonPayloadStageSummary(nativeRelease);
	const assistanceNativeRuntime = assistanceNativeRuntimeStageSummary(
		assistanceNativeRuntimeManifest,
		'linux-x64',
	);
	const manifests = Array.from({ length: 6 }, (_, index) => ({
		name: `runtime-manifest-${index}.json`,
		value: {
			desktopCodecPolicy: { ...DESKTOP_CODEC_POLICY, bundledFfmpeg: true },
			nativeAddons: structuredClone(nativeAddons),
		},
	}));
	assert.throws(
		() => validateDesktopRuntimeManifests(manifests),
		/desktop codec policy/iu,
	);
	assert.throws(() => validateDesktopRuntimeManifests([{
		name: 'runtime-manifest-soundscaper-linux-x64.json',
		value: {
			desktopCodecPolicy: DESKTOP_CODEC_POLICY,
			nativeAddons,
			productId: 'framescaper',
			target: { platform: 'linux', arch: 'x64' },
		},
	}]), /invalid product or target identity/iu);

	const identified = (value) => [{
		name: 'runtime-manifest-soundscaper-linux-x64.json',
		value: {
			desktopCodecPolicy: DESKTOP_CODEC_POLICY,
			productId: 'soundscaper',
			target: { platform: 'linux', arch: 'x64' },
			assistanceNativeRuntime,
			...value,
		},
	}];
	assert.doesNotThrow(() => validateDesktopRuntimeManifests(identified({ nativeAddons })));
	assert.throws(
		() => validateDesktopRuntimeManifests(identified({ ffmpeg: {}, nativeAddons })),
		/legacy bundled FFmpeg runtime summary/iu,
	);
	assert.throws(
		() => validateDesktopRuntimeManifests(identified({ assistanceNativeRuntime: null, nativeAddons })),
		/invalid assistance native-runtime evidence/iu,
	);
	assert.throws(
		() => validateDesktopRuntimeManifests(identified({
			assistanceNativeRuntime: {
				...assistanceNativeRuntime,
				manifestSha256: '0'.repeat(64),
			},
			nativeAddons,
		})),
		/invalid assistance native-runtime evidence/iu,
	);
	assert.throws(() => validateDesktopRuntimeManifests(identified({})),
		/does not record a staged native addon payload summary/iu);
	assert.throws(
		() => validateDesktopRuntimeManifests(identified({ nativeAddons: { ...nativeAddons, target: 'win-x64' } })),
		/records the native addon payload for win-x64 rather than linux-x64/iu,
	);
	assert.throws(
		() => validateDesktopRuntimeManifests(identified({ nativeAddons: { ...nativeAddons, targetSource: 'build-host' } })),
		/build-host native addon target; release evidence requires a declared target/iu,
	);
	assert.throws(
		() => validateDesktopRuntimeManifests(identified({ nativeAddons: { ...nativeAddons, payload: null } })),
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

test('review payload binding stays exact while pending human status remains testable', async (context) => {
	const stale = await createFixture(context);
	stale.manifest.evidence.notices.sha256 = '0'.repeat(64);
	await writeJson(stale.manifestPath, stale.manifest);
	await assertNoSideEffects(stale, /review payload digest/iu);

	const pending = await createFixture(context);
	pending.manifest.review.status = 'pending';
	await writeJson(pending.manifestPath, pending.manifest);
	for (const purpose of ['desktop-assembly', 'runtime-publication', 'desktop-release']) {
		assert.equal((await verifyFfmpegRuntimeManifest({
			repositoryRoot: pending.root, purpose,
		})).manifest.review.status, 'pending');
	}
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

test('pending Milestone 9 review is reported without blocking assembly, publication, or test packaging', async () => {
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

	assert.equal((await verifyFfmpegRuntimeManifest({
		repositoryRoot: ROOT, purpose: 'runtime-publication',
	})).manifestSha256, release.manifestSha256);
	assert.equal((await verifyFfmpegRuntimeManifest({
		repositoryRoot: ROOT, purpose: 'desktop-release',
	})).manifestSha256, release.manifestSha256);
});

test('desktop entry points enforce absence without consuming the browser FFmpeg manifest', async () => {
	const [prepare, beforePack, afterPack, releaseAssets, builderConfig, packageMetadata] = await Promise.all([
		readFile(join(ROOT, 'scripts/desktop-prepare.mjs'), 'utf8'),
		readFile(join(ROOT, 'scripts/desktop-before-pack.mjs'), 'utf8'),
		readFile(join(ROOT, 'scripts/desktop-after-pack.mjs'), 'utf8'),
		readFile(join(ROOT, 'scripts/desktop-release-assets.mjs'), 'utf8'),
		readFile(join(ROOT, 'electron-builder.config.cjs'), 'utf8'),
		readFile(join(ROOT, 'package.json'), 'utf8').then(JSON.parse),
	]);
	const platformValidation = releaseAssets.indexOf('validateDesktopRuntimeManifests(manifests');
	const packagePreflight = releaseAssets.indexOf('validateDesktopReleasePackageInventory(packageFiles');
	const sourceFetch = releaseAssets.indexOf('await fetchVerified(');
	for (const [name, source] of Object.entries({ prepare, beforePack, afterPack, releaseAssets })) {
		assert.doesNotMatch(source, /from ['"]\.\/lib\/ffmpeg-runtime-manifest\.mjs['"]/u, name);
	}
	assert.match(prepare, /delete environment\.PUBLIC_FFMPEG_CORE_BASE_URL/u);
	assert.doesNotMatch(prepare, /PUBLIC_FFMPEG_CORE_BASE_URL:\s*/u);
	assert.doesNotMatch(releaseAssets, /ffmpeg-corresponding-source|ffmpeg-runtime-manifest\.json/iu);
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
}

async function readdirNames(path) {
	return (await readdir(path)).sort();
}

function runtimePublicationTransport() {
	const objects = new Map();
	const puts = [];
	const purges = [];
	let revision = 0;
	const client = {
		async put(key, bytes, options) {
			puts.push({ key, bytes: Buffer.from(bytes), options });
			const current = objects.get(key);
			if (options.ifNoneMatch === '*' && current) return objectResponse(412);
			if (options.ifMatch && current?.etag !== options.ifMatch) return objectResponse(412);
			const etag = `"runtime-${String(++revision)}"`;
			objects.set(key, {
				bytes: Buffer.from(bytes),
				contentType: options.contentType,
				cacheControl: options.cacheControl,
				etag,
			});
			return objectResponse(200, { etag });
		},
		async get(key) {
			const object = objects.get(key);
			if (!object) return { response: objectResponse(404), bytes: Buffer.alloc(0) };
			return {
				response: objectResponse(200, {
					etag: object.etag,
					'content-type': object.contentType,
					'cache-control': object.cacheControl,
				}),
				bytes: Buffer.from(object.bytes),
			};
		},
		async delete(key) {
			objects.delete(key);
			return objectResponse(204);
		},
	};
	const publicFetch = async (url) => {
		const key = new URL(url).pathname.slice(1);
		const object = objects.get(key);
		return object
			? new Response(object.bytes, {
				status: 200,
				headers: {
					'content-type': object.contentType,
					'cache-control': object.cacheControl,
					'access-control-allow-origin': 'https://soundscaper.org',
				},
			})
			: new Response(null, { status: 404 });
	};
	return { client, objects, publicFetch, purges, puts };
}

function objectResponse(status, headers = {}) {
	return new Response(null, { status, headers });
}
