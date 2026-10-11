/* SPDX-License-Identifier: AGPL-3.0-only */
import { createHash } from 'node:crypto';
import { mkdir, open, readFile, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { verifyMotionscaperNativeSourceManifest } from './motionscaper-native-source.ts';
import { readFramescaperMediaHostSourceManifest } from './framescaper-media-host-build.mjs';
import { stageDesktopReleaseSources } from './desktop-release-sources.mjs';
import { releaseRecord } from './motionscaper-release-inventory.ts';

export interface MotionReleaseSource { readonly id: string; readonly path: string; readonly url: string; readonly byteLength: number; readonly sha256: string }
export async function motionReleaseSourcePlan(root: string): Promise<readonly MotionReleaseSource[]> {
	await verifyMotionscaperNativeSourceManifest(root);
	const dependency: unknown = readFramescaperMediaHostSourceManifest(root); const manifest = releaseRecord(dependency);
	const ffmpeg = releaseRecord(manifest.ffmpeg); const boost = releaseRecord(JSON.parse(await readFile(join(root, 'config/boost-multiprecision-source-manifest.json'), 'utf8')) as unknown);
	const boostSource = releaseRecord(boost.source);
	const externalPath = 'build/ffmpeg-9.0.1-external-sources.json';
	const externalBytes = await readFile(join(root, 'native/framescaper-media-host', externalPath));
	const externalPin = Array.isArray(manifest.sourceFiles) ? manifest.sourceFiles.map((entry: unknown) => releaseRecord(entry)).find(entry => entry.path === externalPath) : undefined;
	if (!externalPin || externalPin.byteLength !== externalBytes.length || externalPin.sha256 !== digest(externalBytes)) throw new Error('Motion corresponding-source codec pins changed.');
	const external = releaseRecord(JSON.parse(externalBytes.toString('utf8')) as unknown);
	if (!Array.isArray(external.libraries)) throw new Error('Motion codec source inventory is invalid.');
	const plan = [source('ffmpeg', ffmpeg.url, ffmpeg.byteLength, ffmpeg.sha256),
		source('boost', boostSource.archiveUrl, boostSource.archiveByteLength, boostSource.sha256),
		...external.libraries.map((value: unknown) => { const item = releaseRecord(value); return source(item.id, item.url, item.byteLength, item.sha256); })];
	if (plan.map(source => source.id).join() !== 'ffmpeg,boost,x264,x265,libvpx,libopus,zlib'
		|| plan.reduce((sum, item) => sum + item.byteLength, 0) > 384 * 1024 ** 2) throw new Error('Motion corresponding-source closure exceeds its admission.');
	return plan;
}
function source(id: unknown, url: unknown, byteLength: unknown, sha256: unknown): MotionReleaseSource {
	if (typeof id !== 'string' || !/^[a-z\d]+$/u.test(id) || typeof url !== 'string' || !url.startsWith('https://')
		|| typeof byteLength !== 'number' || !Number.isSafeInteger(byteLength) || byteLength < 1 || byteLength > 256 * 1024 ** 2
		|| typeof sha256 !== 'string' || !/^[a-f\d]{64}$/u.test(sha256)) throw new Error('Motion corresponding-source pin is invalid.');
	const path = `${id}-${basename(new URL(url).pathname)}`;
	if (!/^[A-Za-z\d][A-Za-z\d._+-]*$/u.test(path)) throw new Error('Motion corresponding-source archive name is invalid.');
	return { id, path, url, byteLength, sha256 };
}
export async function stageMotionReleaseSources(options: { repositoryRoot: string; sourceRevision: string; sourceInputsRoot: string; outputRoot: string }, fetchImpl: typeof fetch = fetch): Promise<void> {
	const plan = await motionReleaseSourcePlan(options.repositoryRoot); await mkdir(options.sourceInputsRoot, { recursive: false });
	try {
		for (const source of plan) await downloadMotionReleaseSource(source, join(options.sourceInputsRoot, source.path), fetchImpl);
		await stageDesktopReleaseSources({ ...options, inputs: plan.map(source => ({ name: source.path, bundlePath: `bundled-codecs/${source.id}/${source.path}`, byteLength: source.byteLength, sha256: source.sha256 })) });
	} finally { await rm(options.sourceInputsRoot, { recursive: true, force: true }); }
}
export async function downloadMotionReleaseSource(source: MotionReleaseSource, destination: string, fetchImpl: typeof fetch = fetch): Promise<void> {
	const response = await fetchImpl(source.url, { redirect: 'follow', signal: AbortSignal.timeout(300_000) });
	if (!response.ok || !response.body || !response.url.startsWith('https://')) throw new Error('Motion corresponding-source download failed.');
	const handle = await open(destination, 'wx', 0o600); const hash = createHash('sha256'); let size = 0; let complete = false;
	try {
		for await (const chunk of response.body) {
			size += chunk.byteLength; if (size > source.byteLength) throw new Error('Motion corresponding-source download exceeds its pin.'); hash.update(chunk);
			let offset = 0; while (offset < chunk.byteLength) { const result = await handle.write(chunk.subarray(offset)); if (!result.bytesWritten) throw new Error('Motion source write stalled.'); offset += result.bytesWritten; }
		}
		if (size !== source.byteLength || hash.digest('hex') !== source.sha256) throw new Error('Motion corresponding-source download changed.');
		await handle.sync(); complete = true;
	} finally { try { await handle.close(); } finally { if (!complete) await rm(destination, { force: true }); } }
}
function digest(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }
