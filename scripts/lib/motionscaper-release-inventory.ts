/* SPDX-License-Identifier: AGPL-3.0-only */
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { lstat, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { MOTION_NATIVE_TARGETS, type MotionNativeTarget, type MotionNativeFilePin } from './motionscaper-native-source.ts';
import { motionReleaseVersionChannel } from './motionscaper-release-policy.ts';

export const MOTION_RELEASE_EVIDENCE = ['stage-manifest.json', 'native-build-result.json', 'native-payload.json', 'smoke.txt'] as const;
export interface MotionReleaseReceipt {
	readonly schemaVersion: 1; readonly productId: 'motionscaper'; readonly target: MotionNativeTarget;
	readonly applicationVersion: string; readonly sourceRevision: string; readonly files: readonly MotionNativeFilePin[];
}
export function motionReleasePackageNames(target: MotionNativeTarget, version: string): readonly string[] {
	if (!MOTION_NATIVE_TARGETS.includes(target)) throw new Error('Motion release target is invalid.');
	motionReleaseVersionChannel(version);
	const suffixes = target.startsWith('linux-') ? ['AppImage', 'deb'] : target.startsWith('win-') ? ['exe', 'zip'] : ['dmg'];
	return suffixes.map(suffix => `Motionscaper-${version}-${target}.${suffix}`);
}
export function validateMotionReleaseReceipt(input: unknown): MotionReleaseReceipt {
	const value = releaseRecord(input);
	if (Object.keys(value).sort().join() !== ['schemaVersion', 'productId', 'target', 'applicationVersion', 'sourceRevision', 'files'].sort().join()
		|| value.schemaVersion !== 1 || value.productId !== 'motionscaper' || typeof value.sourceRevision !== 'string' || !/^[a-f\d]{40}$/u.test(value.sourceRevision)
		|| typeof value.applicationVersion !== 'string') throw new Error('Motion release receipt identity is invalid.');
	const target = MOTION_NATIVE_TARGETS.find(target => target === value.target); if (!target) throw new Error('Motion release target is invalid.');
	const expected = [...motionReleasePackageNames(target, value.applicationVersion), ...MOTION_RELEASE_EVIDENCE].sort();
	if (!Array.isArray(value.files) || value.files.length !== expected.length) throw new Error('Motion release inventory is incomplete.');
	const files = value.files.map((input: unknown): MotionNativeFilePin => {
		const file = releaseRecord(input);
		if (Object.keys(file).sort().join() !== 'byteLength,path,sha256' || typeof file.path !== 'string' || !expected.includes(file.path)
			|| typeof file.byteLength !== 'number' || !Number.isSafeInteger(file.byteLength) || file.byteLength < 1 || file.byteLength > 4 * 1024 ** 3
			|| typeof file.sha256 !== 'string' || !/^[a-f\d]{64}$/u.test(file.sha256)) throw new Error('Motion release file pin is invalid.');
		return { path: file.path, byteLength: file.byteLength, sha256: file.sha256 };
	});
	if (files.map(file => file.path).sort().join() !== expected.join()) throw new Error('Motion release inventory is not exact.');
	return { schemaVersion: 1, productId: 'motionscaper', target, applicationVersion: value.applicationVersion, sourceRevision: value.sourceRevision, files };
}
export async function pinMotionReleaseFile(root: string, name: string): Promise<MotionNativeFilePin> {
	if (!/^[A-Za-z\d][A-Za-z\d._+-]*$/u.test(name)) throw new Error('Motion release path is invalid.');
	const path = resolve(root, name); const before = await lstat(path);
	if (!before.isFile() || before.isSymbolicLink() || before.size < 1 || before.size > 4 * 1024 ** 3 || await realpath(path) !== path) throw new Error('Motion release input is not one bounded regular file.');
	const hash = createHash('sha256'); let size = 0;
	for await (const chunk of createReadStream(path)) { size += Buffer.byteLength(chunk); if (size > before.size) throw new Error('Motion release input changed.'); hash.update(chunk); }
	const after = await lstat(path);
	if (size !== before.size || before.ino !== after.ino || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw new Error('Motion release input changed.');
	return { path: name, byteLength: size, sha256: hash.digest('hex') };
}
export async function verifyMotionReleaseReceiptFiles(root: string, files: readonly MotionNativeFilePin[]): Promise<void> {
	for (const expected of files) {
		const actual = await pinMotionReleaseFile(root, expected.path);
		if (actual.sha256 !== expected.sha256 || actual.byteLength !== expected.byteLength) throw new Error(`Motion release input changed: ${join(root, expected.path)}`);
	}
}
export function releaseRecord(input: unknown): Record<string, unknown> {
	if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Motion release record is invalid.');
	return input as Record<string, unknown>;
}
