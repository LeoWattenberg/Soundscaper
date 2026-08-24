/* SPDX-License-Identifier: AGPL-3.0-only */

import { execFile as nodeExecFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
	createExternalFfmpegCandidate,
	probeExternalFfmpegCandidate,
} from '../../desktop/external-ffmpeg-probe.ts';
import {
	buildDesktopAudioFfmpegPlan,
	deriveDesktopAudioFfmpegCapabilityTuple,
	isDesktopAudioFfmpegCapabilityTupleSatisfied,
} from '../../desktop/desktop-audio-ffmpeg-plan.ts';
import {
	DESKTOP_AUDIO_FFMPEG_WAVE_OVERHEAD_LIMIT_BYTES,
	parseDesktopAudioFfmpegWaveOutput,
} from '../../desktop/desktop-audio-ffmpeg-wave-output.ts';

const execFile = promisify(nodeExecFile);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const EVIDENCE_PATH = join(ROOT, 'config/external-ffmpeg-cli-compatibility-lab.json');
const SHA256 = /^[0-9a-f]{64}$/u;
const IMAGE = /^docker\.io\/mwader\/static-ffmpeg@sha256:[0-9a-f]{64}$/u;
const RELEASES = Object.freeze(['4.4.0', '5.1.0', '6.1.0', '7.1.0', '8.0.0', '9.0.0']);
const SOURCE_TAGS = Object.freeze(['4.4', '5.1', '6.1', '7.1', '8.0', '9.0']);
const FORMATS = Object.freeze([
	Object.freeze({
		id: 'flac', encodeSettings: Object.freeze({ bitDepth: 24, compressionLevel: 5 }),
	}),
	Object.freeze({ id: 'mp3', encodeSettings: Object.freeze({ bitrateKbps: 128 }) }),
	Object.freeze({ id: 'ogg-vorbis', encodeSettings: Object.freeze({ quality: 5 }) }),
	Object.freeze({ id: 'opus', encodeSettings: Object.freeze({ bitrateKbps: 128 }) }),
	Object.freeze({ id: 'wavpack', encodeSettings: Object.freeze({ compressionLevel: 2 }) }),
	Object.freeze({ id: 'mp2', encodeSettings: Object.freeze({ bitrateKbps: 256 }) }),
	Object.freeze({ id: 'aac-m4a', encodeSettings: Object.freeze({ bitrateKbps: 192 }) }),
]);
const EVIDENCE_KEYS = Object.freeze([
	'schemaVersion', 'id', 'observedAt', 'scope', 'implementation', 'architecture',
	'fixture', 'formats', 'observationProfiles', 'releases', 'claim', 'limitations',
]);

export const EXTERNAL_FFMPEG_CLI_COMPATIBILITY_LAB = normalizeExternalFfmpegCliCompatibilityLab(
	JSON.parse(readFileSync(EVIDENCE_PATH, 'utf8')),
);

export function normalizeExternalFfmpegCliCompatibilityLab(value, options = {}) {
	const root = options.repositoryRoot ?? ROOT;
	const evidence = exactRecord(value, EVIDENCE_KEYS, 'external FFmpeg CLI evidence');
	if (evidence.schemaVersion !== 1 || evidence.id !== 'external-ffmpeg-cli-linux-x64-2026-08-24'
		|| evidence.observedAt !== '2026-08-24') fail('External FFmpeg CLI evidence identity is invalid.');
	const scope = exactRecord(evidence.scope, [
		'hostTarget', 'containerPlatform', 'dockerServerVersion', 'runtimeArgumentContract',
		'decodedOutputContract',
	], 'external FFmpeg CLI evidence scope');
	if (scope.hostTarget !== 'linux-x64' || scope.containerPlatform !== 'linux/amd64'
		|| scope.dockerServerVersion !== '29.1.3'
		|| scope.runtimeArgumentContract !== 'closed-plan-before-main-runner-guard-injection'
		|| scope.decodedOutputContract !== 'strict-source-authoritative-float32-wave') {
		fail('External FFmpeg CLI evidence scope is invalid.');
	}
	validateImplementation(evidence.implementation, root);
	validateArchitecture(evidence.architecture);
	validateFixture(evidence.fixture);
	validateFormats(evidence.formats);
	const profiles = validateObservationProfiles(evidence.observationProfiles, evidence.fixture);
	validateReleases(evidence.releases, profiles);
	if (typeof evidence.claim !== 'string' || evidence.claim.length < 80 || evidence.claim.length > 1_024
		|| !Array.isArray(evidence.limitations) || evidence.limitations.length !== 4
		|| evidence.limitations.some((entry) => typeof entry !== 'string'
			|| entry.length < 40 || entry.length > 512)) {
		fail('External FFmpeg CLI evidence claim or limitations are invalid.');
	}
	return deepFreeze(structuredClone(evidence));
}

