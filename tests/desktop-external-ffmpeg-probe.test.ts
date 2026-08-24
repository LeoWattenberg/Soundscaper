/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createExternalFfmpegCandidate,
	discoverExternalFfmpeg,
	parseExternalFfmpegVersionOutput,
	probeExternalFfmpegCandidate,
	type ExternalFfmpegCandidateInput,
	type ExternalFfmpegProcessRequest,
	type ExternalFfmpegProcessResult,
	type ExternalFfmpegProcessRunner,
} from '../desktop/external-ffmpeg-probe.ts';

const CAPABILITY_OUTPUTS = new Map<string, string>([
	['-hide_banner -encoders', [
		'Encoders:',
		' V..... = Video',
		' A..... = Audio',
		' ------',
		' V....D libaom-av1          libaom AV1',
		' V..... libvpx-vp9          libvpx VP9',
		' A....D libopus             libopus Opus',
		' A....D libopus             duplicate is ignored',
	].join('\n')],
	['-hide_banner -decoders', [
		'Decoders:',
		' V..... = Video',
		' ------',
		' V....D av1                 Alliance for Open Media AV1',
		' A....D mp3float            MP3',
	].join('\n')],
	['-hide_banner -muxers', [
		'Formats:',
		' D.. = Demuxing supported',
		' .E. = Muxing supported',
		' ..d = Is a device',
		' ---',
		'  E  matroska,webm          Matroska / WebM',
		'  E  mp3                    MP3',
	].join('\n')],
	['-hide_banner -demuxers', [
		'Formats:',
		' D.. = Demuxing supported',
		' .E. = Muxing supported',
		' ..d = Is a device',
		' ---',
		' D   matroska,webm          Matroska / WebM',
		' D   wav                    WAV',
	].join('\n')],
	['-hide_banner -filters', [
		'Filters:',
		'  T. = Timeline support',
		'  .S = Slice threading',
		'  .. aresample         A->A       Resample audio',
		'  TS scale             V->V       Scale video',
	].join('\n')],
]);

test('candidate creation returns an immutable absolute no-shell descriptor', () => {
	const candidate = createExternalFfmpegCandidate({
		id: 'homebrew-ffmpeg',
		source: 'package-manager',
		ffmpegPath: '/opt/homebrew/bin/ffmpeg',
		ffprobePath: '/opt/homebrew/bin/ffprobe',
	});
	assert.deepEqual(candidate, {
		id: 'homebrew-ffmpeg',
		source: 'package-manager',
		ffmpegPath: '/opt/homebrew/bin/ffmpeg',
		ffprobePath: '/opt/homebrew/bin/ffprobe',
	});
	assert.equal(Object.isFrozen(candidate), true);
	assert.throws(() => createExternalFfmpegCandidate({
		id: 'relative', source: 'system-path',
		ffmpegPath: 'ffmpeg', ffprobePath: 'ffprobe',
	}), /absolute/u);
	assert.throws(() => createExternalFfmpegCandidate({
		id: 'bad\nid', source: 'user-selected',
		ffmpegPath: '/tools/ffmpeg', ffprobePath: '/tools/ffprobe',
	}), /identifier/u);
});

test('released FFmpeg versions from 4.4 through 9.x are admitted', () => {
	for (const [token, normalized] of [
		['4.4', '4.4.0'],
		['n4.4.8', '4.4.8'],
		['7.1.1-full_build-www.gyan.dev', '7.1.1'],
		['9.0.1', '9.0.1'],
	] as const) {
		const parsed = parseExternalFfmpegVersionOutput(
			`ffmpeg version ${token} Copyright (c) FFmpeg developers\n`, 'ffmpeg',
		);
		assert.equal(parsed.status, 'available');
		if (parsed.status === 'available') assert.equal(parsed.version.normalized, normalized);
	}
	for (const [token, reason] of [
		['4.3.9', 'unsupported-version'],
		['10.0', 'unsupported-version'],
		['N-119000-gabcdef', 'unreleased-build'],
		['9.0-git-abcdef', 'unreleased-build'],
		['master', 'unreleased-build'],
	] as const) {
		assert.deepEqual(
			parseExternalFfmpegVersionOutput(`ffmpeg version ${token}\n`, 'ffmpeg'),
			{ status: 'unavailable', reason },
		);
	}
});

test('a matching released pair produces sorted closed capability sets', async () => {
	const calls: ExternalFfmpegProcessRequest[] = [];
	const runner = fixtureRunner(calls);
	const candidate = createExternalFfmpegCandidate(candidateInput('/good'));
	const result = await probeExternalFfmpegCandidate(candidate, runner);
	assert.equal(result.status, 'available');
	if (result.status !== 'available') return;
	assert.equal(result.version.normalized, '9.0.1');
	assert.deepEqual(result.capabilities, {
		encoders: ['libaom-av1', 'libopus', 'libvpx-vp9'],
		decoders: ['av1', 'mp3float'],
		muxers: ['matroska', 'mp3', 'webm'],
		demuxers: ['matroska', 'wav', 'webm'],
		filters: ['aresample', 'scale'],
	});
	assert.equal(Object.isFrozen(result.capabilities.encoders), true);
	assert.equal(calls.length, 7);
	for (const call of calls) {
		assert.equal(call.shell, false);
		assert.equal(call.standardInput, 'ignore');
		assert.equal(call.maximumOutputBytes, 1024 * 1024);
		assert.ok(call.arguments.length >= 1);
	}
});

