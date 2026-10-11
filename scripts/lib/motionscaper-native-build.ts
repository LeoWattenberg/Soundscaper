/* SPDX-License-Identifier: AGPL-3.0-only */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { createFramescaperMediaHostBuildRecipe, executeFramescaperMediaHostBuildRecipe } from '../../native/framescaper-media-host/build/recipe-driver.mjs';
import { writeFramescaperMediaHostToolchainReceipt } from './framescaper-media-host-toolchain.mjs';
import { validateSoundscaperProfessionalNativeDependencyClosure, inspectSoundscaperProfessionalNativeDependencies } from './soundscaper-professional-native-dependency-inspection.mjs';
import { MOTION_NATIVE_SOURCE_MANIFEST, MOTION_NATIVE_SOURCE_ROOT, MOTION_NATIVE_TARGETS, verifyMotionscaperNativeSourceManifest } from './motionscaper-native-source.ts';
import type { MotionNativeTarget } from './motionscaper-native-source.ts';

interface BuildCommand { readonly phase: string; readonly executable: string; readonly args: readonly string[]; readonly cwd: string; readonly environment: Readonly<Record<string, string>> }
interface DependencyRecipe { readonly commands: readonly BuildCommand[] }
interface Toolchain { readonly path: string; readonly receipt: {
	readonly identitySha256: string; readonly executables: Readonly<Record<'cmake' | 'ninja' | 'c' | 'cxx' | 'pkgConfig', { readonly path: string }>>;
} }
export interface MotionNativeBuildOptions {
	readonly repositoryRoot: string; readonly target: MotionNativeTarget; readonly workRoot: string;
	readonly outputRoot: string; readonly ffmpegSourceRoot: string; readonly boostSourceRoot: string; readonly externalSourceRoot: string;
}
export const MOTION_NATIVE_PRECISION = Object.freeze({
	carrierPixelFormat: 'rgba-f32le', carrierColorSpace: 'linear-rec709-d65', carrierAlphaMode: 'premultiplied',
	encoderPixelFormat: 'yuva444p10', encoderInputBits: 10, alphaStorageBits: 16,
	outputColorSpace: 'rec709', outputAlphaMode: 'straight', audioCarrierFormat: 'f32le', audioCodec: 'pcm-s24le', audioOutputBits: 24,
});
export const MOTION_NATIVE_SELF_TEST = Object.freeze({ productId: 'motionscaper', helperContractVersion: 1,
	carrierVersion: 1, operation: 'prores-4444', inputPixelFormat: 'rgba-f32le',
	encoderPixelFormat: 'yuva444p10', colorSpace: 'rec709', alphaMode: 'straight', maximumFrames: 32_768, pcmCarrierVersion: 1, audioCodec: 'pcm-s24le', maximumAudioSamples: 134_217_728 });

