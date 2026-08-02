/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	captureDirectNativeStemArchiveContract,
	sameDirectNativeStemArchiveContract,
	type DirectNativeStemArchiveContract,
} from '../src/common/editor/controller/direct-native-stem-archive-plan.ts';
import { sevenZipCopyArchiveByteLength } from '../src/common/editor/controller/sequential-seven-zip-copy.ts';
import { inspectZip32Layout } from '../src/common/editor/controller/zip32.ts';

test('captures immutable exact native ZIP and 7z stem contracts', () => {
	for (const archiveFormat of ['zip', '7z'] as const) {
		for (const format of ['wav', 'bwf', 'aiff'] as const) {
			const contract = captureDirectNativeStemArchiveContract(nativePlan(format, archiveFormat));
			assert.ok(contract, `${format} ${archiveFormat}`);
			assert.deepEqual(contract, {
				kind: 'exact-native-pcm',
				format,
				archiveFormat,
				archiveMimeType: archiveFormat === 'zip'
					? 'application/zip'
					: 'application/x-7z-compressed',
				archiveFileName: `session-stems.${archiveFormat}`,
				archiveByteLength: contract.archiveByteLength,
				entryByteLength: 60,
				stagingByteLength: 60,
				outputs: [
					{ fileName: `01-dialogue.${format === 'aiff' ? 'aiff' : 'wav'}`, trackId: 'track-0' },
					{ fileName: `02-music.${format === 'aiff' ? 'aiff' : 'wav'}`, trackId: 'track-1' },
				],
				zip32: contract.zip32,
			});
			assert.equal(Object.isFrozen(contract), true);
			assert.equal(Object.isFrozen(contract.outputs), true);
			assert.equal(Object.isFrozen(contract.outputs[0]), true);
			assert.equal(Object.isFrozen(contract.zip32), true);
			assert.equal(contract.zip32.eligible, true, 'small injected 7z geometry remains admissible');
		}
	}
});

test('requires exact archive size and recomputed ZIP geometry', () => {
	const zip = nativePlan('wav', 'zip');
	const sevenZip = nativePlan('wav', '7z');
	assert.ok(captureDirectNativeStemArchiveContract(zip));
	assert.ok(captureDirectNativeStemArchiveContract(sevenZip));

	assert.equal(captureDirectNativeStemArchiveContract({
		...zip,
		archive: { ...zip.archive, expectedByteLength: zip.archive.expectedByteLength + 1 },
	}), null);
	assert.equal(captureDirectNativeStemArchiveContract({
		...zip,
		archive: {
			...zip.archive,
			zip32: { ...zip.archive.zip32, localByteLength: zip.archive.zip32.localByteLength + 1 },
		},
	}), null);
	assert.equal(captureDirectNativeStemArchiveContract({
		...sevenZip,
		archive: { ...sevenZip.archive, expectedByteLength: sevenZip.archive.expectedByteLength + 1 },
	}), null);

	const tooLargeForZip32 = nativePlan('wav', '7z', 0xffff_ffff);
	assert.equal(tooLargeForZip32.archive.zip32.eligible, false);
	assert.ok(captureDirectNativeStemArchiveContract(tooLargeForZip32));
	assert.equal(captureDirectNativeStemArchiveContract({
		...tooLargeForZip32,
		archive: {
			...tooLargeForZip32.archive,
			format: 'zip',
			fileName: 'session-stems.zip',
			mimeType: 'application/zip',
			expectedByteLength: tooLargeForZip32.archive.zip32.archiveByteLength,
		},
	}), null);
});

