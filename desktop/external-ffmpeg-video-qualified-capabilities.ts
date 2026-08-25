/* SPDX-License-Identifier: AGPL-3.0-only */

/** Cache execution qualification against one exact external-FFmpeg admission. */

import { join } from 'node:path';

import {
	createDesktopExternalFfmpegVideoCapabilities,
	type DesktopExternalFfmpegVideoCapabilities,
	type DesktopVideoCodecFormat,
} from './desktop-video-codec-operation-contract.js';
import type {
	ExternalFfmpegPreferenceService,
	ExternalFfmpegRuntimeAdmission,
} from './external-ffmpeg-preference-service.js';
import {
	ExternalFfmpegVideoQualificationIdentityError,
	qualifyExternalFfmpegVideoAdmission,
} from './external-ffmpeg-video-qualification.js';
import type { ExternalFfmpegVideoSpawn } from './external-ffmpeg-video-process.js';

export type DesktopVideoCodecProductId = 'soundscaper' | 'framescaper';
export type ExternalFfmpegVideoQualifier = (
	admission: ExternalFfmpegRuntimeAdmission,
) => Promise<DesktopExternalFfmpegVideoCapabilities>;

export interface ExternalFfmpegVideoQualifiedCapabilitiesOptions {
	readonly productId: DesktopVideoCodecProductId;
	readonly scratchRoot: string;
	readonly preferences: Pick<ExternalFfmpegPreferenceService, 'admission' | 'invalidateAdmission'>;
	readonly digestExecutable: (path: string) => Promise<string>;
	readonly spawn?: ExternalFfmpegVideoSpawn;
	readonly environment: Readonly<Record<string, string | undefined>>;
	readonly qualify?: ExternalFfmpegVideoQualifier;
}

export interface ExternalFfmpegVideoQualifiedCapabilities {
	capabilities(): Promise<DesktopExternalFfmpegVideoCapabilities>;
	admission(format: DesktopVideoCodecFormat): Promise<ExternalFfmpegRuntimeAdmission>;
}

export class ExternalFfmpegVideoCapabilityError extends Error {
	constructor(readonly reason: string, message: string) {
		super(message); this.name = 'ExternalFfmpegVideoCapabilityError';
	}
}

export function createExternalFfmpegVideoQualifiedCapabilities(
	options: ExternalFfmpegVideoQualifiedCapabilitiesOptions,
): ExternalFfmpegVideoQualifiedCapabilities {
	assertProduct(options.productId);
	const qualify = options.qualify ?? ((admission) => qualifyExternalFfmpegVideoAdmission({
		scratchRoot: join(options.scratchRoot, 'qualification'), admission,
		digestExecutable: options.digestExecutable,
		...(options.spawn ? { spawn: options.spawn } : {}),
		environment: options.environment,
	}));
	const cached = new WeakMap<ExternalFfmpegRuntimeAdmission, Promise<DesktopExternalFfmpegVideoCapabilities>>();
	const qualifyExact = (admission: ExternalFfmpegRuntimeAdmission) => {
		const prior = cached.get(admission);
		if (prior) return prior;
		const result = Promise.resolve().then(() => qualify(admission)).catch(async (error: unknown) => {
			if (!(error instanceof ExternalFfmpegVideoQualificationIdentityError)) throw error;
			await options.preferences.invalidateAdmission(admission, error.reason);
			return createDesktopExternalFfmpegVideoCapabilities(null);
		});
		cached.set(admission, result);
		return result;
	};
	return Object.freeze({
		async capabilities() {
			assertProduct(options.productId);
			const admission = options.preferences.admission();
			if (!admission) return createDesktopExternalFfmpegVideoCapabilities(null);
			const capabilities = await qualifyExact(admission);
			if (!sameAdmission(options.preferences.admission(), admission)) {
				return createDesktopExternalFfmpegVideoCapabilities(null);
			}
			return capabilities;
		},
		async admission(format: DesktopVideoCodecFormat) {
			assertProduct(options.productId);
			const admission = options.preferences.admission();
			if (!admission) throw unavailable(format, createDesktopExternalFfmpegVideoCapabilities(null));
			const capabilities = await qualifyExact(admission);
			if (!sameAdmission(options.preferences.admission(), admission)) {
				throw new ExternalFfmpegVideoCapabilityError(
					'stale-admission', 'The external FFmpeg admission changed during video qualification.',
				);
			}
			if (!capabilities.formats[format].available) throw unavailable(format, capabilities);
			return admission;
		},
	});
}

function unavailable(
	format: DesktopVideoCodecFormat,
	capabilities: DesktopExternalFfmpegVideoCapabilities,
): ExternalFfmpegVideoCapabilityError {
	return new ExternalFfmpegVideoCapabilityError(
		'capability-unavailable',
		capabilities.formats[format].reason ?? 'Desktop video export is unavailable.',
	);
}

function sameAdmission(
	left: ExternalFfmpegRuntimeAdmission | null,
	right: ExternalFfmpegRuntimeAdmission,
): boolean {
	return left !== null && left.executablePath === right.executablePath
		&& left.capabilityGeneration === right.capabilityGeneration
		&& left.identity.executablePairClosureSha256 === right.identity.executablePairClosureSha256;
}

function assertProduct(value: unknown): asserts value is DesktopVideoCodecProductId {
	if (value !== 'soundscaper' && value !== 'framescaper') {
		throw new ExternalFfmpegVideoCapabilityError(
			'product-unavailable', 'This desktop product has no admitted external video provider.',
		);
	}
}
