/* SPDX-License-Identifier: AGPL-3.0-only */

/** Concrete main-process discovery/probe composition for FFmpeg preferences. */

import {
	discoverExternalFfmpeg,
	type ExternalFfmpegExecutableCandidate,
	type ExternalFfmpegProcessRunner,
} from './external-ffmpeg-probe.ts';
import {
	createExternalFfmpegCandidateLocator,
	createExternalFfmpegNodeRunner,
	createExternalFfmpegProbeEvidence,
	resolveExternalFfmpegTarget,
} from './external-ffmpeg-node-runtime.ts';
import type { ExternalFfmpegPreferenceProbeResult } from './external-ffmpeg-preference-service.ts';

export interface ExternalFfmpegPreferenceNodeProbeOptions {
	readonly platform: NodeJS.Platform;
	readonly architecture: string;
	readonly workingDirectory: string;
	readonly environment?: Readonly<Record<string, string | undefined>>;
	readonly managedPath?: string | null;
	readonly runner?: ExternalFfmpegProcessRunner;
	readonly isExecutable?: (path: string) => Promise<boolean>;
	readonly identityPaths?: (
		candidate: ExternalFfmpegExecutableCandidate,
	) => Promise<readonly string[]>;
	readonly digestFile?: (path: string) => Promise<string>;
	readonly now?: () => number;
}

export type ExternalFfmpegPreferenceNodeProbe = (
	selectedPath: string | null,
) => Promise<ExternalFfmpegPreferenceProbeResult>;

const INCOMPATIBLE_REASONS = new Set([
	'unsupported-version', 'unreleased-build', 'version-mismatch', 'build-mismatch',
]);

export function createExternalFfmpegPreferenceNodeProbe(
	options: ExternalFfmpegPreferenceNodeProbeOptions,
): ExternalFfmpegPreferenceNodeProbe {
	resolveExternalFfmpegTarget(options?.platform, options?.architecture);
	const runner = options.runner ?? createExternalFfmpegNodeRunner({
		workingDirectory: options.workingDirectory,
		environment: options.environment,
	});
	const identityPaths = options.identityPaths ?? ((candidate) => Promise.resolve([
		candidate.ffmpegPath, candidate.ffprobePath,
	]));
	return async (selectedPath): Promise<ExternalFfmpegPreferenceProbeResult> => {
		const locator = createExternalFfmpegCandidateLocator({
			platform: options.platform,
			arch: options.architecture,
			selectedPath,
			managedPath: options.managedPath,
			environment: options.environment,
			isExecutable: options.isExecutable,
		});
		const discovery = await discoverExternalFfmpeg({ locator, runner });
		if (discovery.status === 'unavailable') {
			const incompatible = discovery.attempts.some((attempt) => (
				attempt.status === 'unavailable' && INCOMPATIBLE_REASONS.has(attempt.reason)
			));
			return Object.freeze({
				status: 'unavailable',
				state: discovery.reason === 'discovery-failed' ? 'error'
					: incompatible ? 'unsupported' : 'unavailable',
				location: selectedPath,
				detail: discovery.reason === 'discovery-failed'
					? 'External FFmpeg discovery failed.'
					: incompatible
						? 'The selected FFmpeg release is unsupported or incompatible.'
						: 'No compatible external FFmpeg installation was found.',
			});
		}
		try {
			const identityFiles = await identityPaths(discovery.selected);
			const evidence = await createExternalFfmpegProbeEvidence({
				probe: discovery.probe,
				identityPaths: identityFiles,
				digestFile: options.digestFile,
				now: options.now,
			});
			return Object.freeze({
				status: 'available', evidence,
				capabilities: discovery.probe.capabilities,
			});
		} catch {
			return Object.freeze({
				status: 'unavailable', state: 'error', location: discovery.selected.ffmpegPath,
				detail: 'External FFmpeg identity evidence could not be established.',
			});
		}
	};
}
