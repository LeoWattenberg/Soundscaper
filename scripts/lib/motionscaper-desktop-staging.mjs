/* SPDX-License-Identifier: AGPL-3.0-only */

import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { build } from 'esbuild';
import { generateDesktopIcon } from '../desktop-icons.mjs';
import { resolveNativeAddonPayloadTarget } from './native-addon-payload-manifest.mjs';
import { DESKTOP_CODEC_POLICY } from './desktop-codec-policy.mjs';
import { stageMotionscaperNativePayload } from './motionscaper-native-staging.ts';
import { createMotionscaperStageInventory, verifyMotionscaperDesktopStage } from './motionscaper-desktop-package.mjs';

/** Stage only this product and its independently verified optional native export payload. */
export async function prepareMotionscaperDesktop({ repositoryRoot, buildRoot, productMetadata, sourceRevision, buildRenderer }) {
	if (productMetadata.id !== 'motionscaper') throw new TypeError('Motionscaper staging requires its own product metadata.');
	const target = resolveNativeAddonPayloadTarget({
		platform: process.env.SOUNDSCAPER_DESKTOP_TARGET_PLATFORM ?? null,
		arch: process.env.SOUNDSCAPER_DESKTOP_TARGET_ARCH ?? null,
	});
	await rm(buildRoot, { recursive: true, force: true });
	for (const tree of ['app/desktop', 'renderer', 'runtime', 'licenses']) await mkdir(join(buildRoot, tree), { recursive: true });
	await buildRenderer({ repositoryRoot, rendererRoot: join(buildRoot, 'renderer'), productId: 'motionscaper', buildSmoke: async () => {} });
	for (const [source, output, format] of [
		['motionscaper-main.ts', 'main.mjs', 'esm'],
		['motionscaper-preload.ts', 'preload.cjs', 'cjs'],
	]) {
		await build({
			entryPoints: [join(repositoryRoot, 'desktop', source)],
			outfile: join(buildRoot, 'app/desktop', output), bundle: true,
			platform: 'node', target: 'node26', format, external: ['electron'], logLevel: 'silent',
		});
	}
	const projectPackage = JSON.parse(await readFile(join(repositoryRoot, 'package.json'), 'utf8'));
	await writeJson(join(buildRoot, 'app/package.json'), {
		name: 'motionscaper-desktop', productName: 'Motionscaper', version: productMetadata.applicationVersion,
		description: 'Local-first motion graphics and compositing', main: 'desktop/main.mjs', type: 'module',
		license: projectPackage.license, author: projectPackage.author,
	});
	await writeJson(join(buildRoot, 'app/desktop/product.json'), productMetadata);
	await cp(join(repositoryRoot, 'THIRD_PARTY_LICENSES.md'), join(buildRoot, 'licenses/THIRD_PARTY_LICENSES.md'));
	await generateDesktopIcon({
		sourcePath: join(repositoryRoot, 'public/logo/motionscaper.svg'),
		outputPath: join(buildRoot, 'icons/icon.png'),
	});
	const native = await stageMotionscaperNativePayload({ repositoryRoot, buildRoot, targetId: target.id,
		buildResultRoot: process.env.MOTIONSCAPER_NATIVE_BUILD_RESULT });
	const [platform, arch] = target.id.split('-');
	await writeJson(join(buildRoot, 'stage-manifest.json'), {
		schemaVersion: 1, productId: 'motionscaper', nativeServiceProfile: 'motionscaper-desktop-v1',
		applicationVersion: productMetadata.applicationVersion,
		applicationVersionChannel: productMetadata.applicationVersionChannel, releaseChannel: productMetadata.releaseChannel,
		sourceRevision, target: { platform, arch }, nativeCapabilities: ['project-files-v1', ...(native.helper ? ['prores-4444-v1'] : [])], desktopCodecPolicy: DESKTOP_CODEC_POLICY,
		files: await createMotionscaperStageInventory(buildRoot),
	});
	await verifyMotionscaperDesktopStage(buildRoot, target.id);
	console.log(`Prepared Motionscaper desktop ${productMetadata.applicationVersion} in ${buildRoot}`);
}

async function writeJson(path, value) { await writeFile(path, `${JSON.stringify(value, null, '\t')}\n`); }