/** Reuses authenticated codec build inputs, never a foreign runtime capability or payload. */
export async function buildMotionscaperNativeHost(options: MotionNativeBuildOptions): Promise<unknown> {
	if (!MOTION_NATIVE_TARGETS.includes(options.target)) throw new TypeError('Unsupported Motionscaper native target.');
	const root = await directory(options.repositoryRoot);
	const sourceManifest = await verifyMotionscaperNativeSourceManifest(root);
	const sourceBytes = await readFile(join(root, MOTION_NATIVE_SOURCE_MANIFEST));
	const work = await exclusiveDirectory(options.workRoot);
	const output = await absentPath(options.outputRoot);
	await directory(dirname(output));
	const dependencies = await exclusiveDirectory(join(work, 'media-build'));
	const toolchain = writeFramescaperMediaHostToolchainReceipt({ targetId: options.target,
		path: join(work, 'media-toolchain.json') }) as unknown as Toolchain;
	const recipe = createFramescaperMediaHostBuildRecipe({ repositoryRoot: root, targetId: options.target,
		hostRuntime: `${process.platform}-${process.arch}`, toolchainReceipt: toolchain.path,
		toolchainIdentity: toolchain.receipt.identitySha256, outputRoot: dependencies,
		ffmpegSourceRoot: await directory(options.ffmpegSourceRoot), boostSourceRoot: await directory(options.boostSourceRoot),
		externalSourceRoot: await directory(options.externalSourceRoot),
	}) as DependencyRecipe;
	executeFramescaperMediaHostBuildRecipe(recipe);
	const configured = recipe.commands.find(command => command.phase === 'host-configure');
	if (!configured) throw new Error('The authenticated dependency recipe has no native configuration.');
	const buildRoot = join(work, 'motion-build');
	const installRoot = join(work, 'motion-install');
	const commandPrefix = configured.args.find(argument => argument.startsWith('-DCMAKE_PREFIX_PATH='));
	if (!commandPrefix) throw new Error('The authenticated dependency recipe has no static library prefix.');
	const executables = toolchain.receipt.executables;
	const configure = ['-S', join(root, MOTION_NATIVE_SOURCE_ROOT), '-B', buildRoot, '--fresh',
		'-G', options.target.startsWith('win-') ? 'Ninja Multi-Config' : 'Ninja', '-DCMAKE_BUILD_TYPE=Release',
		`-DCMAKE_TOOLCHAIN_FILE=${join(root, 'native/framescaper-media-host/build/toolchains', `${options.target}.cmake`)}`,
		`-DCMAKE_MAKE_PROGRAM=${executables.ninja.path}`, `-DFRAMESCAPER_C_COMPILER=${executables.c.path}`,
		`-DFRAMESCAPER_CXX_COMPILER=${executables.cxx.path}`, `-DPKG_CONFIG_EXECUTABLE=${executables.pkgConfig.path}`,
		commandPrefix];
	const commands = [configure, ['--build', buildRoot, '--config', 'Release', '--parallel', '1'],
		['--build', buildRoot, '--config', 'Release', '--target', 'test', '--parallel', '1'],
		['--install', buildRoot, '--config', 'Release', '--prefix', installRoot]];
	let testOutput = '';
	for (const [index, args] of commands.entries()) {
		await assertSourceStable(root, sourceBytes);
		const result = run(executables.cmake.path, args, root, configured.environment, `native build step ${index + 1}`);
		if (index === 2) testOutput = result;
	}
	await assertSourceStable(root, sourceBytes);
	const name = `motionscaper-media-host${options.target.startsWith('win-') ? '.exe' : ''}`;
	const binaryPath = join(installRoot, 'bin', name);
	const bytes = await boundedFile(binaryPath, 256 * 1024 * 1024);
	const dependencyInspections: unknown = await validateSoundscaperProfessionalNativeDependencyClosure({
		target: options.target, artifacts: [{ path: name, absolutePath: binaryPath }], runtimeArtifacts: [], root: installRoot,
		inspectDependencies: inspectSoundscaperProfessionalNativeDependencies,
	});
	const selfTestOutput = run(binaryPath, ['--self-test'], root, configured.environment, 'Motionscaper helper self-test');
	const selfTest: unknown = JSON.parse(selfTestOutput);
	if (JSON.stringify(selfTest) !== JSON.stringify(MOTION_NATIVE_SELF_TEST)) throw new Error('Motionscaper helper advertised a foreign or unsupported capability.');
	const revision = run('git', ['rev-parse', '--verify', 'HEAD^{commit}'], root, process.env, 'source revision').trim();
	if (!/^[a-f\d]{40}$/u.test(revision)) throw new Error('Invalid Motionscaper native source revision.');
	const notices = `${await readFile(join(root, MOTION_NATIVE_SOURCE_ROOT, 'THIRD_PARTY_NOTICES.md'), 'utf8')}\n\n${await readFile(join(root, 'native/framescaper-media-host/THIRD_PARTY_NOTICES.md'), 'utf8')}`;
	const receipt = { schemaVersion: 1, productId: 'motionscaper', helperContractVersion: 1, carrierVersion: 1,
		target: options.target, sourceRevision: revision, sourceManifestSha256: sha(sourceBytes),
		dependencySourceSha256: sourceManifest.dependencySource.sha256,
		dependencyRecipeSha256: sha(JSON.stringify(recipe)), toolchainIdentity: toolchain.receipt.identitySha256,
		buildCommandsSha256: sha(JSON.stringify(commands)), payload: { path: name, byteLength: bytes.byteLength, sha256: sha(bytes) },
		notices: { path: 'THIRD_PARTY_NOTICES.md', byteLength: Buffer.byteLength(notices), sha256: sha(notices) },
		precision: MOTION_NATIVE_PRECISION, selfTest, dependencyInspections,
		tests: [{ id: 'motionscaper-native-ctest', status: 'passed', outputSha256: sha(testOutput) },
			{ id: 'motionscaper-native-self-test', status: 'passed', outputSha256: sha(selfTestOutput) }],
	};
	await exclusiveDirectory(output);
	await writeFile(join(output, name), bytes, { flag: 'wx', mode: 0o555 });
	await writeFile(join(output, 'THIRD_PARTY_NOTICES.md'), notices, { flag: 'wx', mode: 0o444 });
	await writeFile(join(output, 'build-result.json'), `${JSON.stringify(receipt, null, '\t')}\n`, { flag: 'wx', mode: 0o444 });
	return receipt;
}
function run(command: string, args: readonly string[], cwd: string, env: NodeJS.ProcessEnv, label: string): string {
	const result = spawnSync(command, [...args], { cwd, env: { ...env }, shell: false, encoding: 'utf8',
		maxBuffer: 1024 * 1024, timeout: 30 * 60 * 1000, windowsHide: true });
	if (result.status !== 0 || result.signal || result.error) throw new Error(`Motionscaper ${label} failed: ${result.stderr || String(result.error ?? result.status)}`);
	return `${result.stdout}${result.stderr}`;
}
function sha(value: string | Uint8Array): string { return createHash('sha256').update(value).digest('hex'); }
async function assertSourceStable(root: string, initialManifest: Buffer): Promise<void> {
	await verifyMotionscaperNativeSourceManifest(root);
	if (!(await readFile(join(root, MOTION_NATIVE_SOURCE_MANIFEST))).equals(initialManifest)) throw new Error('Motionscaper native source pins changed during the build.');
}
async function directory(path: string): Promise<string> {
	if (!isAbsolute(path) || resolve(path) !== path) throw new Error('Motionscaper build requires canonical absolute paths.');
	const stat = await lstat(path);
	if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(path) !== path) throw new Error('Motionscaper build directory is not canonical.');
	return path;
}
async function absentPath(path: string): Promise<string> {
	if (!isAbsolute(path) || resolve(path) !== path) throw new Error('Motionscaper build output path is not canonical.');
	try { await lstat(path); } catch (error) {
		if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return path;
		throw error;
	}
	throw new Error('Motionscaper build output already exists.');
}
async function exclusiveDirectory(path: string): Promise<string> {
	await absentPath(path); await directory(dirname(path)); await mkdir(path, { mode: 0o700 }); return directory(path);
}
async function boundedFile(path: string, maximum: number): Promise<Buffer> {
	const stat = await lstat(path);
	if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > maximum || await realpath(path) !== path) throw new Error('Motionscaper build output is not one bounded regular file.');
	return readFile(path);
}