export async function executeExternalFfmpegCliCompatibilityLab(options = {}) {
	const evidence = normalizeExternalFfmpegCliCompatibilityLab(
		options.evidence ?? EXTERNAL_FFMPEG_CLI_COMPATIBILITY_LAB,
		{ repositoryRoot: options.repositoryRoot ?? ROOT },
	);
	if (process.platform !== 'linux' || process.arch !== 'x64') {
		throw new Error('The external FFmpeg CLI compatibility lab is qualified only on Linux x64.');
	}
	const docker = options.dockerExecutable ?? 'docker';
	const dockerVersion = (await runStrict(docker, [
		'version', '--format', '{{.Server.Version}}',
	], 10_000)).stdout.trim();
	const releases = await Promise.all(evidence.releases.map((row) => executeRelease({
		docker, evidence, row,
	})));
	return deepFreeze({
		schemaVersion: 1,
		evidenceId: evidence.id,
		reproducedAt: new Date().toISOString(),
		hostTarget: 'linux-x64',
		containerPlatform: 'linux/amd64',
		dockerServerVersion: dockerVersion,
		releases,
	});
}

async function executeRelease({ docker, evidence, row }) {
	const inspection = await runStrict(docker, [
		'image', 'inspect', '--format', '{{.Os}}/{{.Architecture}}', row.image,
	], 10_000);
	if (inspection.stdout.trim() !== evidence.scope.containerPlatform) {
		throw new Error(`The ${row.release} witness is not a Linux AMD64 image.`);
	}
	const probe = await probeExternalFfmpegCandidate(createExternalFfmpegCandidate({
		id: `linux-x64-${row.sourceTag.replace('.', '-')}`,
		source: 'user-selected', ffmpegPath: '/ffmpeg', ffprobePath: '/ffprobe',
	}), dockerProbeRunner(docker, evidence.scope.containerPlatform, row.image));
	if (probe.status !== 'available' || probe.version.normalized !== row.release) {
		throw new Error(`The ${row.release} witness failed its exact executable-pair probe.`);
	}
	const directory = await mkdtemp(join(tmpdir(), `soundscaper-ffmpeg-${row.sourceTag}-`));
	try {
		const observations = [];
		for (const format of evidence.formats) {
			observations.push(await executeFormat({
				docker, evidence, row, format, capabilities: probe.capabilities, directory,
			}));
		}
		assertRecordedObservations(row, observations, evidence.observationProfiles);
		return Object.freeze({
			release: row.release, image: row.image, probeResult: 'passed',
			boundedExecutionResult: 'passed', operationCount: observations.length * 2,
			observations: Object.freeze(observations),
		});
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}

async function executeFormat({ docker, evidence, row, format, capabilities, directory }) {
	const fixture = evidence.fixture;
	const pcm = new Uint8Array(
		fixture.frameCount * fixture.channelCount * Float32Array.BYTES_PER_ELEMENT,
	);
	const encode = Object.freeze({
		operation: 'audio-encode', format: format.id, input: pcm,
		sampleRate: fixture.sampleRate, channelCount: fixture.channelCount,
		settings: format.encodeSettings, maximumOutputBytes: fixture.maximumOutputBytes,
	});
	assertCapability(encode, capabilities, row.release);
	const encodePlan = buildDesktopAudioFfmpegPlan(encode);
	await writeFile(join(directory, encodePlan.inputName), pcm, { flag: 'wx', mode: 0o600 });
	await runPlan(docker, evidence.scope.containerPlatform, row.image, directory, encodePlan.arguments);
	const encoded = await readBounded(join(directory, encodePlan.outputName), fixture.maximumOutputBytes);
	await rm(join(directory, encodePlan.inputName));
	await rm(join(directory, encodePlan.outputName));

	const decode = Object.freeze({
		operation: 'audio-decode', format: format.id, input: encoded,
		sampleRate: null, channelCount: null,
		settings: Object.freeze({ sampleFormat: 'f32le' }),
		maximumOutputBytes: fixture.maximumOutputBytes,
	});
	assertCapability(decode, capabilities, row.release);
	const decodePlan = buildDesktopAudioFfmpegPlan(decode);
	await writeFile(join(directory, decodePlan.inputName), encoded, { flag: 'wx', mode: 0o600 });
	await runPlan(docker, evidence.scope.containerPlatform, row.image, directory, decodePlan.arguments);
	const wave = await readBounded(
		join(directory, decodePlan.outputName),
		fixture.maximumOutputBytes + DESKTOP_AUDIO_FFMPEG_WAVE_OVERHEAD_LIMIT_BYTES,
	);
	const parsed = parseDesktopAudioFfmpegWaveOutput(wave, fixture.maximumOutputBytes);
	const decoded = parsed.output;
	const geometry = parsed.decodedGeometry;
	try { assertFiniteSilentPcm(decoded); }
	catch (error) {
		throw new Error(`FFmpeg ${row.release} ${format.id} decode witness failed: ${error.message}`, {
			cause: error,
		});
	}
	await rm(join(directory, decodePlan.inputName));
	await rm(join(directory, decodePlan.outputName));
	return Object.freeze({
		format: format.id, decodedByteLength: decoded.byteLength,
		decodedSampleRate: geometry.sampleRate,
		decodedChannelCount: geometry.channelCount,
		decodedFrameCount: geometry.frameCount,
		decodedSha256: sha256(decoded),
		sampleCountPreserved: geometry.frameCount === fixture.frameCount,
	});
}

export function assertExternalFfmpegCliDecodedSilence(decoded, expected) {
	if (!(decoded instanceof Uint8Array) || !(expected instanceof Uint8Array)
		|| decoded.byteLength !== expected.byteLength) {
		throw new Error('The external FFmpeg witness did not preserve the exact PCM byte length.');
	}
	assertFiniteSilentPcm(decoded);
}

function assertFiniteSilentPcm(decoded) {
	if (!(decoded instanceof Uint8Array) || decoded.byteLength < Float32Array.BYTES_PER_ELEMENT
		|| decoded.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0) {
		throw new Error('The external FFmpeg witness did not return complete silent finite PCM.');
	}
	const view = new DataView(decoded.buffer, decoded.byteOffset, decoded.byteLength);
	for (let offset = 0; offset < decoded.byteLength; offset += Float32Array.BYTES_PER_ELEMENT) {
		const sample = view.getFloat32(offset, true);
		if (!Number.isFinite(sample) || sample !== 0) {
			throw new Error('The external FFmpeg witness did not return silent finite PCM.');
		}
	}
}

function dockerProbeRunner(docker, platform, image) {
	return Object.freeze({
		async run(request) {
			const entrypoint = request.executablePath === '/ffmpeg' ? '/ffmpeg'
				: request.executablePath === '/ffprobe' ? '/ffprobe' : null;
			if (entrypoint === null || request.shell !== false || request.standardInput !== 'ignore') {
				return { status: 'unavailable', reason: 'launch-failed' };
			}
			try {
				const result = await runStrict(docker, hardenedDockerArguments(
					platform, image, entrypoint, request.arguments,
				), request.maximumDurationMs + 10_000, request.maximumOutputBytes);
				return { status: 'exited', exitCode: 0, stdout: result.stdout, stderr: result.stderr };
			} catch (error) {
				if (error?.code === 'ENOENT') return { status: 'unavailable', reason: 'not-found' };
				if (error?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
					return { status: 'unavailable', reason: 'output-limit' };
				}
				if (error?.killed || error?.code === 'ETIMEDOUT') {
					return { status: 'unavailable', reason: 'timeout' };
				}
				if (Number.isSafeInteger(error?.code) && error.code >= 0) return {
					status: 'exited', exitCode: error.code,
					stdout: safeProcessText(error.stdout), stderr: safeProcessText(error.stderr),
				};
				return { status: 'unavailable', reason: 'launch-failed' };
			}
		},
	});
}

async function runPlan(docker, platform, image, directory, arguments_) {
	if (directory.includes(',') || directory.includes('\0')) {
		throw new Error('The external FFmpeg lab scratch path is invalid.');
	}
	await runStrict(docker, [
		...hardenedDockerArguments(platform, image, '/ffmpeg', arguments_).slice(0, -arguments_.length - 1),
		'--user', `${String(process.getuid())}:${String(process.getgid())}`,
		'--mount', `type=bind,source=${directory},target=/work`, '--workdir', '/work',
		image, ...arguments_,
	], 30_000);
}

function hardenedDockerArguments(platform, image, entrypoint, arguments_) {
	return [
		'run', '--rm', '--platform', platform, '--network', 'none', '--read-only',
		'--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--pids-limit', '64',
		'--memory', '512m', '--cpus', '2', '--entrypoint', entrypoint, image, ...arguments_,
	];
}

function assertCapability(request, capabilities, release) {
	if (!isDesktopAudioFfmpegCapabilityTupleSatisfied(
		deriveDesktopAudioFfmpegCapabilityTuple(request), capabilities,
	)) throw new Error(`FFmpeg ${release} lacks the ${request.format} ${request.operation} tuple.`);
}

async function readBounded(path, maximumBytes) {
	const bytes = await readFile(path);
	if (bytes.byteLength < 1 || bytes.byteLength > maximumBytes) {
		throw new Error('The external FFmpeg CLI lab output violated its byte bound.');
	}
	return new Uint8Array(bytes);
}

async function runStrict(executable, arguments_, timeout, maxBuffer = 1024 * 1024) {
	return execFile(executable, arguments_, {
		encoding: 'utf8', timeout, maxBuffer, windowsHide: true,
	});
}

function validateImplementation(value, root) {
	const implementation = exactRecord(value, [
		'operationContractPath', 'operationContractSha256',
		'planPath', 'planSha256', 'probePath', 'probeSha256',
		'waveParserPath', 'waveParserSha256', 'runnerPath', 'runnerSha256',
	], 'external FFmpeg CLI evidence implementation');
	for (const name of ['operationContract', 'plan', 'probe', 'waveParser', 'runner']) {
		const path = implementation[`${name}Path`];
		const expected = implementation[`${name}Sha256`];
		if (typeof path !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._/-]{1,255}$/u.test(path)
			|| path.includes('..') || !SHA256.test(expected)
			|| sha256(readFileSync(join(root, path))) !== expected) {
			fail(`External FFmpeg CLI evidence ${name} digest is stale or invalid.`);
		}
	}
}

