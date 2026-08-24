/* SPDX-License-Identifier: AGPL-3.0-only */

/** Main-owned preference state for optional, externally installed FFmpeg. */

import type {
	ExternalFfmpegInstallOutcome,
	ExternalFfmpegInstallPlan,
	ExternalFfmpegInstallPlanResult,
} from './external-ffmpeg-installer.ts';
import type { ExternalFfmpegCapabilities } from './external-ffmpeg-probe.ts';
import type { ExternalFfmpegProbeEvidence } from './external-ffmpeg-node-runtime.ts';

export type ExternalFfmpegPreferenceState =
	| 'unconfigured' | 'probing' | 'ready' | 'unsupported'
	| 'quarantined' | 'unavailable' | 'installing' | 'error';

export interface ExternalFfmpegPreferenceStatus {
	readonly state: ExternalFfmpegPreferenceState;
	readonly location: string | null;
	readonly version: string | null;
	readonly detail: string;
	readonly canInstall: boolean;
	readonly canBrowse: boolean;
	readonly canClear: boolean;
}

export interface ExternalFfmpegRuntimeAdmission {
	readonly executablePath: string;
	readonly version: string;
	readonly capabilityGeneration: string;
	readonly identity: ExternalFfmpegProbeEvidence['identity'];
	readonly capabilities: ExternalFfmpegCapabilities;
}

export type ExternalFfmpegRuntimeInvalidationReason =
	| 'identity-changed'
	| 'executable-unavailable';

export type ExternalFfmpegPreferenceProbeResult =
	| Readonly<{
		readonly status: 'available';
		readonly evidence: ExternalFfmpegProbeEvidence;
		readonly capabilities: ExternalFfmpegCapabilities;
	}>
	| Readonly<{
		readonly status: 'unavailable';
		readonly state: 'unsupported' | 'unavailable' | 'error';
		readonly location: string | null;
		readonly detail: string;
	}>;

export interface ExternalFfmpegPreferenceSelection {
	readonly executablePath: string;
	readonly identity: ExternalFfmpegProbeEvidence['identity'] | null;
	readonly capabilities: ExternalFfmpegProbeEvidence['capabilities'] | null;
}

export interface ExternalFfmpegPreferenceSettings {
	snapshot(): Readonly<{ readonly externalFfmpegSelection: ExternalFfmpegPreferenceSelection | null }>;
	setExternalFfmpegSelection(path: string): Promise<ExternalFfmpegPreferenceSelection>;
	setExternalFfmpegProbeMetadata(evidence: ExternalFfmpegProbeEvidence): Promise<ExternalFfmpegPreferenceSelection>;
	clearExternalFfmpegProbeMetadata(path: string): Promise<ExternalFfmpegPreferenceSelection>;
	clearExternalFfmpegSelection(): Promise<null>;
}

export interface ExternalFfmpegPreferenceServiceOptions {
	readonly settings: ExternalFfmpegPreferenceSettings;
	readonly choose: () => Promise<string | null>;
	readonly probe: (selectedPath: string | null) => Promise<ExternalFfmpegPreferenceProbeResult>;
	readonly plan: () => ExternalFfmpegInstallPlanResult;
	readonly confirm: (plan: ExternalFfmpegInstallPlan) => Promise<boolean>;
	readonly install: (plan: ExternalFfmpegInstallPlan) => Promise<ExternalFfmpegInstallOutcome>;
}

export interface ExternalFfmpegPreferenceService {
	status(): Promise<ExternalFfmpegPreferenceStatus>;
	choose(): Promise<ExternalFfmpegPreferenceStatus>;
	clear(): Promise<ExternalFfmpegPreferenceStatus>;
	rescan(): Promise<ExternalFfmpegPreferenceStatus>;
	install(): Promise<ExternalFfmpegPreferenceStatus>;
	/** Main-process capability. It is deliberately absent from the renderer bridge. */
	admission(): ExternalFfmpegRuntimeAdmission | null;
	/** Quarantines only the exact admission whose runtime identity check failed. */
	invalidateAdmission(
		expected: ExternalFfmpegRuntimeAdmission,
		reason: ExternalFfmpegRuntimeInvalidationReason,
	): Promise<ExternalFfmpegPreferenceStatus>;
}

