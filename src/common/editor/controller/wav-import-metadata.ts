/* SPDX-License-Identifier: AGPL-3.0-only */

import { scaleBextTimeReference } from '../broadcast-wave-project.ts';
import { isNeutralAdmSignalPath } from '../adm-passthrough-project.ts';
import { normalizeAdmProjectMetadata } from '../adm-project-metadata.ts';
import { normalizeProjectBextMetadata } from '../project-bext-metadata.ts';

// Legacy controller values are narrowed as the owning import service migrates.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function prepareImportedWavMetadata(options: Readonly<Record<string, any>>): Readonly<Record<string, any>> {
	const { descriptor, importOptions, project, projectSampleRate, copy, freezeImportOptions } = options;
	const sourceBext = descriptor?.bext || null;
	const sourceIxml = descriptor?.ixml || null;
	const sourceCart = descriptor?.cart || null;
	const sourceAdm = descriptor?.adm || null;
	const warnings = Array.isArray(descriptor?.metadataWarnings) ? [...descriptor.metadataWarnings] : [];
	const extensions = (resolvedImportOptions: Readonly<Record<string, unknown>>) => ({
		projectIxml: project.metadata?.ixml == null ? sourceIxml : null,
		projectCart: project.metadata?.cart == null ? sourceCart : null,
		projectAdmCandidate: shouldPromoteAdm(project, descriptor, resolvedImportOptions, sourceAdm, projectSampleRate, warnings)
			? sourceAdm
			: null,
		sourceIxml,
		sourceCart,
		sourceAdm,
	});
	if (!sourceBext) return Object.freeze({ importOptions, projectBext: null, sourceBext: null, ...extensions(importOptions), warnings: Object.freeze(warnings) });
	let sourceTimeReference: string | null = null;
	try {
		sourceTimeReference = scaleBextTimeReference(String(sourceBext.timeReference), descriptor.sampleRate, projectSampleRate);
	} catch {
		warnings.push(warning('bext-time-reference-conversion', copy.bextTimeReferenceConversionWarning
			|| 'The BEXT TimeReference cannot be represented at the project sample rate.'));
	}
	const projectBext = project.metadata?.bext === null ? normalizeProjectBextMetadata({
		...sourceBext,
		timeReference: sourceTimeReference ?? '0',
	}) : null;
	let timelineStartFrame = importOptions.timelineStartFrame;
	if (importOptions.destination === 'timeline' && !importOptions.timelineStartExplicit) {
		const origin = projectBext?.timeReference ?? project.metadata?.bext?.timeReference;
		try {
			if (sourceTimeReference === null || typeof origin !== 'string') throw new RangeError('missing origin');
			const spottedFrame = BigInt(sourceTimeReference) - BigInt(origin);
			if (spottedFrame < 0n || spottedFrame > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('unsafe position');
			timelineStartFrame = Number(spottedFrame);
		} catch {
			timelineStartFrame = 0;
			warnings.push(warning('bext-spot-out-of-range', copy.bextSpotOutOfRangeWarning
				|| 'The BEXT TimeReference produces a negative or unrepresentable timeline position; the source was placed at frame zero.'));
		}
	}
	const resolvedImportOptions = freezeImportOptions({ ...importOptions, timelineStartFrame }, Boolean(importOptions.timelineStartExplicit));
	return Object.freeze({
		importOptions: resolvedImportOptions,
		projectBext, sourceBext, ...extensions(resolvedImportOptions), warnings: Object.freeze(warnings),
	});
}

