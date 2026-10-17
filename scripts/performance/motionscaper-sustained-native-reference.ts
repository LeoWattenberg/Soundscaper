/* SPDX-License-Identifier: AGPL-3.0-only */
import { readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { verifyMotionscaperNativeBuildResult } from '../lib/motionscaper-native-build-result.ts';
import { motionSustainedCommand } from './motionscaper-sustained-command.ts';
import { hashMotionSustainedFile } from './motionscaper-sustained-observation.ts';
import { inspectMotionSustainedNativeMetadata, MotionSustainedPcmOracle } from './motionscaper-sustained-oracle.ts';
import { verifyMotionSustainedReferenceAuthority } from './motionscaper-sustained-reference-authority.ts';

/** Builds a separate external decoder only after run-plan approval; no runtime inventory changes. */
export async function prepareMotionSustainedDecoder(root: string, directory: string, prefix: string, nativeResult: string,
	approvedClosure: Readonly<{ path: string; sha256: string }>) {
	if (!/^[A-Za-z0-9_./-]+$/u.test(prefix) || process.platform !== 'linux' || process.arch !== 'x64') throw new Error('Sustained reference requires the reviewed Linux x64 prefix.');
	const native = await verifyMotionscaperNativeBuildResult({ repositoryRoot: root, resultRoot: nativeResult, target: 'linux-x64' });
	const authority = await verifyMotionSustainedReferenceAuthority(approvedClosure.path, approvedClosure.sha256, prefix, native.receiptSha256);
	const libraries = [];
	for (const name of (await readdir(join(prefix, 'lib'))).filter(name => /^lib[\w-]+\.a$/u.test(name)).sort()) libraries.push(await hashMotionSustainedFile(join(prefix, 'lib', name), 512 * 1024 * 1024));
	if (!libraries.some(value => value.path.endsWith('/libavcodec.a')) || !libraries.some(value => value.path.endsWith('/libswscale.a'))) throw new Error('Missing pinned reference libraries.');
	const env: NodeJS.ProcessEnv = { ...process.env, PKG_CONFIG_LIBDIR: join(prefix, 'lib/pkgconfig') };
	for (const key of ['PKG_CONFIG_PATH', 'PKG_CONFIG_SYSROOT_DIR', 'CPATH', 'C_INCLUDE_PATH', 'CPLUS_INCLUDE_PATH', 'LIBRARY_PATH', 'LD_LIBRARY_PATH']) delete env[key];
	const flags = await motionSustainedCommand({ command: 'pkg-config', args: ['--cflags', '--libs', '--static', 'libavformat', 'libavcodec', 'libswscale', 'libavutil'],
		cwd: root, directory, id: 'decoder-flags', env });
	const tokens = flags.stdout.trim().split(/\s+/u); if (!tokens.length || tokens.some(value => !/^[A-Za-z0-9_./=+-]+$/u.test(value))) throw new Error('Unexpected decoder link flags.');
	authority.verifyFlags(tokens);
	const source = await hashMotionSustainedFile(join(root, 'scripts/lib/motionscaper-sustained-reference.cpp'), 1024 * 1024);
	const executable = join(directory, 'motion-sustained-reference-decoder');
	const compile = await motionSustainedCommand({ command: 'c++', args: ['-std=c++20', '-O2', '-Wall', '-Wextra', '-Werror', source.path, '-o', executable, ...tokens], cwd: root, directory, id: 'decoder-compile', env });
	const binary = await hashMotionSustainedFile(executable, 64 * 1024 * 1024);
	for (const library of libraries) if ((await hashMotionSustainedFile(library.path)).sha256 !== library.sha256) throw new Error('Reference library changed during compilation.');
	await verifyMotionSustainedReferenceAuthority(approvedClosure.path, approvedClosure.sha256, prefix, native.receiptSha256);
	const receipt = { source, binary, libraries, approvedPrefixClosure: authority.pin, flags: flags.receipt, compile: compile.receipt,
		nativeBuildReceiptSha256: native.receiptSha256, nativeHelperSha256: native.receipt.payload.sha256, nativeSourceManifestSha256: native.receipt.sourceManifestSha256 };
	await writeFile(join(directory, 'sustained-reference-receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
	return { executable, receipt };
}
/** Only3selected picture bodies are retained; duration-sized PCM is read in64KiB windows. */
export async function decodeMotionSustainedNative(executable: string, movie: string, directory: string, frames: 300 | 1200) {
	const input = await hashMotionSustainedFile(movie);
	const picturePath = join(directory, 'selected.rgba'), pcmPath = join(directory, 'reference.pcm');
	const decoded = await motionSustainedCommand({ command: executable, args: [movie, picturePath, pcmPath, String(frames)], cwd: directory, directory, id: 'decode', timeoutMs: 600000 });
	if ((await hashMotionSustainedFile(movie)).sha256 !== input.sha256) throw new Error('Native output changed during reference decode.');
	const metadata = inspectMotionSustainedNativeMetadata(JSON.parse(decoded.stdout) as unknown, frames, (await stat(picturePath)).size, (await stat(pcmPath)).size);
	const bytes = new Uint8Array(3 * 160 * 90 * 16); let offset = 0;
	const pictures = await hashMotionSustainedFile(picturePath, bytes.length, block => { bytes.set(block, offset); offset += block.length; });
	const oracle = new MotionSustainedPcmOracle(frames * 1600);
	const pcm = await hashMotionSustainedFile(pcmPath, frames * 1600 * 8, block => oracle.write(block));
	return { input, metadata, pictures, pcm, pcmOracle: oracle.finish(), rgba: new Float32Array(bytes.buffer), decoderCommand: decoded.receipt };
}