const STATUS_DETAIL_LIMIT = 2_048;
const CAPABILITY_TOKEN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;

export function createExternalFfmpegPreferenceService(
	options: ExternalFfmpegPreferenceServiceOptions,
): ExternalFfmpegPreferenceService {
	validateOptions(options);
	let admission: ExternalFfmpegRuntimeAdmission | null = null;
	let busy: 'probing' | 'installing' | null = null;
	let mutationEpoch = 0;
	const initialSelection = options.settings.snapshot().externalFfmpegSelection;
	let current = initialSelection === null
		? baseStatus('unconfigured', null, null, '')
		: baseStatus(
			'quarantined', initialSelection.executablePath, null,
			'The saved FFmpeg installation must be rescanned before use.',
		);

	const exposedStatus = (): ExternalFfmpegPreferenceStatus => Object.freeze({
		...current,
		state: busy ?? current.state,
		canInstall: busy === null && options.plan().status === 'planned',
		canBrowse: busy === null,
		canClear: busy === null && current.location !== null,
	});

	const fail = (state: 'error' | 'unavailable', detail: string): ExternalFfmpegPreferenceStatus => {
		admission = null;
		current = baseStatus(state, current.location, null, safeDetail(detail));
		return exposedStatus();
	};

	const probe = async (selectedPath: string | null): Promise<ExternalFfmpegPreferenceStatus> => {
		const probeEpoch = mutationEpoch;
		let result: ExternalFfmpegPreferenceProbeResult;
		try { result = await options.probe(selectedPath); }
		catch {
			return probeEpoch !== mutationEpoch
				? exposedStatus()
				: fail('error', 'The FFmpeg compatibility probe failed.');
		}
		if (probeEpoch !== mutationEpoch) return exposedStatus();
		if (result.status === 'unavailable') {
			admission = null;
			const selected = options.settings.snapshot().externalFfmpegSelection;
			const location = selected?.executablePath ?? nullablePath(result.location);
			if (selected !== null) {
				try { await options.settings.clearExternalFfmpegProbeMetadata(selected.executablePath); }
				catch {
					return probeEpoch !== mutationEpoch
						? exposedStatus()
						: fail('error', 'FFmpeg probe evidence could not be cleared.');
				}
				if (probeEpoch !== mutationEpoch) return exposedStatus();
			}
			current = baseStatus(result.state, location, null, safeDetail(result.detail));
			return exposedStatus();
		}
		let nextAdmission: ExternalFfmpegRuntimeAdmission;
		try { nextAdmission = runtimeAdmission(result); }
		catch { return fail('error', 'FFmpeg returned invalid capability evidence.'); }
		try {
			const selected = options.settings.snapshot().externalFfmpegSelection;
			if (selected?.executablePath !== result.evidence.executablePath) {
				await options.settings.setExternalFfmpegSelection(result.evidence.executablePath);
				if (probeEpoch !== mutationEpoch) return exposedStatus();
			}
			await options.settings.setExternalFfmpegProbeMetadata(result.evidence);
			if (probeEpoch !== mutationEpoch) return exposedStatus();
		} catch {
			return probeEpoch !== mutationEpoch
				? exposedStatus()
				: fail('error', 'FFmpeg probe evidence could not be saved.');
		}
		admission = nextAdmission;
		current = baseStatus(
			'ready', nextAdmission.executablePath, nextAdmission.version,
			`FFmpeg ${nextAdmission.version} passed the compatibility probe.`,
		);
		return exposedStatus();
	};

	const exclusive = async (
		kind: 'probing' | 'installing',
		operation: () => Promise<ExternalFfmpegPreferenceStatus>,
	): Promise<ExternalFfmpegPreferenceStatus> => {
		if (busy !== null) return exposedStatus();
		busy = kind;
		try { await operation(); }
		catch { fail('error', 'The external FFmpeg preference operation failed.'); }
		finally { busy = null; }
		return exposedStatus();
	};

	return Object.freeze({
		status: () => Promise.resolve(exposedStatus()),
		choose: () => exclusive('probing', async () => {
			const selectedPath = await options.choose();
			if (selectedPath === null) return exposedStatus();
			mutationEpoch += 1;
			admission = null;
			await options.settings.setExternalFfmpegSelection(selectedPath);
			current = baseStatus('quarantined', selectedPath, null, 'The selected FFmpeg installation has not been probed.');
			return probe(selectedPath);
		}),
		clear: () => exclusive('probing', async () => {
			mutationEpoch += 1;
			admission = null;
			await options.settings.clearExternalFfmpegSelection();
			current = baseStatus('unconfigured', null, null, '');
			return exposedStatus();
		}),
		rescan: () => exclusive('probing', () => (
			probe(options.settings.snapshot().externalFfmpegSelection?.executablePath ?? null)
		)),
		install: () => exclusive('installing', async () => {
			const previous = current;
			const planResult = options.plan();
			if (planResult.status !== 'planned') {
				current = baseStatus('unavailable', current.location, current.version, safeDetail(planResult.detail));
				return exposedStatus();
			}
			if (!await options.confirm(planResult.plan)) {
				current = previous;
				return exposedStatus();
			}
			const outcome = await options.install(planResult.plan);
			if (outcome.status === 'installed') return probe(null);
			if (outcome.status === 'cancelled') {
				current = previous;
				return exposedStatus();
			}
			if (outcome.status === 'refused') {
				return fail('error', `The FFmpeg installation was refused (${outcome.reason}).`);
			}
			return fail('error', `The package manager could not install FFmpeg (${outcome.reason}).`);
		}),
		admission: () => admission,
		async invalidateAdmission(
			expected: ExternalFfmpegRuntimeAdmission,
			reason: ExternalFfmpegRuntimeInvalidationReason,
		): Promise<ExternalFfmpegPreferenceStatus> {
			if (reason !== 'identity-changed' && reason !== 'executable-unavailable') {
				throw new TypeError('The FFmpeg runtime invalidation reason is unsupported.');
			}
			if (!sameAdmission(admission, expected)) return exposedStatus();
			mutationEpoch += 1;
			admission = null;
			const unavailable = reason === 'executable-unavailable';
			current = baseStatus(
				unavailable ? 'unavailable' : 'quarantined', expected.executablePath, null,
				unavailable
					? 'The admitted FFmpeg executable is no longer available and must be rescanned.'
					: 'The admitted FFmpeg executable changed and must be rescanned.',
			);
			const selected = options.settings.snapshot().externalFfmpegSelection;
			if (selected?.executablePath === expected.executablePath) {
				try { await options.settings.clearExternalFfmpegProbeMetadata(expected.executablePath); }
				catch {
					current = baseStatus(
						'error', expected.executablePath, null,
						'FFmpeg probe evidence could not be cleared after runtime invalidation.',
					);
				}
			}
			return exposedStatus();
		},
	});
}