function validateArchitecture(value) {
	const architecture = exactRecord(value, [
		'audacityCommit', 'audacityReference', 'audacityApproach', 'soundscaperApproach',
	], 'external FFmpeg CLI evidence architecture');
	if (architecture.audacityCommit !== 'c016d6e1f8f018a39f7c5c1ee56a961fec4055c2'
		|| architecture.audacityReference !== `https://github.com/audacity/audacity/commit/${architecture.audacityCommit}`
		|| !/ABI-major wrappers/iu.test(architecture.audacityApproach)
		|| !/out of process.*released CLI/iu.test(architecture.soundscaperApproach)) {
		fail('External FFmpeg CLI evidence architecture comparison is invalid.');
	}
}

function validateFixture(value) {
	const fixture = exactRecord(value, [
		'sampleFormat', 'sampleRate', 'channelCount', 'frameCount', 'maximumOutputBytes',
	], 'external FFmpeg CLI evidence fixture');
	if (fixture.sampleFormat !== 'f32le' || fixture.sampleRate !== 48_000
		|| fixture.channelCount !== 2 || fixture.frameCount !== 4_800
		|| fixture.maximumOutputBytes !== 1_048_576) {
		fail('External FFmpeg CLI evidence fixture is invalid.');
	}
}

function validateFormats(value) {
	if (!Array.isArray(value) || value.length !== FORMATS.length) {
		fail('External FFmpeg CLI evidence formats are invalid.');
	}
	for (const [index, expected] of FORMATS.entries()) {
		const format = exactRecord(value[index], ['id', 'encodeSettings'], 'external FFmpeg CLI evidence format');
		if (format.id !== expected.id
			|| JSON.stringify(format.encodeSettings) !== JSON.stringify(expected.encodeSettings)) {
			fail('External FFmpeg CLI evidence format settings are invalid.');
		}
	}
}

