/* SPDX-License-Identifier: AGPL-3.0-only */
import { createHash } from 'node:crypto';
import { chmod, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { MOTION_NATIVE_PAYLOAD_TARGETS, loadMotionscaperNativeExecutable, motionscaperNativePayloadPath, type MotionNativePayloadManifest } from '../../desktop/motionscaper-native-payload.ts';
import { verifyMotionscaperNativeBuildResult } from './motionscaper-native-build-result.ts';
export async function stageMotionscaperNativePayload(options: {
	readonly repositoryRoot: string; readonly buildRoot: string; readonly targetId: string; readonly buildResultRoot?: string;
}): Promise<MotionNativePayloadManifest> {
	const target = MOTION_NATIVE_PAYLOAD_TARGETS.find(target => target === options.targetId);
	if (!target) throw new Error('Motionscaper native staging target is invalid.');
	const verified = options.buildResultRoot ? await verifyMotionscaperNativeBuildResult({ repositoryRoot: options.repositoryRoot,
		resultRoot: options.buildResultRoot, target }) : null;
	const manifest: MotionNativePayloadManifest = { schemaVersion: 1, productId: 'motionscaper', helperContractVersion: 1,
		carrierVersion: 1, target, helper: verified ? { ...verified.receipt.payload, path: motionscaperNativePayloadPath(target), receiptSha256: verified.receiptSha256 } : null };
	let notices = '';
	if (verified && manifest.helper) {
		const destination = join(options.buildRoot, manifest.helper.path);
		await mkdir(dirname(destination), { recursive: true });
		await copyFile(join(verified.resultRoot, verified.receipt.payload.path), destination, 1);
		await chmod(destination, 0o555);
		notices = await readFile(join(verified.resultRoot, verified.receipt.notices.path), 'utf8');
		if (Buffer.byteLength(notices) !== verified.receipt.notices.byteLength || createHash('sha256').update(notices).digest('hex') !== verified.receipt.notices.sha256) throw new Error('Motionscaper native notices changed while staging.');
		await loadMotionscaperNativeExecutable(options.buildRoot, manifest);
	}
	await writeFile(join(options.buildRoot, 'app/desktop/native-payload.json'), `${JSON.stringify(manifest, null, '\t')}\n`, { flag: 'wx' });
	await writeFile(join(options.buildRoot, 'app/desktop/native-notices.md'), notices, { flag: 'wx' });
	return manifest;
}