function sameAdmission(
	left: ExternalFfmpegRuntimeAdmission | null,
	right: ExternalFfmpegRuntimeAdmission,
): boolean {
	return left !== null && right !== null && typeof right === 'object'
		&& left.executablePath === right.executablePath
		&& left.version === right.version
		&& left.capabilityGeneration === right.capabilityGeneration
		&& left.identity.ffmpegSha256 === right.identity?.ffmpegSha256
		&& left.identity.ffprobeSha256 === right.identity?.ffprobeSha256
		&& left.identity.dependencyClosureSha256 === right.identity?.dependencyClosureSha256;
}

function runtimeAdmission(
	result: Extract<ExternalFfmpegPreferenceProbeResult, { status: 'available' }>,
): ExternalFfmpegRuntimeAdmission {
	const evidence = result.evidence;
	if (!evidence || typeof evidence !== 'object' || typeof evidence.executablePath !== 'string'
		|| typeof evidence.identity?.version !== 'string'
		|| typeof evidence.capabilities?.digest !== 'string') {
		throw new TypeError('External FFmpeg evidence is invalid.');
	}
	const capabilities = capabilitySets(result.capabilities);
	const identity = runtimeIdentity(evidence.identity);
	return Object.freeze({
		executablePath: evidence.executablePath,
		version: identity.version,
		capabilityGeneration: evidence.capabilities.digest,
		identity,
		capabilities,
	});
}

