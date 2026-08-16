import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import hardenPackagedElectron from '../scripts/desktop-after-pack.mjs';
import {
	stageVerifiedFfmpegNotice,
	stageVerifiedFfmpegRuntime,
	verifyFfmpegRuntimeManifest,
} from '../scripts/lib/ffmpeg-runtime-manifest.mjs';
import {
	stageVerifiedNativeAddonPayload,
	verifyNativeAddonPayloadManifest,
} from '../scripts/lib/native-addon-payload-manifest.mjs';

test('afterPack verifies copied FFmpeg resources before fuse work', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-packaged-ffmpeg-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const release = await verifyFfmpegRuntimeManifest({
		repositoryRoot: process.cwd(),
		purpose: 'desktop-assembly',
	});
	const resources = join(root, 'resources');
	const runtimeRoot = join(resources, `runtime/ffmpeg/${release.manifest.package.version}`);
	const noticePath = join(resources, 'licenses/THIRD_PARTY_LICENSES.md');
	await stageVerifiedFfmpegRuntime({ release, outputRoot: runtimeRoot });
	await mkdir(join(resources, 'licenses'), { recursive: true });
	await stageVerifiedFfmpegNotice({ release, outputPath: noticePath });
	const nativeRelease = await verifyNativeAddonPayloadManifest({ repositoryRoot: process.cwd(), target: 'linux-x64' });
	await stageVerifiedNativeAddonPayload({
		release: nativeRelease,
		outputRoot: join(resources, 'runtime/native/linux-x64'),
	});

	const fuseCalls = [];
	const invoke = () => hardenPackagedElectron(packagingContext(root, resources), {
		repositoryRoot: process.cwd(),
		flipFuses: async (...args) => { fuseCalls.push(args); },
	});
	await invoke();
	assert.equal(fuseCalls.length, 1);

	const wasm = release.runtimeFiles.find(({ name }) => name === 'ffmpeg-core.wasm');
	assert.ok(wasm);
	fuseCalls.length = 0;
	await writeFile(join(runtimeRoot, wasm.name), 'tampered packaged WebAssembly');
	await assert.rejects(invoke(), /packaged runtime file ffmpeg-core\.wasm.*(?:byte length|digest)/iu);
	assert.equal(fuseCalls.length, 0);
	await writeFile(join(runtimeRoot, wasm.name), wasm.bytes);

	await writeFile(join(runtimeRoot, release.manifest.publication.manifestName), '{}\n');
	await assert.rejects(invoke(), /packaged FFmpeg runtime manifest.*verified policy manifest/iu);
	assert.equal(fuseCalls.length, 0);
	await writeFile(join(runtimeRoot, release.manifest.publication.manifestName), release.manifestBytes);

	await writeFile(noticePath, 'tampered packaged notice\n');
	await assert.rejects(invoke(), /packaged FFmpeg notice.*(?:byte length|digest)/iu);
	assert.equal(fuseCalls.length, 0);
	await writeFile(noticePath, release.evidence.notices.bytes);

	await writeFile(join(runtimeRoot, 'unexpected-runtime.bin'), 'unexpected');
	await assert.rejects(invoke(), /packaged FFmpeg runtime inventory mismatch/iu);
	assert.equal(fuseCalls.length, 0);
});

function packagingContext(appOutDir, resourcesDir) {
	return {
		electronPlatformName: 'linux',
		appOutDir,
		packager: {
			executableName: 'soundscaper',
			appInfo: { productFilename: 'Soundscaper' },
			getResourcesDir(value) {
				assert.equal(value, appOutDir);
				return resourcesDir;
			},
		},
	};
}