test('capability parsing follows the released CLI dialects from FFmpeg 4.4 through 9', async () => {
	for (const version of ['4.4.8', '5.1.7', '6.1.3', '7.1.2', '8.0.1', '9.0.1']) {
		const root = `/released-${version}`;
		const result = await probeExternalFfmpegCandidate(
			createExternalFfmpegCandidate(candidateInput(root)),
			fixtureRunner([], { versionByRoot: new Map([[root, version]]) }),
		);
		assert.equal(result.status, 'available', `FFmpeg ${version}`);
		if (result.status === 'available') {
			assert.deepEqual(result.capabilities.filters, ['aresample', 'scale']);
			assert.deepEqual(result.capabilities.muxers, ['matroska', 'mp3', 'webm']);
		}
	}
});

test('the executable pair must share one build fingerprint, not only a release number', async () => {
	for (const mismatch of [
		{ ffprobeConfiguration: '--enable-gpl --disable-libopus' },
		{ ffprobeLibraryOverrides: new Map([['libavcodec', '63.  2.100 / 63.  2.100']]) },
	] as const) {
		const result = await probeExternalFfmpegCandidate(
			createExternalFfmpegCandidate(candidateInput('/mixed-build')),
			fixtureRunner([], mismatch),
		);
		assert.equal(result.status, 'unavailable');
		if (result.status === 'unavailable') {
			assert.equal(result.reason, 'build-mismatch');
			assert.equal(result.command, 'ffprobe-version');
		}
	}
});

test('the executable pair fails closed when either build fingerprint is incomplete', async () => {
	for (const incompleteProgram of ['ffmpeg', 'ffprobe'] as const) {
		const result = await probeExternalFfmpegCandidate(
			createExternalFfmpegCandidate(candidateInput(`/incomplete-${incompleteProgram}`)),
			fixtureRunner([], { incompleteProgram }),
		);
		assert.equal(result.status, 'unavailable');
		if (result.status === 'unavailable') {
			assert.equal(result.reason, 'malformed-output');
			assert.equal(result.command, `${incompleteProgram}-version`);
		}
	}
});

test('version and command failures return typed unavailable reasons', async () => {
	for (const ffprobeVersion of ['9.0.0', '9.0.1-other-package']) {
		const mismatch = await probeExternalFfmpegCandidate(
			createExternalFfmpegCandidate(candidateInput('/mismatch')),
			fixtureRunner([], { ffprobeVersion }),
		);
		assert.equal(mismatch.status, 'unavailable');
		if (mismatch.status === 'unavailable') {
			assert.equal(mismatch.reason, 'version-mismatch');
			assert.equal(mismatch.command, 'ffprobe-version');
		}
	}

	const timedOut = await probeExternalFfmpegCandidate(
		createExternalFfmpegCandidate(candidateInput('/timeout')),
		fixtureRunner([], { failure: { command: '-hide_banner -muxers', reason: 'timeout' } }),
	);
	assert.equal(timedOut.status, 'unavailable');
	if (timedOut.status === 'unavailable') {
		assert.equal(timedOut.reason, 'timeout');
		assert.equal(timedOut.command, 'muxers');
	}

	const nonzero = await probeExternalFfmpegCandidate(
		createExternalFfmpegCandidate(candidateInput('/nonzero')),
		fixtureRunner([], { nonzeroCommand: '-hide_banner -filters' }),
	);
	assert.equal(nonzero.status, 'unavailable');
	if (nonzero.status === 'unavailable') {
		assert.equal(nonzero.reason, 'command-failed');
		assert.equal(nonzero.command, 'filters');
		assert.equal(nonzero.exitCode, 2);
	}
});

test('capability output must have its heading and contain only sanitized bounded text', async () => {
	for (const output of [
		'not an encoder listing\n V..... libaom-av1 AV1',
		'Encoders:\n V..... libaom-av1 AV1\u0000hidden',
	]) {
		const result = await probeExternalFfmpegCandidate(
			createExternalFfmpegCandidate(candidateInput('/malformed')),
			fixtureRunner([], { replacement: { command: '-hide_banner -encoders', output } }),
		);
		assert.equal(result.status, 'unavailable');
		if (result.status === 'unavailable') {
			assert.equal(result.reason, 'malformed-output');
			assert.equal(result.command, 'encoders');
		}
	}
});

