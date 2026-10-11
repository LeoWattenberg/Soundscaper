/* SPDX-License-Identifier: AGPL-3.0-only */
/** Test-only libav reference decoder; no production process imports this module. */
import { execFile } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { verifyMotionReferenceArtifact } from '../scripts/lib/motionscaper-reference-artifact.ts';
import { MOTION_NATIVE_TARGETS } from '../scripts/lib/motionscaper-native-source.ts';
export interface MotionNativeReference {
	readonly width: number; readonly height: number; readonly profile: number; readonly colorDepth: number; readonly alphaDepth: number;
	readonly colorPrimaries: number; readonly colorTransfer: number; readonly colorSpace: number;
	readonly frames: readonly Readonly<{ num: number; den: number }>[];
	readonly audio: Readonly<{ sampleRate: number; channels: number; sampleCount: number }> | null;
}
const integer = (value: unknown, min: number, max: number): value is number => Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max;
export function inspectMotionNativeReference(value: unknown, rgbaBytes: number, pcmBytes: number): MotionNativeReference {
	if (!value || typeof value !== 'object') throw new Error('Missing native reference metadata.');
	const v = value as Partial<MotionNativeReference>;
	if (!integer(v.width, 1, 256) || !integer(v.height, 1, 256) || v.profile !== 4 || !integer(v.colorDepth, 10, 16) || !integer(v.alphaDepth, 10, 16)
		|| v.colorPrimaries !== 1 || v.colorTransfer !== 1 || v.colorSpace !== 1 || !Array.isArray(v.frames) || v.frames.length < 1 || v.frames.length > 32
		|| v.frames.some((t: unknown) => !t || typeof t !== 'object' || !integer(Reflect.get(t, 'num'), 0, Number.MAX_SAFE_INTEGER) || !integer(Reflect.get(t, 'den'), 1, Number.MAX_SAFE_INTEGER))
		|| rgbaBytes !== v.width * v.height * v.frames.length * 16) throw new Error('Invalid bounded native picture reference.');
	if (v.audio !== null && (!v.audio || !integer(v.audio.sampleRate, 1, 192000) || !integer(v.audio.channels, 1, 2) || !integer(v.audio.sampleCount, 1, 192000))) throw new Error('Invalid bounded native PCM reference.');
	if (pcmBytes !== (v.audio ? v.audio.channels * v.audio.sampleCount * 4 : 0)) throw new Error('Native PCM reference length differs.');
	return v as MotionNativeReference;
}
export async function prepareMotionNativeReferenceDecoder(directory: string): Promise<string> {
	const artifact = process.env.MOTIONSCAPER_REFERENCE_ARTIFACT;
	if (!artifact) return buildMotionNativeReferenceDecoder(directory);
	const nativeResult = process.env.MOTIONSCAPER_REFERENCE_NATIVE_RESULT;
	const target = MOTION_NATIVE_TARGETS.find(value => value === `linux-${process.arch}`);
	if (!nativeResult || !target) throw new Error('A matching native result is required with the reference artifact.');
	return verifyMotionReferenceArtifact({ repositoryRoot: resolve(import.meta.dirname, '..'), nativeResult, artifact, target });
}
export async function buildMotionNativeReferenceDecoder(directory: string, prefix = process.env.MOTIONSCAPER_REFERENCE_FFMPEG_PREFIX): Promise<string> {
	if (!prefix || !/^[A-Za-z0-9_./-]+$/u.test(prefix)) throw new Error('Set MOTIONSCAPER_REFERENCE_FFMPEG_PREFIX to the existing pinned native FFmpeg install directory.');
	const execute = promisify(execFile); const output = join(directory, 'motion-reference-decoder');
	const flags = await execute('pkg-config', ['--cflags', '--libs', '--static', 'libavformat', 'libavcodec', 'libswscale', 'libavutil'], { env: { ...process.env, PKG_CONFIG_LIBDIR: join(prefix, 'lib/pkgconfig') }, timeout: 10000, maxBuffer: 65536 });
	const tokens = flags.stdout.trim().split(/\s+/u); if (tokens.some(token => !/^[A-Za-z0-9_./=+-]+$/u.test(token))) throw new Error('Unexpected native reference compiler flags.');
	await execute('c++', ['-std=c++20', '-O2', '-Wall', '-Wextra', '-Werror', resolve(import.meta.dirname, '../scripts/lib/motionscaper-native-reference.cpp'), '-o', output, ...tokens], { timeout: 60000, maxBuffer: 65536 });
	return output;
}
export async function decodeMotionNativeReference(executable: string, movie: string, directory: string): Promise<Readonly<{ metadata: MotionNativeReference; rgba: Float32Array; pcm: Float32Array }>> {
	const input = await stat(movie); if (!input.isFile() || input.size > 64 * 1024 * 1024) throw new Error('Native reference movie exceeds its admission budget.');
	const rgbaPath = join(directory, 'reference.rgba'), pcmPath = join(directory, 'reference.pcm');
	const result = await promisify(execFile)(executable, [movie, rgbaPath, pcmPath], { timeout: 30000, maxBuffer: 65536 });
	const [rgbaStat, pcmStat] = await Promise.all([stat(rgbaPath), stat(pcmPath)]); const metadata = inspectMotionNativeReference(JSON.parse(result.stdout) as unknown, rgbaStat.size, pcmStat.size);
	const [rgba, pcm] = await Promise.all([readFile(rgbaPath), readFile(pcmPath)]);
	return { metadata, rgba: new Float32Array(rgba.buffer.slice(rgba.byteOffset, rgba.byteOffset + rgba.byteLength)), pcm: new Float32Array(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength)) };
}