function validateObservationProfiles(value, fixture) {
	if (!Array.isArray(value) || value.length !== 7) {
		fail('External FFmpeg CLI evidence observation profiles are invalid.');
	}
	const profiles = new Map();
	for (const candidate of value) {
		const profile = exactRecord(candidate, [
			'id', 'decodedByteLength', 'decodedSampleRate', 'decodedChannelCount',
			'decodedFrameCount', 'decodedSha256', 'sampleCountPreserved',
		], 'external FFmpeg CLI evidence observation profile');
		if (!/^[a-z0-9][a-z0-9-]{2,63}$/u.test(profile.id) || profiles.has(profile.id)
			|| !Number.isSafeInteger(profile.decodedByteLength) || profile.decodedByteLength < 1
			|| profile.decodedByteLength > fixture.maximumOutputBytes
			|| profile.decodedSampleRate !== fixture.sampleRate
			|| profile.decodedChannelCount !== fixture.channelCount
			|| !Number.isSafeInteger(profile.decodedFrameCount) || profile.decodedFrameCount < 1
			|| profile.decodedByteLength !== profile.decodedFrameCount
				* profile.decodedChannelCount * Float32Array.BYTES_PER_ELEMENT
			|| !SHA256.test(profile.decodedSha256) || typeof profile.sampleCountPreserved !== 'boolean'
			|| profile.sampleCountPreserved !== (profile.decodedFrameCount === fixture.frameCount)) {
			fail('External FFmpeg CLI evidence observation profile result is invalid.');
		}
		profiles.set(profile.id, profile);
	}
	return profiles;
}