test('discovery preserves locator priority and selects the first compatible candidate', async () => {
	const candidates = [candidateInput('/old'), candidateInput('/good')];
	const result = await discoverExternalFfmpeg({
		locator: { discover: () => Promise.resolve(candidates) },
		runner: fixtureRunner([], { versionByRoot: new Map([['/old', '4.3.9']]) }),
	});
	assert.equal(result.status, 'available');
	assert.equal(result.attempts.length, 2);
	assert.equal(result.attempts[0]?.status, 'unavailable');
	if (result.status === 'available') assert.equal(result.selected.id, 'candidate-good');

	assert.deepEqual(await discoverExternalFfmpeg({
		locator: { discover: () => Promise.resolve([]) }, runner: fixtureRunner([]),
	}), { status: 'unavailable', reason: 'no-candidates', attempts: [] });
	const failed = await discoverExternalFfmpeg({
		locator: { discover: () => Promise.reject(new Error('private filesystem detail')) },
		runner: fixtureRunner([]),
	});
	assert.deepEqual(failed, { status: 'unavailable', reason: 'discovery-failed', attempts: [] });
});

interface RunnerFixtureOptions {
	readonly ffprobeVersion?: string;
	readonly ffprobeConfiguration?: string;
	readonly ffprobeLibraryOverrides?: ReadonlyMap<string, string>;
	readonly incompleteProgram?: 'ffmpeg' | 'ffprobe';
	readonly failure?: Readonly<{
		command: string;
		reason: 'not-found' | 'not-executable' | 'timeout' | 'output-limit' | 'launch-failed';
	}>;
	readonly nonzeroCommand?: string;
	readonly replacement?: Readonly<{ command: string; output: string }>;
	readonly versionByRoot?: ReadonlyMap<string, string>;
}

function fixtureRunner(
	calls: ExternalFfmpegProcessRequest[],
	options: RunnerFixtureOptions = {},
): ExternalFfmpegProcessRunner {
	return {
		run(request) {
			calls.push(request);
			const command = request.arguments.join(' ');
			if (options.failure?.command === command) {
				return Promise.resolve({ status: 'unavailable', reason: options.failure.reason });
			}
			if (options.nonzeroCommand === command) {
				return Promise.resolve({ status: 'exited', exitCode: 2, stdout: '', stderr: 'failed' });
			}
			const root = request.executablePath.slice(0, request.executablePath.lastIndexOf('/'));
			const version = options.versionByRoot?.get(root) ?? '9.0.1';
			let stdout: string | undefined;
			if (command === '-version') {
				const program = request.executablePath.endsWith('ffprobe') ? 'ffprobe' : 'ffmpeg';
				stdout = versionOutput(program, program === 'ffprobe'
					? (options.ffprobeVersion ?? version) : version, options);
			} else if (options.replacement?.command === command) stdout = options.replacement.output;
			else stdout = capabilityOutput(command, version);
			const result: ExternalFfmpegProcessResult = stdout === undefined
				? { status: 'unavailable', reason: 'launch-failed' }
				: { status: 'exited', exitCode: 0, stdout, stderr: '' };
			return Promise.resolve(result);
		},
	};
}

function capabilityOutput(command: string, version: string): string | undefined {
	const output = CAPABILITY_OUTPUTS.get(command);
	if (output === undefined) return undefined;
	const major = Number(/^\d+/u.exec(version)?.[0]);
	if (command === '-hide_banner -muxers' || command === '-hide_banner -demuxers') {
		return major <= 6 ? output.replace('Formats:', 'File formats:') : output;
	}
	if (command === '-hide_banner -filters' && major <= 7) {
		return output
			.replace('  T. =', '  T.. =').replace('  .S =', '  .S. =')
			.replace('  .. aresample', '  ... aresample').replace('  TS scale', '  TSC scale');
	}
	return output;
}

function versionOutput(
	program: 'ffmpeg' | 'ffprobe',
	version: string,
	options: RunnerFixtureOptions,
): string {
	if (options.incompleteProgram === program) return `${program} version ${version} Copyright\n`;
	const configuration = program === 'ffprobe'
		? (options.ffprobeConfiguration ?? '--enable-gpl --enable-libopus')
		: '--enable-gpl --enable-libopus';
	const libraries = [
		['libavutil', '61.  1.100 / 61.  1.100'],
		['libavcodec', '63.  1.100 / 63.  1.100'],
		['libavformat', '63.  1.100 / 63.  1.100'],
		['libavfilter', '12.  1.100 / 12.  1.100'],
		['libswresample', '7.  1.100 /  7.  1.100'],
	] as const;
	return [
		`${program} version ${version} Copyright`,
		'built with gcc 14.2.0',
		`configuration: ${configuration}`,
		...libraries.map(([name, value]) => (
			`${name} ${program === 'ffprobe'
				? (options.ffprobeLibraryOverrides?.get(name) ?? value) : value}`
		)),
	].join('\n');
}

function candidateInput(root: string): ExternalFfmpegCandidateInput {
	return {
		id: `candidate-${root.slice(1)}`,
		source: 'package-manager',
		ffmpegPath: `${root}/ffmpeg`,
		ffprobePath: `${root}/ffprobe`,
	};
}
