/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	captureCanonicalRealtimeCompressedPlan,
	fingerprintCanonicalCompressedSnapshot,
	type DirectCompressedFormat,
	type DirectCompressedPlan,
} from './direct-compressed-plan.ts';
import { inspectZip32Layout, type Zip32Layout } from './zip32.ts';

export const DIRECT_COMPRESSED_STEM_MINIMUM_ENTRY_BYTES = 1024 * 1024;

interface CompressedStemOutput {
	readonly fileName: string;
	readonly trackId: string;
}

export interface DirectCompressedStemArchiveContract {
	readonly archiveFileName: string;
	readonly entryMaximumByteLength: number;
	readonly fingerprint: string;
	readonly format: DirectCompressedFormat;
	readonly maximumZip32: Zip32Layout;
	readonly outputs: readonly CompressedStemOutput[];
	readonly stagingByteLength: number;
}

/** Admit a bounded final-ZIP route without claiming a codec expansion bound. */
export function captureDirectCompressedStemArchiveContract(
	plan: DirectCompressedPlan,
): DirectCompressedStemArchiveContract | null {
	try {
		const captured = captureCanonicalRealtimeCompressedPlan(plan);
		if (!captured) return null;
		const ownedPlan = captured.plan;
		const { core } = captured;
		const render = record(ownedPlan.render);
		const archive = record(ownedPlan.archive);
		if (!render || !archive
			|| ownedPlan.mode !== 'stems'
			|| ownedPlan.outputFileBytesPerRender !== null
			|| !Array.isArray(ownedPlan.outputs)
			|| ownedPlan.outputs.length < 1
			|| !sameKeys(archive, [
				'format', 'fileName', 'mimeType', 'expectedByteLength',
				'requiredTemporaryBytes', 'fallbackRequiredTemporaryBytes', 'entries', 'zip32',
			])
			|| archive.format !== 'zip'
			|| archive.mimeType !== 'application/zip'
			|| archive.expectedByteLength !== null
			|| archive.zip32 !== null
			|| typeof archive.fileName !== 'string'
			|| !flatFileName(archive.fileName, '.zip')
			|| !Array.isArray(archive.entries)
			|| archive.entries.length !== ownedPlan.outputs.length) return null;

		const outputs: CompressedStemOutput[] = [];
		const names = new Set<string>();
		const trackIds = new Set<string>();
		const suffix = `.${core.extension}`;
		for (const [index, value] of ownedPlan.outputs.entries()) {
			const output = record(value);
			const entry = record(archive.entries[index]);
			if (!output || !entry
				|| !sameKeys(output, ['kind', 'fileName', 'trackId', 'includeMaster', 'respectMuteSolo'])
				|| !sameKeys(entry, ['fileName', 'expectedByteLength'])
				|| output.kind !== 'stem'
				|| output.includeMaster !== false
				|| output.respectMuteSolo !== false
				|| typeof output.trackId !== 'string'
				|| !output.trackId
				|| typeof output.fileName !== 'string'
				|| !flatFileName(output.fileName, suffix)
				|| entry.fileName !== output.fileName
				|| entry.expectedByteLength !== null
				|| names.has(output.fileName)
				|| trackIds.has(output.trackId)) return null;
			names.add(output.fileName);
			trackIds.add(output.trackId);
			outputs.push(Object.freeze({
				fileName: output.fileName,
				trackId: output.trackId,
			}));
		}

		const aggregateStagingBytes = multiplySafe(core.outputBytesPerRender, outputs.length);
		if (ownedPlan.requiredTemporaryBytes !== aggregateStagingBytes
			|| archive.requiredTemporaryBytes !== aggregateStagingBytes
			|| archive.fallbackRequiredTemporaryBytes !== aggregateStagingBytes) return null;

		const entryMaximumByteLength = Math.max(
			core.outputBytesPerRender,
			DIRECT_COMPRESSED_STEM_MINIMUM_ENTRY_BYTES,
		);
		const maximumZip32 = inspectZip32Layout(outputs.map(({ fileName }) => ({
			fileName,
			byteLength: entryMaximumByteLength,
		})));
		if (!maximumZip32.eligible) return null;
		const fingerprint = fingerprintCanonicalCompressedSnapshot({
			core: core.fingerprint,
			render,
			requiredTemporaryBytes: aggregateStagingBytes,
			outputs: outputs.map((output) => ({
				kind: 'stem',
				fileName: output.fileName,
				trackId: output.trackId,
				includeMaster: false,
				respectMuteSolo: false,
			})),
			archive: {
				format: 'zip',
				fileName: archive.fileName,
				mimeType: 'application/zip',
				expectedByteLength: null,
				requiredTemporaryBytes: aggregateStagingBytes,
				fallbackRequiredTemporaryBytes: aggregateStagingBytes,
				entries: outputs.map(({ fileName }) => ({
					fileName,
					expectedByteLength: null,
				})),
				zip32: null,
			},
			entryMaximumByteLength,
			maximumZip32,
		});
		if (!fingerprint) return null;

		return Object.freeze({
			archiveFileName: archive.fileName,
			entryMaximumByteLength,
			fingerprint,
			format: core.id,
			maximumZip32,
			outputs: Object.freeze(outputs),
			stagingByteLength: core.outputBytesPerRender,
		});
	} catch {
		return null;
	}
}

function flatFileName(value: string, suffix: string): boolean {
	return value.length > suffix.length
		&& value.toLowerCase().endsWith(suffix)
		&& value !== '.'
		&& value !== '..'
		&& !/[\u0000-\u001f\u007f]/u.test(value)
		&& !value.includes('/')
		&& !value.includes('\\');
}

function multiplySafe(left: number, right: number): number {
	if (!Number.isSafeInteger(left) || left < 0
		|| !Number.isSafeInteger(right) || right < 0
		|| (right && left > Math.floor(Number.MAX_SAFE_INTEGER / right))) {
		throw new RangeError('Direct compressed stem staging geometry exceeds JavaScript safe integers.');
	}
	return left * right;
}

function record(value: unknown): Readonly<Record<string, unknown>> | null {
	return Boolean(value && typeof value === 'object' && !Array.isArray(value))
		? value as Readonly<Record<string, unknown>>
		: null;
}

function sameKeys(value: Readonly<Record<string, unknown>>, fields: readonly string[]): boolean {
	const keys = Object.keys(value).sort();
	return keys.length === fields.length
		&& [...fields].sort().every((field, index) => field === keys[index]);
}
