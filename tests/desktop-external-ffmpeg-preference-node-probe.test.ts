/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createExternalFfmpegPreferenceNodeProbe } from '../desktop/external-ffmpeg-preference-node-probe.ts';
import type {
	ExternalFfmpegProcessRequest,
	ExternalFfmpegProcessRunner,
} from '../desktop/external-ffmpeg-probe.ts';

const FFMPEG = '/tools/ffmpeg';
const FFPROBE = '/tools/ffprobe';
const CAPABILITIES = new Map([
	['-hide_banner -encoders', 'Encoders:\n V..... libsvtav1 AV1\n A..... libopus Opus'],
	['-hide_banner -decoders', 'Decoders:\n V..... libdav1d AV1\n A..... mp3float MP3'],
	['-hide_banner -muxers', 'Formats:\n  E  webm WebM\n  E  opus Opus'],
	['-hide_banner -demuxers', 'Formats:\n D   webm WebM\n D   ogg Ogg'],
	['-hide_banner -filters', 'Filters:\n .. aresample A->A'],
]);

test('the preference probe admits a matching released pair and binds its evidence', async () => {
	const calls: ExternalFfmpegProcessRequest[] = [];
	const probe = createExternalFfmpegPreferenceNodeProbe({
		platform: 'linux', architecture: 'x64', workingDirectory: '/scratch', environment: {},
		isExecutable: (path) => Promise.resolve(path === FFMPEG || path === FFPROBE),
		runner: runner(calls),
		digestFile: (path) => Promise.resolve(path === FFMPEG ? '1'.repeat(64) : '2'.repeat(64)),
		now: () => 1_787_605_200_000,
	});
	const result = await probe(FFMPEG);
	assert.equal(result.status, 'available');
	if (result.status !== 'available') return;
	assert.equal(result.evidence.executablePath, FFMPEG);
	assert.equal(result.evidence.identity.version, '8.1.2');
	assert.equal(result.evidence.identity.ffmpegSha256, '1'.repeat(64));
	assert.equal(result.evidence.identity.ffprobePath, FFPROBE);
	assert.equal(result.evidence.identity.ffprobeSha256, '2'.repeat(64));
	assert.match(result.evidence.identity.executablePairClosureSha256, /^[0-9a-f]{64}$/u);
	assert.deepEqual(result.capabilities, {
		encoders: ['libopus', 'libsvtav1'], decoders: ['libdav1d', 'mp3float'],
		muxers: ['opus', 'webm'], demuxers: ['ogg', 'webm'], filters: ['aresample'],
	});
	assert.equal(calls.length, 7);
	assert.ok(calls.every((call) => call.shell === false && call.standardInput === 'ignore'));
});

test('unsupported releases and missing executables return sanitized preference states', async () => {
	const unsupported = createExternalFfmpegPreferenceNodeProbe({
		platform: 'darwin', architecture: 'arm64', workingDirectory: '/scratch', environment: {},
		isExecutable: (path) => Promise.resolve(path === FFMPEG || path === FFPROBE),
		runner: runner([], '4.3.9'),
	});
	assert.deepEqual(await unsupported(FFMPEG), {
		status: 'unavailable', state: 'unsupported', location: FFMPEG,
		detail: 'The selected FFmpeg release is unsupported or incompatible.',
	});

	const missing = createExternalFfmpegPreferenceNodeProbe({
		platform: 'win32', architecture: 'arm64', workingDirectory: 'C:\\scratch', environment: {},
		isExecutable: () => Promise.resolve(false), runner: runner([]),
	});
	assert.deepEqual(await missing('C:\\tools\\ffmpeg.exe'), {
		status: 'unavailable', state: 'unavailable', location: 'C:\\tools\\ffmpeg.exe',
		detail: 'No compatible external FFmpeg installation was found.',
	});
});

test('discovery uses managed and package-manager locations only after manual selection', async () => {
	const executable = new Set(['/manual/ffmpeg', '/manual/ffprobe', '/managed/ffmpeg', '/managed/ffprobe']);
	const versions = new Map([['/manual/ffmpeg', '4.3.9'], ['/manual/ffprobe', '4.3.9']]);
	const probe = createExternalFfmpegPreferenceNodeProbe({
		platform: 'linux', architecture: 'arm64', workingDirectory: '/scratch', environment: {},
		managedPath: '/managed/ffmpeg', isExecutable: (path) => Promise.resolve(executable.has(path)),
		runner: runner([], '8.1.2', versions),
		digestFile: () => Promise.resolve('5'.repeat(64)),
	});
	const result = await probe('/manual/ffmpeg');
	assert.equal(result.status, 'available');
	if (result.status === 'available') assert.equal(result.evidence.executablePath, '/managed/ffmpeg');
});

test('macOS x64 is rejected before discovery or process execution', () => {
	assert.throws(() => createExternalFfmpegPreferenceNodeProbe({
		platform: 'darwin', architecture: 'x64', workingDirectory: '/scratch', environment: {},
	}), /unsupported.*darwin-x64/iu);
});

function runner(
	calls: ExternalFfmpegProcessRequest[],
	defaultVersion = '8.1.2',
	versions: ReadonlyMap<string, string> = new Map(),
): ExternalFfmpegProcessRunner {
	return {
		run(request) {
			calls.push(request);
			const command = request.arguments.join(' ');
			if (command === '-version') {
				const program = request.executablePath.endsWith('ffprobe') ? 'ffprobe' : 'ffmpeg';
				const version = versions.get(request.executablePath) ?? defaultVersion;
				return Promise.resolve({
					status: 'exited', exitCode: 0, stdout: versionOutput(program, version), stderr: '',
				});
			}
			const stdout = CAPABILITIES.get(command);
			return Promise.resolve(stdout === undefined
				? { status: 'unavailable', reason: 'launch-failed' }
				: { status: 'exited', exitCode: 0, stdout, stderr: '' });
		},
	};
}

function versionOutput(program: 'ffmpeg' | 'ffprobe', version: string): string {
	return [
		`${program} version ${version}`,
		'built with clang 18.1.8',
		'configuration: --enable-gpl --enable-libopus',
		'libavutil 60.  8.100 / 60.  8.100',
		'libavcodec 62. 11.100 / 62. 11.100',
		'libavformat 62.  3.100 / 62.  3.100',
		'libavfilter 11.  4.100 / 11.  4.100',
		'libswresample 6.  1.100 /  6.  1.100',
	].join('\n');
}