test('rejects non-native, inexact, mismatched, nested, duplicate, and malformed plans', () => {
	const base = nativePlan('wav', 'zip');
	const cases: ReadonlyArray<readonly [string, unknown]> = [
		['mix mode', { ...base, mode: 'mix' }],
		['compressed', { ...base, format: 'mp3' }],
		['BW64', { ...base, format: 'bw64' }],
		['native MIME', { ...base, mimeType: 'audio/aiff' }],
		['empty output', { ...base, outputs: [] }],
		['zero entry bytes', { ...base, outputFileBytesPerRender: 0 }],
		['archive MIME', { ...base, archive: { ...base.archive, mimeType: 'application/x-7z-compressed' } }],
		['archive extension', { ...base, archive: { ...base.archive, fileName: 'session-stems.7z' } }],
		['nested archive', { ...base, archive: { ...base.archive, fileName: 'exports/session-stems.zip' } }],
		['entry order', {
			...base,
			archive: { ...base.archive, entries: [...base.archive.entries].reverse() },
		}],
		['entry size', {
			...base,
			archive: {
				...base.archive,
				entries: [{ ...base.archive.entries[0], expectedByteLength: 61 }, base.archive.entries[1]],
			},
		}],
		['nested entry', {
			...base,
			outputs: [{ ...base.outputs[0], fileName: 'folder/dialogue.wav' }, base.outputs[1]],
			archive: {
				...base.archive,
				entries: [{ ...base.archive.entries[0], fileName: 'folder/dialogue.wav' }, base.archive.entries[1]],
			},
		}],
		['wrong entry extension', {
			...base,
			outputs: [{ ...base.outputs[0], fileName: '01-dialogue.aiff' }, base.outputs[1]],
			archive: {
				...base.archive,
				entries: [{ ...base.archive.entries[0], fileName: '01-dialogue.aiff' }, base.archive.entries[1]],
			},
		}],
		['missing track ID', {
			...base,
			outputs: [{ ...base.outputs[0], trackId: '' }, base.outputs[1]],
		}],
		['duplicate track ID', {
			...base,
			outputs: [base.outputs[0], { ...base.outputs[1], trackId: base.outputs[0].trackId }],
		}],
		['duplicate entry', {
			...base,
			outputs: [base.outputs[0], { ...base.outputs[1], fileName: base.outputs[0].fileName }],
			archive: {
				...base.archive,
				entries: [base.archive.entries[0], { ...base.archive.entries[1], fileName: base.archive.entries[0].fileName }],
			},
		}],
	];
	for (const [label, plan] of cases) {
		assert.equal(captureDirectNativeStemArchiveContract(plan), null, label);
	}
});

test('compares every captured native archive contract field', () => {
	const contract = captureDirectNativeStemArchiveContract(nativePlan('wav', 'zip'));
	assert.ok(contract);
	const clone = captureDirectNativeStemArchiveContract(structuredClone(nativePlan('wav', 'zip')));
	assert.ok(clone);
	assert.equal(sameDirectNativeStemArchiveContract(contract, clone), true);

	const variants: DirectNativeStemArchiveContract[] = [
		{ ...contract, format: 'bwf' },
		{ ...contract, archiveFormat: '7z' },
		{ ...contract, archiveMimeType: 'application/x-7z-compressed' },
		{ ...contract, archiveFileName: 'changed.zip' },
		{ ...contract, archiveByteLength: contract.archiveByteLength + 1 },
		{ ...contract, entryByteLength: contract.entryByteLength + 1 },
		{ ...contract, stagingByteLength: contract.stagingByteLength + 1 },
		{ ...contract, outputs: [{ ...contract.outputs[0]!, fileName: 'changed.wav' }, contract.outputs[1]!] },
		{ ...contract, outputs: [contract.outputs[0]!, { ...contract.outputs[1]!, trackId: 'changed' }] },
		{ ...contract, outputs: contract.outputs.slice(0, 1) },
		{ ...contract, zip32: { ...contract.zip32, eligible: false } },
		{ ...contract, zip32: { ...contract.zip32, entryCount: contract.zip32.entryCount + 1 } },
		{ ...contract, zip32: { ...contract.zip32, localByteLength: contract.zip32.localByteLength + 1 } },
		{
			...contract,
			zip32: {
				...contract.zip32,
				centralDirectoryByteLength: contract.zip32.centralDirectoryByteLength + 1,
			},
		},
		{ ...contract, zip32: { ...contract.zip32, archiveByteLength: contract.zip32.archiveByteLength + 1 } },
	];
	for (const variant of variants) {
		assert.equal(sameDirectNativeStemArchiveContract(contract, variant), false);
	}
});

function nativePlan(
	format: 'wav' | 'bwf' | 'aiff',
	archiveFormat: 'zip' | '7z',
	entryByteLength = 60,
) {
	const extension = format === 'aiff' ? 'aiff' : 'wav';
	const entries = [
		{ fileName: `01-dialogue.${extension}`, expectedByteLength: entryByteLength },
		{ fileName: `02-music.${extension}`, expectedByteLength: entryByteLength },
	];
	const zip32 = inspectZip32Layout(entries.map(({ fileName, expectedByteLength }) => ({
		fileName,
		byteLength: expectedByteLength,
	})));
	const expectedByteLength = archiveFormat === 'zip'
		? zip32.archiveByteLength
		: sevenZipCopyArchiveByteLength(entries);
	return {
		mode: 'stems',
		format,
		mimeType: format === 'aiff' ? 'audio/aiff' : 'audio/wav',
		outputFileBytesPerRender: entryByteLength,
		outputs: entries.map(({ fileName }, index) => ({ fileName, trackId: `track-${index}` })),
		archive: {
			format: archiveFormat,
			fileName: `session-stems.${archiveFormat}`,
			mimeType: archiveFormat === 'zip'
				? 'application/zip'
				: 'application/x-7z-compressed',
			expectedByteLength,
			requiredTemporaryBytes: expectedByteLength + entryByteLength,
			fallbackRequiredTemporaryBytes: entries.length * entryByteLength,
			entries,
			zip32,
		},
	};
}