function runtimeIdentity(
	value: ExternalFfmpegProbeEvidence['identity'],
): ExternalFfmpegProbeEvidence['identity'] {
	if (!value || typeof value !== 'object' || typeof value.version !== 'string'
		|| value.version.length < 1 || value.version.length > 256
		|| !SHA256.test(value.ffmpegSha256) || !SHA256.test(value.ffprobeSha256)
		|| !SHA256.test(value.dependencyClosureSha256)) {
		throw new TypeError('External FFmpeg identity is invalid.');
	}
	return Object.freeze({
		version: value.version, ffmpegSha256: value.ffmpegSha256,
		ffprobeSha256: value.ffprobeSha256,
		dependencyClosureSha256: value.dependencyClosureSha256,
	});
}

function capabilitySets(value: ExternalFfmpegCapabilities): ExternalFfmpegCapabilities {
	if (!value || typeof value !== 'object') throw new TypeError('External FFmpeg capabilities are invalid.');
	const result = {} as Record<keyof ExternalFfmpegCapabilities, readonly string[]>;
	for (const kind of ['encoders', 'decoders', 'muxers', 'demuxers', 'filters'] as const) {
		const entries = value[kind];
		if (!Array.isArray(entries) || entries.length > 16_384
			|| entries.some((entry) => !CAPABILITY_TOKEN.test(entry))) {
			throw new TypeError(`External FFmpeg ${kind} are invalid.`);
		}
		result[kind] = Object.freeze([...new Set(entries)].sort(asciiOrder));
	}
	return Object.freeze(result);
}

function baseStatus(
	state: ExternalFfmpegPreferenceState,
	location: string | null,
	version: string | null,
	detail: string,
): ExternalFfmpegPreferenceStatus {
	return Object.freeze({
		state, location: nullablePath(location), version: nullableText(version, 256),
		detail: safeDetail(detail), canInstall: false, canBrowse: false, canClear: false,
	});
}

function nullablePath(value: unknown): string | null {
	return nullableText(value, 4_096);
}

function nullableText(value: unknown, maximum: number): string | null {
	return typeof value === 'string' && value.length > 0 && !value.includes('\0')
		? value.slice(0, maximum)
		: null;
}

function safeDetail(value: unknown): string {
	return typeof value === 'string' && !value.includes('\0') ? value.slice(0, STATUS_DETAIL_LIMIT) : '';
}

function validateOptions(value: ExternalFfmpegPreferenceServiceOptions): void {
	if (!value || typeof value !== 'object' || !value.settings
		|| typeof value.settings.snapshot !== 'function'
		|| typeof value.settings.setExternalFfmpegSelection !== 'function'
		|| typeof value.settings.setExternalFfmpegProbeMetadata !== 'function'
		|| typeof value.settings.clearExternalFfmpegProbeMetadata !== 'function'
		|| typeof value.settings.clearExternalFfmpegSelection !== 'function'
		|| typeof value.choose !== 'function' || typeof value.probe !== 'function'
		|| typeof value.plan !== 'function' || typeof value.confirm !== 'function'
		|| typeof value.install !== 'function') {
		throw new TypeError('External FFmpeg preference service ports are invalid.');
	}
}

function asciiOrder(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}
