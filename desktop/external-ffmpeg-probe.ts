/* SPDX-License-Identifier: AGPL-3.0-only */

/** Closed, shell-free discovery and capability probing for user-supplied FFmpeg. */

import { isAbsolute } from 'node:path';

export const EXTERNAL_FFMPEG_PROBE_TIMEOUT_MS = 5_000;
export const EXTERNAL_FFMPEG_PROBE_OUTPUT_LIMIT_BYTES = 1024 * 1024;

export type ExternalFfmpegCandidateSource =
	| 'user-selected'
	| 'managed-package'
	| 'package-manager'
	| 'system-path';

export interface ExternalFfmpegCandidateInput {
	readonly id: string;
	readonly source: ExternalFfmpegCandidateSource;
	readonly ffmpegPath: string;
	readonly ffprobePath: string;
}

export type ExternalFfmpegExecutableCandidate = Readonly<ExternalFfmpegCandidateInput>;

export type ExternalFfmpegProcessFailureReason =
	| 'not-found'
	| 'not-executable'
	| 'timeout'
	| 'output-limit'
	| 'launch-failed';

export interface ExternalFfmpegProcessRequest {
	readonly executablePath: string;
	readonly arguments: readonly string[];
	readonly shell: false;
	readonly standardInput: 'ignore';
	readonly maximumDurationMs: number;
	readonly maximumOutputBytes: number;
}

export type ExternalFfmpegProcessResult = Readonly<{
	readonly status: 'exited';
	readonly exitCode: number;
	readonly stdout: string;
	readonly stderr: string;
}> | Readonly<{
	readonly status: 'unavailable';
	readonly reason: ExternalFfmpegProcessFailureReason;
}>;

export interface ExternalFfmpegProcessRunner {
	/** Implementations must execute the exact path and argv without a command shell. */
	run(request: ExternalFfmpegProcessRequest): Promise<ExternalFfmpegProcessResult>;
}

export interface ExternalFfmpegCandidateLocator {
	/** Candidate order is policy order; the first compatible pair wins. */
	discover(): Promise<readonly ExternalFfmpegCandidateInput[]>;
}

export interface ExternalFfmpegVersion {
	readonly raw: string;
	readonly normalized: string;
	readonly major: number;
	readonly minor: number;
	readonly patch: number;
}

export type ExternalFfmpegVersionParseResult = Readonly<{
	readonly status: 'available';
	readonly version: ExternalFfmpegVersion;
}> | Readonly<{
	readonly status: 'unavailable';
	readonly reason: 'malformed-output' | 'unreleased-build' | 'unsupported-version';
}>;

export interface ExternalFfmpegCapabilities {
	readonly encoders: readonly string[];
	readonly decoders: readonly string[];
	readonly muxers: readonly string[];
	readonly demuxers: readonly string[];
	readonly filters: readonly string[];
}

export type ExternalFfmpegProbeCommand =
	| 'ffmpeg-version'
	| 'ffprobe-version'
	| 'encoders'
	| 'decoders'
	| 'muxers'
	| 'demuxers'
	| 'filters';

export type ExternalFfmpegProbeFailureReason =
	| ExternalFfmpegProcessFailureReason
	| 'command-failed'
	| 'malformed-output'
	| 'unreleased-build'
	| 'unsupported-version'
	| 'version-mismatch';

export type ExternalFfmpegProbeResult = Readonly<{
	readonly status: 'available';
	readonly candidate: ExternalFfmpegExecutableCandidate;
	readonly version: ExternalFfmpegVersion;
	readonly capabilities: ExternalFfmpegCapabilities;
}> | Readonly<{
	readonly status: 'unavailable';
	readonly candidate: ExternalFfmpegExecutableCandidate;
	readonly reason: ExternalFfmpegProbeFailureReason;
	readonly command: ExternalFfmpegProbeCommand;
	readonly exitCode?: number;
}>;

export type ExternalFfmpegDiscoveryResult = Readonly<{
	readonly status: 'available';
	readonly selected: ExternalFfmpegExecutableCandidate;
	readonly probe: Extract<ExternalFfmpegProbeResult, { status: 'available' }>;
	readonly attempts: readonly ExternalFfmpegProbeResult[];
}> | Readonly<{
	readonly status: 'unavailable';
	readonly reason: 'no-candidates' | 'no-compatible-candidate' | 'discovery-failed';
	readonly attempts: readonly ExternalFfmpegProbeResult[];
}>;

interface SuccessfulCommand {
	readonly status: 'available';
	readonly stdout: string;
}

interface FailedCommand {
	readonly status: 'unavailable';
	readonly reason: ExternalFfmpegProbeFailureReason;
	readonly exitCode?: number;
}

type CommandResult = SuccessfulCommand | FailedCommand;
type CapabilityKind = 'encoders' | 'decoders' | 'muxers' | 'demuxers' | 'filters';