function validateReleases(value, profiles) {
	if (!Array.isArray(value) || value.length !== RELEASES.length) {
		fail('External FFmpeg CLI evidence releases are invalid.');
	}
	for (const [index, release] of RELEASES.entries()) {
		const row = exactRecord(value[index], [
			'release', 'sourceTag', 'image', 'probeResult', 'boundedExecutionResult', 'observations',
		], 'external FFmpeg CLI evidence release');
		if (row.release !== release || row.sourceTag !== SOURCE_TAGS[index] || !IMAGE.test(row.image)
			|| row.probeResult !== 'passed' || row.boundedExecutionResult !== 'passed'
			|| !Array.isArray(row.observations) || row.observations.length !== FORMATS.length) {
			fail('External FFmpeg CLI evidence release result is invalid.');
		}
		for (const [formatIndex, expectedFormat] of FORMATS.entries()) {
			const observation = exactRecord(row.observations[formatIndex], [
				'format', 'profile',
			], 'external FFmpeg CLI evidence release observation');
			if (observation.format !== expectedFormat.id || !profiles.has(observation.profile)) {
				fail('External FFmpeg CLI evidence release observation is invalid.');
			}
		}
	}
}

function assertRecordedObservations(row, actual, profileValues) {
	const profiles = new Map(profileValues.map((profile) => [profile.id, profile]));
	for (const [index, observation] of actual.entries()) {
		const binding = row.observations[index];
		const expected = profiles.get(binding?.profile);
		if (binding?.format !== observation.format || !expected
			|| expected.decodedByteLength !== observation.decodedByteLength
			|| expected.decodedSampleRate !== observation.decodedSampleRate
			|| expected.decodedChannelCount !== observation.decodedChannelCount
			|| expected.decodedFrameCount !== observation.decodedFrameCount
			|| expected.decodedSha256 !== observation.decodedSha256
			|| expected.sampleCountPreserved !== observation.sampleCountPreserved) {
			throw new Error(`FFmpeg ${row.release} ${observation.format} changed its pinned decode observation.`);
		}
	}
}

function exactRecord(value, keys, label) {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
		|| Reflect.ownKeys(value).some((key) => typeof key !== 'string' || !keys.includes(key))
		|| keys.some((key) => !Object.prototype.hasOwnProperty.call(value, key))) {
		fail(`${label} is invalid.`);
	}
	return value;
}

function deepFreeze(value) {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	for (const child of Object.values(value)) deepFreeze(child);
	return Object.freeze(value);
}

function safeProcessText(value) {
	return typeof value === 'string' ? value : Buffer.isBuffer(value) ? value.toString('utf8') : '';
}

function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

function fail(message) {
	throw new TypeError(message);
}
