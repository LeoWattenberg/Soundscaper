#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { assertMotionscaperPackagedSmoke, runMotionscaperSmokeProcess } from '../desktop/motionscaper-packaged-smoke.ts';
import { verifyMotionscaperDesktopStage, verifyMotionscaperPackagedResources } from './lib/motionscaper-desktop-package.mjs';
import { verifyMotionscaperNativeBuildResult } from './lib/motionscaper-native-build-result.ts';
import { MOTION_NATIVE_TARGETS, type MotionNativeTarget } from './lib/motionscaper-native-source.ts';
import { resolvePackagedProductExecutable } from './lib/desktop-packaged-product-executable.mjs';
import { readProductReleaseLinesSync, resolveProductApplicationVersion } from './lib/product-release-lines.mjs';
import { MOTION_RELEASE_EVIDENCE, motionReleasePackageNames, pinMotionReleaseFile, releaseRecord, validateMotionReleaseReceipt } from './lib/motionscaper-release-inventory.ts';

export async function qualifyMotionReleaseTarget(options: { root: string; target: MotionNativeTarget; nativeResult: string; productRoot: string; output: string }): Promise<void> {
	const sourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: options.root, encoding: 'utf8' }).trim();
	const applicationVersion = resolveProductApplicationVersion('motionscaper', readProductReleaseLinesSync(options.root));
	const [platform, arch] = options.target.split('-'); const nativePlatform = platform === 'mac' ? 'darwin' : platform === 'win' ? 'win32' : 'linux';
	if (nativePlatform !== process.platform || arch !== process.arch) throw new Error('Motion release smoke must execute on its native target.');
	const verified = await verifyMotionscaperNativeBuildResult({ repositoryRoot: options.root, resultRoot: options.nativeResult, target: options.target });
	const stage: unknown = await verifyMotionscaperDesktopStage(join(options.root, '.desktop-build'), options.target); const identity = releaseRecord(stage);
	if (identity.sourceRevision !== sourceRevision || verified.receipt.sourceRevision !== sourceRevision || identity.applicationVersion !== applicationVersion
		|| JSON.stringify(identity.nativeCapabilities) !== JSON.stringify(['project-files-v1', 'prores-4444-v1'])) throw new Error('Motion release stage lacks exact source, version or helper authority.');
	const executable = resolvePackagedProductExecutable({ productRoot: options.productRoot, productId: 'motionscaper', platform: nativePlatform, arch });
	const resources = nativePlatform === 'darwin' ? resolve(dirname(executable), '../Resources') : join(dirname(executable), 'resources');
	await verifyMotionscaperPackagedResources(resources, stage);
	const profile = await mkdtemp(join(tmpdir(), 'motionscaper-release-smoke-'));
	let smoke: string;
	try {
		smoke = await runMotionscaperSmokeProcess({ command: executable, args: ['--motionscaper-shell-smoke', '--disable-gpu', `--user-data-dir=${profile}`], cwd: options.root, environment: process.env });
		assertMotionscaperPackagedSmoke(smoke, { platform: nativePlatform, arch: arch!, version: applicationVersion, nativeProres: true });
	} finally { await rm(profile, { recursive: true, force: true, maxRetries: 4, retryDelay: 250 }); }
	await mkdir(options.output, { recursive: false });
	const names = motionReleasePackageNames(options.target, applicationVersion);
	for (const name of names) {
		const input = join(options.productRoot, 'motionscaper'); await pinMotionReleaseFile(input, name);
		await copyFile(join(input, name), join(options.output, name), 1);
	}
	await copyFile(join(options.root, '.desktop-build/stage-manifest.json'), join(options.output, 'stage-manifest.json'), 1);
	await copyFile(join(options.nativeResult, 'build-result.json'), join(options.output, 'native-build-result.json'), 1);
	await copyFile(join(options.root, '.desktop-build/app/desktop/native-payload.json'), join(options.output, 'native-payload.json'), 1);
	await writeFile(join(options.output, 'smoke.txt'), smoke, { flag: 'wx' });
	const files = []; for (const name of [...names, ...MOTION_RELEASE_EVIDENCE]) files.push(await pinMotionReleaseFile(options.output, name));
	const receipt = validateMotionReleaseReceipt({ schemaVersion: 1, productId: 'motionscaper', target: options.target, applicationVersion, sourceRevision, files });
	await writeFile(join(options.output, 'receipt.json'), `${JSON.stringify(receipt, null, '\t')}\n`, { flag: 'wx' });
}
export async function main(args = process.argv.slice(2)): Promise<void> {
	const { values } = parseArgs({ args, options: { target: { type: 'string' }, 'native-result': { type: 'string' }, 'product-root': { type: 'string' }, output: { type: 'string' } } });
	const target = MOTION_NATIVE_TARGETS.find(target => target === values.target);
	if (!target || !values['native-result'] || !values['product-root'] || !values.output) throw new Error('Motion target qualification requires --target, --native-result, --product-root and --output.');
	await qualifyMotionReleaseTarget({ root: resolve(import.meta.dirname, '..'), target, nativeResult: resolve(values['native-result']), productRoot: resolve(values['product-root']), output: resolve(values.output) });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
