/* SPDX-License-Identifier: AGPL-3.0-only */

import { inspectAiffBlobPcm } from '../aiff-pcm-chunk-reader.ts';
import { maintainedAiffMimeType } from './aiff-file-identity.ts';
import type { LinkedOriginalImportLocatorReference } from './project-import-options.ts';
import {
	inspectWavContainerSignature,
	inspectWavForImport,
} from './wav-import-routing.ts';

type ImportOptions = Record<string, unknown>;

export interface LinkedAudioImportAdmissionOptions {
	readonly importLinkedPcm: (
		file: unknown,
		descriptor: unknown,
		importOptions: ImportOptions,
		metadata: unknown,
	) => PromiseLike<unknown> | unknown;
	readonly inspectWavBlobPcm: (file: unknown) => Promise<unknown>;
	readonly isWavFile: (file: unknown) => boolean;
	readonly prepareWavImportMetadata: (
		descriptor: unknown,
		importOptions: ImportOptions,
	) => unknown;
	readonly releaseLinkedOriginalLocator: (
		reference: LinkedOriginalImportLocatorReference,
	) => PromiseLike<unknown> | unknown;
	readonly validateImportTimelineTrack: (importOptions: ImportOptions) => unknown;
}

/** Structurally admit a linked PCM container before binding its exact locator. */
export function createLinkedAudioImportAdmission(options: LinkedAudioImportAdmissionOptions) {
	return async function importLinkedAudio(
		file: unknown,
		importOptions: ImportOptions,
		locator: LinkedOriginalImportLocatorReference,
	): Promise<unknown> {
		let delegated = false;
		try {
			options.validateImportTimelineTrack(importOptions);
			const admitted = maintainedAiffMimeType(file)
				? await inspectLinkedAiff(file, importOptions)
				: await inspectLinkedWav(file, importOptions, options);
			delegated = true;
			return await options.importLinkedPcm(
				file,
				admitted.descriptor,
				importOptions,
				admitted.metadata,
			);
		} catch (error) {
			if (delegated) throw error;
			try {
				await options.releaseLinkedOriginalLocator(locator);
			} catch (cleanupError) {
				throw new AggregateError(
					[error, cleanupError],
					'Linked PCM import admission and locator cleanup both failed.',
					{ cause: error },
				);
			}
			throw error;
		}
	};
}

async function inspectLinkedAiff(
	file: unknown,
	importOptions: ImportOptions,
): Promise<Readonly<{ descriptor: unknown; metadata: unknown }>> {
	const descriptor = await inspectAiffBlobPcm(file);
	return Object.freeze({
		descriptor,
		metadata: Object.freeze({
			importOptions,
			warnings: Object.freeze([]),
			projectBext: null,
			projectIxml: null,
			projectCart: null,
			projectAdmCandidate: null,
			sourceBext: null,
			sourceIxml: null,
			sourceCart: null,
			sourceAdm: null,
		}),
	});
}

async function inspectLinkedWav(
	file: unknown,
	importOptions: ImportOptions,
	options: LinkedAudioImportAdmissionOptions,
): Promise<Readonly<{ descriptor: unknown; metadata: unknown }>> {
	const signature = await inspectWavContainerSignature(file, options.isWavFile);
	const descriptor = await inspectWavForImport(
		file,
		options.isWavFile,
		options.inspectWavBlobPcm,
		signature,
	);
	if (!signature || !descriptor) {
		throw new TypeError(
			'Linked audio originals are limited to maintained classic AIFF or PCM RIFF, RF64, and BW64 WAV containers.',
		);
	}
	return Object.freeze({
		descriptor,
		metadata: options.prepareWavImportMetadata(descriptor, importOptions),
	});
}
