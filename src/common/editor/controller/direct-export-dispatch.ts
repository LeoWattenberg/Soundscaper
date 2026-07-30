/* SPDX-License-Identifier: AGPL-3.0-only */

import { prepareDirectAiffDestination } from './direct-aiff-export.ts';
import { prepareDirectBwfDestination } from './direct-bwf-export.ts';
import type { DirectPcmPreparation } from './direct-pcm-export.ts';
import { prepareDirectWavDestination } from './direct-wav-export.ts';

interface DirectExportPlan {
	readonly format?: unknown;
	readonly [key: string]: unknown;
}

interface DirectExportFileService {
	readonly prepareSave?: (request: Readonly<Record<string, unknown>>) => PromiseLike<unknown> | unknown;
}

export function prepareDirectPcmExportDestination(
	fileService: DirectExportFileService,
	plan: DirectExportPlan,
	requestedSettings: Readonly<Record<string, unknown>> | null | undefined,
	signal: AbortSignal,
): Promise<DirectPcmPreparation> {
	if (plan.format === 'aiff') {
		return prepareDirectAiffDestination(fileService, plan, requestedSettings, signal);
	}
	if (plan.format === 'bwf') {
		return prepareDirectBwfDestination(fileService, plan, requestedSettings, signal);
	}
	return prepareDirectWavDestination(fileService, plan, requestedSettings, signal);
}

export function directPcmContainerLabel(format: unknown): 'AIFF' | 'BWF' | 'WAV' {
	return format === 'aiff' ? 'AIFF' : format === 'bwf' ? 'BWF' : 'WAV';
}