const CANDIDATE_SOURCES = new Set<ExternalFfmpegCandidateSource>([
	'user-selected', 'managed-package', 'package-manager', 'system-path',
]);
const PROCESS_FAILURE_REASONS = new Set<ExternalFfmpegProcessFailureReason>([
	'not-found', 'not-executable', 'timeout', 'output-limit', 'launch-failed',
]);
const CAPABILITY_COMMANDS: readonly Readonly<{
	kind: CapabilityKind;
	arguments: readonly string[];
}>[] = Object.freeze([
	Object.freeze({ kind: 'encoders', arguments: Object.freeze(['-hide_banner', '-encoders']) }),
	Object.freeze({ kind: 'decoders', arguments: Object.freeze(['-hide_banner', '-decoders']) }),
	Object.freeze({ kind: 'muxers', arguments: Object.freeze(['-hide_banner', '-muxers']) }),
	Object.freeze({ kind: 'demuxers', arguments: Object.freeze(['-hide_banner', '-demuxers']) }),
	Object.freeze({ kind: 'filters', arguments: Object.freeze(['-hide_banner', '-filters']) }),
]);

export function createExternalFfmpegCandidate(
	input: ExternalFfmpegCandidateInput,
): ExternalFfmpegExecutableCandidate {
	if (!input || typeof input !== 'object' || Array.isArray(input)
		|| !/^[a-z0-9][a-z0-9._-]{0,127}$/u.test(input.id)) {
		throw new TypeError('The external FFmpeg candidate identifier is invalid.');
	}
	if (!CANDIDATE_SOURCES.has(input.source)) {
		throw new TypeError('The external FFmpeg candidate source is invalid.');
	}
	assertExecutablePath(input.ffmpegPath, 'FFmpeg');
	assertExecutablePath(input.ffprobePath, 'FFprobe');
	if (input.ffmpegPath === input.ffprobePath) {
		throw new TypeError('FFmpeg and FFprobe must be separate executable paths.');
	}
	return Object.freeze({
		id: input.id,
		source: input.source,
		ffmpegPath: input.ffmpegPath,
		ffprobePath: input.ffprobePath,
	});
}

export function parseExternalFfmpegVersionOutput(
	output: string,
	program: 'ffmpeg' | 'ffprobe',
): ExternalFfmpegVersionParseResult {
	const sanitized = sanitizeOutput(output);
	if (sanitized === null) return versionUnavailable('malformed-output');
	const firstLine = sanitized.split('\n', 1)[0] ?? '';
	const prefix = `${program} version `;
	if (!firstLine.startsWith(prefix)) return versionUnavailable('malformed-output');
	const raw = firstLine.slice(prefix.length).split(/\s/u, 1)[0] ?? '';
	if (isUnreleasedVersion(raw)) return versionUnavailable('unreleased-build');
	const match = /^n?(\d{1,2})\.(\d{1,3})(?:\.(\d{1,4}))?(?:[-+~][A-Za-z0-9][A-Za-z0-9._+~-]*)?$/u.exec(raw);
	if (!match) return versionUnavailable('malformed-output');
	const major = Number(match[1]);
	const minor = Number(match[2]);
	const patch = Number(match[3] ?? 0);
	if (major < 4 || (major === 4 && minor < 4) || major >= 10) {
		return versionUnavailable('unsupported-version');
	}
	return Object.freeze({
		status: 'available',
		version: Object.freeze({
			raw, normalized: `${String(major)}.${String(minor)}.${String(patch)}`,
			major, minor, patch,
		}),
	});
}