// Legacy controller values are narrowed as the owning import service migrates.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createImportedAdmPassthroughMetadata(options: Readonly<Record<string, any>>) {
	const { candidate, source, descriptor, project } = options;
	if (!candidate || candidate.valid !== true) return null;
	const bitDepth = admPcmPrecision(descriptor);
	return normalizeAdmProjectMetadata({
		mode: 'passthrough',
		payload: candidate.payload,
		...(candidate.serialPayload ? { serialPayload: candidate.serialPayload } : {}),
		...(candidate.auxiliaryPayloads ? { auxiliaryPayloads: candidate.auxiliaryPayloads } : {}),
		...(candidate.opaqueRiffChunks ? { opaqueRiffChunks: candidate.opaqueRiffChunks } : {}),
		chna: {
			entries: (candidate.chna?.entries || []).map((entry: Readonly<Record<string, unknown>>) => ({
				trackIndex: entry.trackIndex,
				audioTrackUid: entry.uid,
				audioTrackFormatIdRef: entry.trackRef,
				audioPackFormatIdRef: entry.packRef,
			})),
			rawBase64: candidate.chna?.rawBase64 || '',
		},
		source: { id: source.id, storageKey: source.storageKey, mimeType: source.mimeType },
		geometry: {
			sampleRate: descriptor.sampleRate,
			channelCount: descriptor.channelCount,
			frameCount: descriptor.frameCount,
			bitDepth,
			float: descriptor.encoding === 'ieee-float',
		},
		pristineRevision: project.revision + 1,
		valid: Boolean(candidate.valid),
		warnings: Array.isArray(candidate.warnings) ? candidate.warnings : [],
	});
}

// Legacy controller values are narrowed as the owning import service migrates.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function shouldPromoteAdm(project: any, descriptor: any, importOptions: any, sourceAdm: any, projectSampleRate: any, warnings: any[]): boolean {
	if (!sourceAdm || sourceAdm.valid !== true || sourceAdm.container !== 'bw64' || project.metadata?.adm != null) return false;
	if (importOptions.destination !== 'timeline' || importOptions.timelineStartFrame !== 0) return false;
	const empty = ['sources', 'clips'].every((field) => Array.isArray(project[field]) && project[field].length === 0)
		&& Array.isArray(project.tracks) && project.tracks.every(isEmptyAudioTrack)
		&& Array.isArray(project.projectBin?.clips) && project.projectBin.clips.length === 0;
	if (!empty || !Number.isSafeInteger(project.revision) || project.revision < 0) return false;
	if (!isNeutralAdmSignalPath(project)) {
		warnings.push(warning(
			'adm-passthrough-project-not-pristine',
			'ADM passthrough requires a neutral project mixer with no gain, pan, mute, routing, automation, or effects changes.',
		));
		return false;
	}
	if (descriptor.sampleRate !== projectSampleRate) {
		warnings.push(warning(
			'adm-passthrough-sample-rate-mismatch',
			'ADM passthrough requires the source and project sample rates to match.',
		));
		return false;
	}
	if (![16, 20, 24].includes(descriptor.bitDepth)
		|| ![16, 20, 24].includes(admPcmPrecision(descriptor))
		|| descriptor.encoding !== 'pcm-integer'
		|| !Number.isSafeInteger(descriptor.channelCount)
		|| descriptor.channelCount < 1
		|| descriptor.channelCount > 32) {
		warnings.push(warning(
			'adm-passthrough-geometry-unsupported',
			'ADM passthrough requires 1–32 channels of 16-, 20-, or 24-bit integer PCM.',
		));
		return false;
	}
	return true;
}

function admPcmPrecision(descriptor: Readonly<Record<string, unknown>>): number {
	const value = descriptor.encoding === 'pcm-integer'
		? descriptor.validBitsPerSample ?? descriptor.bitDepth
		: descriptor.bitDepth;
	return typeof value === 'number' ? value : Number.NaN;
}

function isEmptyAudioTrack(track: unknown): boolean {
	if (!track || typeof track !== 'object' || Array.isArray(track)) return false;
	const candidate = track as Readonly<Record<string, unknown>>;
	return candidate.type === 'audio' && Array.isArray(candidate.clipIds) && candidate.clipIds.length === 0;
}

function warning(code: string, message: string): Readonly<{ code: string; message: string }> {
	return Object.freeze({ code, message });
}
