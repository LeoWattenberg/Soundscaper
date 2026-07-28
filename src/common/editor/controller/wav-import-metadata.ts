/* SPDX-License-Identifier: AGPL-3.0-only */

import { scaleBextTimeReference } from '../broadcast-wave-project.ts';
import { normalizeProjectBextMetadata } from '../project-bext-metadata.ts';

// Legacy controller values are narrowed as the owning import service migrates.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function prepareImportedWavMetadata(options: Readonly<Record<string, any>>): Readonly<Record<string, any>> {
	const { descriptor, importOptions, project, projectSampleRate, copy, freezeImportOptions } = options;
	const sourceBext = descriptor?.bext || null;
	const sourceIxml = descriptor?.ixml || null;
	const sourceCart = descriptor?.cart || null;
	const warnings = Array.isArray(descriptor?.metadataWarnings) ? [...descriptor.metadataWarnings] : [];
	const extensions = {
		projectIxml: project.metadata?.ixml == null ? sourceIxml : null,
		projectCart: project.metadata?.cart == null ? sourceCart : null,
		sourceIxml,
		sourceCart,
	};
	if (!sourceBext) return Object.freeze({ importOptions, projectBext: null, sourceBext: null, ...extensions, warnings: Object.freeze(warnings) });
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
	return Object.freeze({
		importOptions: freezeImportOptions({ ...importOptions, timelineStartFrame }, Boolean(importOptions.timelineStartExplicit)),
		projectBext, sourceBext, ...extensions, warnings: Object.freeze(warnings),
	});
}

function warning(code: string, message: string): Readonly<{ code: string; message: string }> {
	return Object.freeze({ code, message });
}