export async function probeExternalFfmpegCandidate(
	candidate: ExternalFfmpegExecutableCandidate,
	runner: ExternalFfmpegProcessRunner,
): Promise<ExternalFfmpegProbeResult> {
	const validated = createExternalFfmpegCandidate(candidate);
	assertRunner(runner);
	const ffmpegResult = await runProbeCommand(
		validated.ffmpegPath, ['-version'], runner,
	);
	if (ffmpegResult.status === 'unavailable') {
		return probeUnavailable(validated, 'ffmpeg-version', ffmpegResult);
	}
	const ffmpegVersion = parseExternalFfmpegVersionOutput(ffmpegResult.stdout, 'ffmpeg');
	if (ffmpegVersion.status === 'unavailable') {
		return probeUnavailable(validated, 'ffmpeg-version', ffmpegVersion);
	}

	const ffprobeResult = await runProbeCommand(
		validated.ffprobePath, ['-version'], runner,
	);
	if (ffprobeResult.status === 'unavailable') {
		return probeUnavailable(validated, 'ffprobe-version', ffprobeResult);
	}
	const ffprobeVersion = parseExternalFfmpegVersionOutput(ffprobeResult.stdout, 'ffprobe');
	if (ffprobeVersion.status === 'unavailable') {
		return probeUnavailable(validated, 'ffprobe-version', ffprobeVersion);
	}
	if (ffmpegVersion.version.normalized !== ffprobeVersion.version.normalized) {
		return probeUnavailable(validated, 'ffprobe-version', { reason: 'version-mismatch' });
	}

	const capabilities: Partial<Record<CapabilityKind, readonly string[]>> = {};
	for (const command of CAPABILITY_COMMANDS) {
		const result = await runProbeCommand(validated.ffmpegPath, command.arguments, runner);
		if (result.status === 'unavailable') {
			return probeUnavailable(validated, command.kind, result);
		}
		const parsed = parseCapabilityOutput(result.stdout, command.kind);
		if (parsed === null) {
			return probeUnavailable(validated, command.kind, {
				reason: 'malformed-output',
			});
		}
		capabilities[command.kind] = parsed;
	}
	const closedCapabilities: ExternalFfmpegCapabilities = Object.freeze({
		encoders: requiredCapability(capabilities, 'encoders'),
		decoders: requiredCapability(capabilities, 'decoders'),
		muxers: requiredCapability(capabilities, 'muxers'),
		demuxers: requiredCapability(capabilities, 'demuxers'),
		filters: requiredCapability(capabilities, 'filters'),
	});
	return Object.freeze({
		status: 'available', candidate: validated,
		version: ffmpegVersion.version, capabilities: closedCapabilities,
	});
}

export async function discoverExternalFfmpeg(options: Readonly<{
	readonly locator: ExternalFfmpegCandidateLocator;
	readonly runner: ExternalFfmpegProcessRunner;
}>): Promise<ExternalFfmpegDiscoveryResult> {
	if (!options || typeof options !== 'object' || Array.isArray(options)
		|| !options.locator || typeof options.locator.discover !== 'function') {
		throw new TypeError('External FFmpeg discovery options are invalid.');
	}
	assertRunner(options.runner);
	let candidates: readonly ExternalFfmpegExecutableCandidate[];
	try {
		const discovered = await options.locator.discover();
		if (!Array.isArray(discovered)) return discoveryUnavailable('discovery-failed', []);
		const ids = new Set<string>();
		candidates = discovered.map((input) => {
			const candidate = createExternalFfmpegCandidate(input);
			if (ids.has(candidate.id)) throw new TypeError('Duplicate external FFmpeg candidate identifier.');
			ids.add(candidate.id);
			return candidate;
		});
	} catch {
		return discoveryUnavailable('discovery-failed', []);
	}
	if (candidates.length === 0) return discoveryUnavailable('no-candidates', []);
	const attempts: ExternalFfmpegProbeResult[] = [];
	for (const candidate of candidates) {
		const probe = await probeExternalFfmpegCandidate(candidate, options.runner);
		attempts.push(probe);
		if (probe.status === 'available') {
			return Object.freeze({
				status: 'available', selected: probe.candidate, probe,
				attempts: Object.freeze([...attempts]),
			});
		}
	}
	return discoveryUnavailable('no-compatible-candidate', attempts);
}

async function runProbeCommand(
	executablePath: string,
	arguments_: readonly string[],
	runner: ExternalFfmpegProcessRunner,
): Promise<CommandResult> {
	let result: ExternalFfmpegProcessResult;
	try {
		result = await runner.run(Object.freeze({
			executablePath, arguments: Object.freeze([...arguments_]), shell: false,
			standardInput: 'ignore', maximumDurationMs: EXTERNAL_FFMPEG_PROBE_TIMEOUT_MS,
			maximumOutputBytes: EXTERNAL_FFMPEG_PROBE_OUTPUT_LIMIT_BYTES,
		}));
	} catch {
		return { status: 'unavailable', reason: 'launch-failed' };
	}
	if (!result || typeof result !== 'object' || Array.isArray(result)) {
		return { status: 'unavailable', reason: 'launch-failed' };
	}
	if (result.status === 'unavailable') {
		return PROCESS_FAILURE_REASONS.has(result.reason)
			? { status: 'unavailable', reason: result.reason }
			: { status: 'unavailable', reason: 'launch-failed' };
	}
	if (result.status !== 'exited' || !Number.isSafeInteger(result.exitCode) || result.exitCode < 0
		|| typeof result.stdout !== 'string' || typeof result.stderr !== 'string') {
		return { status: 'unavailable', reason: 'launch-failed' };
	}
	if (Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr)
		> EXTERNAL_FFMPEG_PROBE_OUTPUT_LIMIT_BYTES) {
		return { status: 'unavailable', reason: 'output-limit' };
	}
	const stdout = sanitizeOutput(result.stdout);
	if (stdout === null || sanitizeOutput(result.stderr) === null) {
		return { status: 'unavailable', reason: 'malformed-output' };
	}
	if (result.exitCode !== 0) {
		return { status: 'unavailable', reason: 'command-failed', exitCode: result.exitCode };
	}
	return { status: 'available', stdout };
}

