#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { assertMotionscaperPackagedSmoke } from '../desktop/motionscaper-packaged-smoke.ts';
import { parseMotionscaperNativePayload } from '../desktop/motionscaper-native-payload.ts';
import { verifyMotionscaperNativeBuildResult } from './lib/motionscaper-native-build-result.ts';
import { MOTION_NATIVE_TARGETS } from './lib/motionscaper-native-source.ts';
import { motionReleasePackageNames, pinMotionReleaseFile, releaseRecord, validateMotionReleaseReceipt, verifyMotionReleaseReceiptFiles } from './lib/motionscaper-release-inventory.ts';
import { stageMotionReleaseSources } from './lib/motionscaper-release-sources.ts';
import { verifyMotionRelease, type MotionReleaseChannel } from './lib/motionscaper-release-policy.ts';

export async function assembleMotionRelease(options: { root: string; inputs: string; nativeResults: string; output: string; evidence: string; sourceInputs: string; tag: string; expectedChannel?: MotionReleaseChannel }): Promise<void> {
	const release = verifyMotionRelease(options);
	const version = release.version; const revision = release.sourceRevision;
	const expectedDirectories = MOTION_NATIVE_TARGETS.map(target => `motionscaper-preview-${target}`).sort();
	if ((await readdir(options.inputs)).sort().join() !== expectedDirectories.join()) throw new Error('Motion release must contain exactly five target artifacts.');
	await mkdir(options.output, { recursive: false }); await mkdir(options.evidence, { recursive: false });
	const packagePins = [];
	for (const target of MOTION_NATIVE_TARGETS) {
		const root = join(options.inputs, `motionscaper-preview-${target}`);
		const receipt = validateMotionReleaseReceipt(await json(join(root, 'receipt.json')));
		if (receipt.target !== target || receipt.sourceRevision !== revision || receipt.applicationVersion !== version) throw new Error('Motion release target source/version identity changed.');
		if ((await readdir(root)).sort().join() !== [...receipt.files.map(file => file.path), 'receipt.json'].sort().join()) throw new Error('Motion target artifact inventory is not exact.');
		await verifyMotionReleaseReceiptFiles(root, receipt.files);
		const verified = await verifyMotionscaperNativeBuildResult({ repositoryRoot: options.root, resultRoot: join(options.nativeResults, `motionscaper-media-host-build-result-${target}`), target });
		const nativeReceipt = await pinMotionReleaseFile(root, 'native-build-result.json');
		if (nativeReceipt.sha256 !== verified.receiptSha256 || verified.receipt.sourceRevision !== revision) throw new Error('Motion release helper receipt differs from its independently verified build.');
		const payload = parseMotionscaperNativePayload(await json(join(root, 'native-payload.json')));
		if (!payload.helper || payload.target !== target || payload.helper.sha256 !== verified.receipt.payload.sha256 || payload.helper.receiptSha256 !== verified.receiptSha256) throw new Error('Motion release packaged helper identity changed.');
		const stage = releaseRecord(await json(join(root, 'stage-manifest.json')));
		const runtimeTarget = releaseRecord(stage.target);
		const stageFiles = Array.isArray(stage.files) ? stage.files.map((file: unknown) => releaseRecord(file)) : [];
		const helperPin = stageFiles.find(file => file.path === payload.helper?.path);
		const manifestPin = stageFiles.find(file => file.path === 'app/desktop/native-payload.json');
		const nativePayloadPin = receipt.files.find(file => file.path === 'native-payload.json')!;
		if (stage.schemaVersion !== 1 || stage.productId !== 'motionscaper' || stage.nativeServiceProfile !== 'motionscaper-desktop-v1'
			|| JSON.stringify(stage.nativeCapabilities) !== JSON.stringify(['project-files-v1', 'prores-4444-v1'])
			|| stage.sourceRevision !== revision || stage.applicationVersion !== version || `${String(runtimeTarget.platform)}-${String(runtimeTarget.arch)}` !== target
			|| helperPin?.sha256 !== payload.helper.sha256 || helperPin.byteLength !== payload.helper.byteLength
			|| manifestPin?.sha256 !== nativePayloadPin.sha256 || manifestPin.byteLength !== nativePayloadPin.byteLength) throw new Error('Motion release stage authority changed.');
		const [platform, arch] = target.split('-');
		assertMotionscaperPackagedSmoke(await readFile(join(root, 'smoke.txt'), 'utf8'), { platform: platform === 'mac' ? 'darwin' : platform === 'win' ? 'win32' : 'linux', arch: arch!, version, nativeProres: true });
		const targetEvidence = join(options.evidence, target); await mkdir(targetEvidence);
		await copyFile(join(root, 'receipt.json'), join(targetEvidence, 'receipt.json'), 1);
		for (const file of receipt.files) {
			const destination = motionReleasePackageNames(target, version).includes(file.path) ? options.output : targetEvidence;
			await copyFile(join(root, file.path), join(destination, file.path), 1);
			if (destination === options.output) packagePins.push(await pinMotionReleaseFile(destination, file.path));
		}
	}
	await stageMotionReleaseSources({ repositoryRoot: options.root, sourceRevision: revision, sourceInputsRoot: options.sourceInputs, outputRoot: options.output });
	const notices = ['THIRD_PARTY_LICENSES.md', 'native/motionscaper-media-host/THIRD_PARTY_NOTICES.md', 'native/framescaper-media-host/THIRD_PARTY_NOTICES.md'];
	await writeFile(join(options.output, 'THIRD_PARTY_LICENSES.md'), (await Promise.all(notices.map(path => readFile(join(options.root, path), 'utf8')))).join('\n\n'), { flag: 'wx' });
	const files = [...packagePins, await pinMotionReleaseFile(options.output, 'sources.zip'), await pinMotionReleaseFile(options.output, 'THIRD_PARTY_LICENSES.md')].sort((a, b) => a.path.localeCompare(b.path, 'en'));
	if (JSON.stringify(verifyMotionRelease(options)) !== JSON.stringify(release)) throw new Error('Motion release source changed during assembly.');
	await writeFile(join(options.output, 'SHA256SUMS'), files.map(file => `${file.sha256}  ${file.path}\n`).join(''), { flag: 'wx' });
	await writeFile(join(options.evidence, 'release-inventory.json'), `${JSON.stringify({ schemaVersion: 1, productId: 'motionscaper', tag: options.tag, channel: release.channel, sourceRevision: revision, applicationVersion: version, qualification: 'target-native-packaged-smoke; signing-and-installation-receipts-separate', files }, null, '\t')}\n`, { flag: 'wx' });
}
async function json(path: string): Promise<unknown> {
	const bytes = await pinMotionReleaseFile(resolve(path, '..'), path.split(/[\\/]/u).at(-1)!);
	if (bytes.byteLength > 8 * 1024 * 1024) throw new Error('Motion release metadata exceeds its bound.');
	return JSON.parse(await readFile(path, 'utf8')) as unknown;
}
export async function main(args = process.argv.slice(2)): Promise<void> {
	const { values } = parseArgs({ args, options: Object.fromEntries(['inputs', 'native-results', 'output', 'evidence', 'source-inputs', 'tag', 'expected-channel'].map(key => [key, { type: 'string' as const }])) });
	for (const key of ['inputs', 'native-results', 'output', 'evidence', 'source-inputs', 'tag']) if (typeof values[key] !== 'string' || !values[key]) throw new Error(`Motion preview assembly requires --${key}.`);
	const expectedChannel = values['expected-channel'] ?? 'candidate';
	if (expectedChannel !== 'candidate' && expectedChannel !== 'stable') throw new Error('Motion expected release channel must be candidate or stable.');
	await assembleMotionRelease({ root: resolve(import.meta.dirname, '..'), inputs: resolve(String(values.inputs)), nativeResults: resolve(String(values['native-results'])), output: resolve(String(values.output)), evidence: resolve(String(values.evidence)), sourceInputs: resolve(String(values['source-inputs'])), tag: String(values.tag), expectedChannel });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
