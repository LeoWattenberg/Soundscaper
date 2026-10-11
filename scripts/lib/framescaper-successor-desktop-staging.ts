/* SPDX-License-Identifier: AGPL-3.0-only */
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { build } from 'esbuild';
import { generateDesktopIcon } from '../desktop-icons.mjs';
import { framescaperBuildApplicationVersion } from './product-build-line.mjs';
import { resolveNativeAddonPayloadTarget } from './native-addon-payload-manifest.mjs';
import { DESKTOP_CODEC_POLICY } from './desktop-codec-policy.mjs';
import { normalizeFramescaperSuccessorDesktopMetadata } from '../../desktop/framescaper-successor-contract.ts';
import { createFramescaperSuccessorStageInventory, verifyFramescaperSuccessorDesktopStage } from './framescaper-successor-desktop-package.ts';
interface Options {
	readonly repositoryRoot: string; readonly buildRoot: string; readonly sourceRevision: string;
	buildRenderer(options: Readonly<{ repositoryRoot: string; rendererRoot: string; productId: 'framescaper'; environment: NodeJS.ProcessEnv; buildSmoke: () => Promise<void> }>): Promise<void>;
}
/** A separately selected development application; baseline native library/runtime staging is never entered. */
export async function prepareFramescaperSuccessorDesktop(options: Options): Promise<void> {
	const { repositoryRoot, buildRoot, sourceRevision } = options;
	if (!/^[a-f\d]{40}(?:[a-f\d]{24})?$/u.test(sourceRevision)) throw new TypeError('Successor source revision must be immutable.');
	const version = framescaperBuildApplicationVersion(repositoryRoot, 'successor', '');
	const metadata = normalizeFramescaperSuccessorDesktopMetadata({ schemaVersion: 1, id: 'framescaper', line: 'successor', desktopProfile: 'framescaper-successor-v2', applicationVersion: version, projectSchemaVersion: 2, releaseEligible: false });
	const target = resolveNativeAddonPayloadTarget({ platform: process.env.SOUNDSCAPER_DESKTOP_TARGET_PLATFORM ?? null, arch: process.env.SOUNDSCAPER_DESKTOP_TARGET_ARCH ?? null });
	await rm(buildRoot, { recursive: true, force: true });
	for (const directory of ['app/desktop', 'renderer', 'runtime', 'licenses']) await mkdir(join(buildRoot, directory), { recursive: true });
	await options.buildRenderer({ repositoryRoot, rendererRoot: join(buildRoot, 'renderer'), productId: 'framescaper',
		environment: { ...process.env, SCAPE_PRODUCT: 'framescaper', SCAPE_FRAMESCAPER_LINE: 'successor', SCAPE_FRAMESCAPER_DESKTOP_PROFILE: metadata.desktopProfile }, buildSmoke: async () => {} });
	for (const [source, output, format] of [['framescaper-successor-main.ts', 'main.mjs', 'esm'], ['framescaper-successor-preload.ts', 'preload.cjs', 'cjs']] as const) {
		await build({ entryPoints: [join(repositoryRoot, 'desktop', source)], outfile: join(buildRoot, 'app/desktop', output), bundle: true, platform: 'node', target: 'node26', format, external: ['electron'], logLevel: 'silent' });
	}
	const projectPackage = JSON.parse(await readFile(join(repositoryRoot, 'package.json'), 'utf8')) as Record<string, unknown>;
	await writeJson(join(buildRoot, 'app/package.json'), { name: 'framescaper-successor-desktop', productName: 'Framescaper Development', version, description: 'Framescaper 1.1 development with linked motion compositions',
		main: 'desktop/main.mjs', type: 'module', license: projectPackage.license, author: projectPackage.author });
	await writeJson(join(buildRoot, 'app/desktop/product.json'), metadata);
	await cp(join(repositoryRoot, 'THIRD_PARTY_LICENSES.md'), join(buildRoot, 'licenses/THIRD_PARTY_LICENSES.md'));
	await generateDesktopIcon({ sourcePath: join(repositoryRoot, 'public/logo/framescaper.svg'), outputPath: join(buildRoot, 'icons/icon.png') });
	const [platform, arch] = target.id.split('-');
	await writeJson(join(buildRoot, 'stage-manifest.json'), { schemaVersion: 1, productId: 'framescaper', line: 'successor', nativeServiceProfile: metadata.desktopProfile,
		applicationVersion: version, releaseEligible: false, sourceRevision, target: { platform, arch }, nativeCapabilities: ['motion-saved-files-v1'], desktopCodecPolicy: DESKTOP_CODEC_POLICY,
		files: await createFramescaperSuccessorStageInventory(buildRoot) });
	await verifyFramescaperSuccessorDesktopStage(buildRoot, target.id);
	console.log(`Prepared Framescaper successor ${version} in ${buildRoot}`);
}
async function writeJson(path: string, value: unknown): Promise<void> { await writeFile(path, `${JSON.stringify(value, null, '\t')}\n`); }