function parseCapabilityOutput(output: string, kind: CapabilityKind): readonly string[] | null {
	const sanitized = sanitizeOutput(output);
	if (sanitized === null) return null;
	const lines = sanitized.split('\n');
	const heading = `${kind[0]?.toUpperCase() ?? ''}${kind.slice(1)}:`;
	if (!lines.some((line) => line.trim() === heading)) return null;
	const names = new Set<string>();
	for (const line of lines) {
		const rawNames = capabilityNames(line, kind);
		if (rawNames === null) continue;
		for (const name of rawNames.split(',')) {
			if (/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u.test(name)) names.add(name);
		}
	}
	return Object.freeze([...names].sort(asciiOrder));
}

function capabilityNames(line: string, kind: CapabilityKind): string | null {
	let match: RegExpExecArray | null;
	if (kind === 'encoders' || kind === 'decoders') {
		match = /^\s*[VAS][A-Z.]{5}\s+([A-Za-z0-9][A-Za-z0-9_.-]{0,127})(?:\s|$)/u.exec(line);
	} else if (kind === 'muxers') {
		match = /^\s*\.?E\s+([A-Za-z0-9][A-Za-z0-9_,.-]{0,511})(?:\s|$)/u.exec(line);
	} else if (kind === 'demuxers') {
		match = /^\s*D\.?\s+([A-Za-z0-9][A-Za-z0-9_,.-]{0,511})(?:\s|$)/u.exec(line);
	} else {
		match = /^\s*[TSC.]{3}\s+([A-Za-z0-9][A-Za-z0-9_.-]{0,127})(?:\s|$)/u.exec(line);
	}
	return match?.[1] ?? null;
}

function sanitizeOutput(value: unknown): string | null {
	if (typeof value !== 'string' || Buffer.byteLength(value) > EXTERNAL_FFMPEG_PROBE_OUTPUT_LIMIT_BYTES) {
		return null;
	}
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		if ((code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127) return null;
	}
	const normalized = value.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
	const lines = normalized.split('\n');
	if (lines.length > 20_000 || lines.some((line) => line.length > 4_096)) return null;
	return normalized;
}

function isUnreleasedVersion(raw: string): boolean {
	return /^N-/u.test(raw)
		|| /^(?:master|snapshot)$/iu.test(raw)
		|| /(?:^|[-_.+~])(?:git|snapshot|master)(?:[-_.+~]|$)/iu.test(raw);
}

function assertExecutablePath(value: unknown, program: string): asserts value is string {
	if (typeof value !== 'string' || value.length < 2 || value.length > 4_096 || !isAbsolute(value)
		|| hasControlCharacter(value)) {
		throw new TypeError(`${program} must have an absolute executable path.`);
	}
}

function hasControlCharacter(value: string): boolean {
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		if (code < 32 || code === 127) return true;
	}
	return false;
}

function assertRunner(value: unknown): asserts value is ExternalFfmpegProcessRunner {
	if (!value || typeof value !== 'object' || typeof (value as ExternalFfmpegProcessRunner).run !== 'function') {
		throw new TypeError('The external FFmpeg process runner is invalid.');
	}
}

function probeUnavailable(
	candidate: ExternalFfmpegExecutableCandidate,
	command: ExternalFfmpegProbeCommand,
	failure: Readonly<{ reason: ExternalFfmpegProbeFailureReason; exitCode?: number }>,
): Extract<ExternalFfmpegProbeResult, { status: 'unavailable' }> {
	return Object.freeze({
		status: 'unavailable', candidate, reason: failure.reason, command,
		...(failure.exitCode === undefined ? {} : { exitCode: failure.exitCode }),
	});
}

function versionUnavailable(
	reason: 'malformed-output' | 'unreleased-build' | 'unsupported-version',
): Extract<ExternalFfmpegVersionParseResult, { status: 'unavailable' }> {
	return Object.freeze({ status: 'unavailable', reason });
}

function discoveryUnavailable(
	reason: 'no-candidates' | 'no-compatible-candidate' | 'discovery-failed',
	attempts: readonly ExternalFfmpegProbeResult[],
): Extract<ExternalFfmpegDiscoveryResult, { status: 'unavailable' }> {
	return Object.freeze({ status: 'unavailable', reason, attempts: Object.freeze([...attempts]) });
}

function requiredCapability(
	capabilities: Partial<Record<CapabilityKind, readonly string[]>>,
	kind: CapabilityKind,
): readonly string[] {
	const value = capabilities[kind];
	if (!value) throw new Error(`The ${kind} probe result was not populated.`);
	return value;
}

function asciiOrder(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}
