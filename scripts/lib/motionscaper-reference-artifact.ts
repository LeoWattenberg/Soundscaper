/* SPDX-License-Identifier: AGPL-3.0-only */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, copyFile, lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { verifyMotionscaperNativeBuildResult } from './motionscaper-native-build-result.ts';
import type { MotionNativeTarget } from './motionscaper-native-source.ts';
import { assertSoundscaperNativeBinaryArchitecture } from './soundscaper-native-binary-architecture.mjs';

const DECODER = 'motion-reference-decoder', NOTICES = 'THIRD_PARTY_NOTICES.md', RECEIPT = 'reference-receipt.json';
const SOURCES = ['scripts/lib/motionscaper-native-reference.cpp', 'desktop/motionscaper-native-reference.ts'] as const;
interface Options { readonly repositoryRoot: string; readonly nativeResult: string; readonly target: MotionNativeTarget }
interface FilePin { readonly path: string; readonly byteLength: number; readonly sha256: string }

/** A closed expected record is assembled from independently verified source/helper and actual files. */
export function validateMotionReferenceReceipt(value: unknown, expected: Readonly<Record<string, unknown>>): void {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| JSON.stringify(value) !== JSON.stringify(expected)) throw new Error('Motion reference receipt differs from its exact source, helper or file closure.');
}

export async function createMotionReferenceArtifact(options: Options & { readonly decoder: string; readonly output: string }): Promise<void> {
	await mkdir(options.output, { recursive: false });
	await copyFile(options.decoder, join(options.output, DECODER), 1);
	const native = await verifyMotionscaperNativeBuildResult({ repositoryRoot: options.repositoryRoot, resultRoot: options.nativeResult, target: options.target });
	await copyFile(join(native.resultRoot, native.receipt.notices.path), join(options.output, NOTICES), 1);
	const receipt = await expectedReceipt(options, options.output);
	await writeFile(join(options.output, RECEIPT), `${JSON.stringify(receipt, null, '\t')}\n`, { flag: 'wx' });
	await verifyMotionReferenceArtifact({ ...options, artifact: options.output });
}

export async function verifyMotionReferenceArtifact(options: Options & { readonly artifact: string }): Promise<string> {
	const root = resolve(options.artifact), stat = await lstat(root);
	if (!isAbsolute(options.artifact) || options.artifact !== root || !stat.isDirectory() || stat.isSymbolicLink() || await realpath(root) !== root) throw new Error('Motion reference artifact path must be a canonical directory.');
	if (JSON.stringify((await readdir(root)).sort()) !== JSON.stringify([DECODER, NOTICES, RECEIPT].sort())) throw new Error('Motion reference artifact inventory differs.');
	const bytes = await bounded(join(root, RECEIPT), 16384), expected = await expectedReceipt(options, root);
	const receipt: unknown = JSON.parse(bytes.toString('utf8')); validateMotionReferenceReceipt(receipt, expected);
	if (!bytes.equals(Buffer.from(`${JSON.stringify(receipt, null, '\t')}\n`))) throw new Error('Motion reference receipt is not canonical JSON.');
	// Artifact transport does not preserve executable bits. Grant execution only after verification.
	await chmod(join(root, DECODER), 0o755); return join(root, DECODER);
}

async function expectedReceipt(options: Options, directory: string): Promise<Readonly<Record<string, unknown>>> {
	if (!options.target.startsWith('linux-') || process.platform !== 'linux' || options.target !== `linux-${process.arch}`) throw new Error('Reference artifacts require the matching Linux target.');
	const native = await verifyMotionscaperNativeBuildResult({ repositoryRoot: options.repositoryRoot, resultRoot: options.nativeResult, target: options.target });
	const sourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: options.repositoryRoot, encoding: 'utf8' }).trim();
	if (!/^[a-f0-9]{40}$/u.test(sourceRevision)) throw new Error('Reference source revision is invalid.');
	const sourceFiles: FilePin[] = [];
	for (const path of SOURCES) {
		const bytes = await bounded(join(options.repositoryRoot, path), 1024 * 1024);
		const committed = execFileSync('git', ['show', `${sourceRevision}:${path}`], { cwd: options.repositoryRoot, maxBuffer: 1024 * 1024 });
		if (!committed.equals(bytes)) throw new Error('Reference source differs from its committed revision.');
		sourceFiles.push(pin(path, bytes));
	}
	const decoder = await bounded(join(directory, DECODER), 64 * 1024 * 1024); assertSoundscaperNativeBinaryArchitecture(decoder, options.target);
	const notices = await bounded(join(directory, NOTICES), 2 * 1024 * 1024);
	if (!notices.equals(await bounded(join(native.resultRoot, native.receipt.notices.path), 2 * 1024 * 1024))) throw new Error('Reference notices differ from the pinned static codec closure.');
	return { schemaVersion: 1, artifactKind: 'motionscaper-reference-decoder', target: options.target, sourceRevision,
		nativeBuildReceiptSha256: native.receiptSha256, nativeHelperSha256: native.receipt.payload.sha256, nativeSourceManifestSha256: native.receipt.sourceManifestSha256,
		sourceFiles, decoder: pin(DECODER, decoder), notices: pin(NOTICES, notices) };
}
function pin(path: string, bytes: Buffer): FilePin { return { path, byteLength: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') }; }
async function bounded(path: string, maximum: number): Promise<Buffer> {
	const stat = await lstat(path); if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > maximum) throw new Error('Motion reference file exceeds regular bounded admission.');
	const bytes = await readFile(path); if (bytes.length !== stat.size) throw new Error('Motion reference file changed while reading.'); return bytes;
}
