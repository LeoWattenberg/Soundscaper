/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	commitDirectPcmDestination,
	openDirectPcmDestination,
	type DirectPcmDestination,
	type DirectPcmPreparation,
} from './direct-pcm-export.ts';
import {
	createSequentialZip32Archive,
	type SequentialZip32Result,
	type Zip32StreamInput,
} from './sequential-zip32-stream.ts';
import { inspectZip32Layout, type Zip32Layout } from './zip32.ts';

const ZIP_CONTAINER_LABEL = 'ZIP';
const ZIP_FILE_TYPES = Object.freeze([Object.freeze({
	description: 'ZIP stem archive',
	accept: Object.freeze({ 'application/zip': Object.freeze(['.zip']) }),
})]);
const DIRECT_STEM_FORMATS = new Set(['wav', 'aiff', 'bwf']);

type Awaitable<Value> = PromiseLike<Value> | Value;

export interface DirectStemArchiveOutput {
	readonly fileName: string;
	readonly trackId: string;
}

interface DirectStemArchiveEntry {
	readonly expectedByteLength?: unknown;
	readonly fileName?: unknown;
}

interface DirectStemArchive {
	readonly entries?: unknown;
	readonly expectedByteLength?: unknown;
	readonly fileName?: unknown;
	readonly format?: unknown;
	readonly mimeType?: unknown;
	readonly zip32?: unknown;
}

interface DirectStemArchivePlan {
	readonly archive?: DirectStemArchive | null;
	readonly format?: unknown;
	readonly mimeType?: unknown;
	readonly mode?: unknown;
	readonly outputFileBytesPerRender?: unknown;
	readonly outputs?: unknown;
}

export interface DirectStemArchiveEncodedOutput {
	readonly blob?: Blob | null;
	readonly bytes?: Zip32StreamInput | null;
	readonly byteLength?: number;
	readonly cleanup?: (() => Awaitable<void>) | null;
}

export interface DirectStemArchiveStreamOptions {
	readonly destination: DirectStemArchiveDestination;
	readonly plan: DirectStemArchivePlan;
	readonly signal: AbortSignal;
	readonly assertCurrent: () => void;
	readonly renderStem: (
		output: DirectStemArchiveOutput,
		index: number,
	) => Awaitable<DirectStemArchiveEncodedOutput>;
	readonly onStemComplete?: (progress: number, index: number) => Awaitable<void>;
}

export interface DirectStemArchiveStreamResult {
	readonly byteLength: number;
	readonly destination: DirectStemArchiveDestination;
	readonly mimeType: 'application/zip';
}

interface DirectStemArchiveFileService {
	readonly prepareSave?: (
		request: Readonly<Record<string, unknown>>,
	) => PromiseLike<unknown> | unknown;
}

interface ExactDirectStemArchivePlan extends DirectStemArchivePlan {
	readonly archive: DirectStemArchive & {
		readonly entries: readonly DirectStemArchiveEntry[];
		readonly expectedByteLength: number;
		readonly fileName: string;
		readonly zip32: Zip32Layout;
	};
	readonly outputFileBytesPerRender: number;
	readonly outputs: readonly DirectStemArchiveOutput[];
}

interface DirectStemArchiveContract {
	readonly archiveByteLength: number;
	readonly archiveFileName: string;
	readonly entryByteLength: number;
	readonly format: 'wav' | 'aiff' | 'bwf';
	readonly outputs: readonly DirectStemArchiveOutput[];
	readonly zip32: Zip32Layout;
}

export type DirectStemArchiveDestination = DirectPcmDestination;
export type DirectStemArchivePreparation = DirectPcmPreparation;

const preparedContracts = new WeakMap<DirectStemArchiveDestination, DirectStemArchiveContract>();

/** Select and open an exact direct destination only for validated native-PCM ZIP stems. */
export async function prepareDirectStemArchiveDestination(
	fileService: DirectStemArchiveFileService,
	plan: DirectStemArchivePlan,
	requestedSettings: Readonly<Record<string, unknown>> | null | undefined,
	signal: AbortSignal,
): Promise<DirectStemArchivePreparation> {
	const contract = captureContract(plan);
	if (!contract || typeof fileService.prepareSave !== 'function') {
		return emptyPreparation();
	}
	const settings = requestedSettings || {};
	const prepared = await fileService.prepareSave({
		purpose: 'audio',
		suggestedName: contract.archiveFileName,
		mimeType: 'application/zip',
		target: settings.saveTarget,
		types: ZIP_FILE_TYPES,
		useFileSystemAccess: settings.useFileSystemAccess !== false,
		signal,
	});
	const result = await openDirectPcmDestination(
		prepared,
		contract.archiveByteLength,
		ZIP_CONTAINER_LABEL,
	);
	if (result.destination) {
		preparedContracts.set(result.destination, contract);
		try {
			assertPreparedPlan(result.destination, plan);
		} catch (error) {
			throw await abortWithPrimary(result.destination, error);
		}
	}
	return result;
}

/** Largest sequential intermediate retained while the final archive streams directly. */
export function directStemArchiveTemporaryBytes(plan: DirectStemArchivePlan): number | null {
	return exactDirectStemArchivePlan(plan) ? plan.outputFileBytesPerRender : null;
}

export function commitDirectStemArchiveDestination(
	destination: DirectStemArchiveDestination,
	plannedByteLength: number,
	emittedByteLength: number,
	assertReadyToCommit: () => void,
): Promise<Readonly<Record<string, unknown>>> {
	return commitDirectPcmDestination(
		destination,
		plannedByteLength,
		emittedByteLength,
		assertReadyToCommit,
		ZIP_CONTAINER_LABEL,
	);
}

/** Stream exact native-PCM stems into the already-opened ZIP destination in plan order. */
export async function streamDirectStemArchive(
	options: DirectStemArchiveStreamOptions,
): Promise<DirectStemArchiveStreamResult> {
	const { destination, plan, signal } = options;
	const contract = assertPreparedPlan(destination, plan);
	const archive = await createSequentialZip32Archive<DirectStemArchiveDestination>({
		write: (chunk) => destination.write(chunk),
		async close() {
			assertReady(options);
			await destination.close();
			return destination;
		},
		abort: () => destination.abort(),
	});
	let finished = false;
	try {
		for (const [index, output] of contract.outputs.entries()) {
			assertReady(options);
			const encoded = await options.renderStem(output, index);
			await consumeEncodedStem(encoded, async () => {
				assertReady(options);
				const input = encoded.blob ?? encoded.bytes;
				const inputBytes = zipInputByteLength(input);
				if (inputBytes !== contract.entryByteLength
					|| (encoded.byteLength !== undefined && encoded.byteLength !== contract.entryByteLength)) {
					throw new Error(`Direct stem archive input byte length does not match its plan: ${output.fileName}`);
				}
				await archive.add(output.fileName, input!, signal);
				assertReady(options);
			});
			await options.onStemComplete?.((index + 1) / contract.outputs.length, index);
		}
		assertReady(options);
		const result = await archive.finish();
		finished = true;
		assertReady(options);
		assertArchiveResult(contract, destination, result);
		return Object.freeze({
			byteLength: result.byteLength,
			destination,
			mimeType: 'application/zip',
		});
	} catch (error) {
		if (finished) throw await abortWithPrimary(destination, error);
		try {
			await archive.abort();
		} catch (cleanupError) {
			throw combineErrors(error, cleanupError, 'Direct stem archive destination cleanup also failed.');
		}
		throw error;
	}
}

/** Commit only the immutable plan contract captured before destination selection. */
export function commitPreparedDirectStemArchiveDestination(
	destination: DirectStemArchiveDestination,
	plan: DirectStemArchivePlan,
	emittedByteLength: number,
	assertReadyToCommit: () => void,
): Promise<Readonly<Record<string, unknown>>> {
	const contract = assertPreparedPlan(destination, plan);
	return commitDirectPcmDestination(
		destination,
		contract.archiveByteLength,
		emittedByteLength,
		() => {
			assertPreparedPlan(destination, plan);
			assertReadyToCommit();
		},
		ZIP_CONTAINER_LABEL,
	);
}

function exactDirectStemArchivePlan(
	plan: DirectStemArchivePlan,
): plan is ExactDirectStemArchivePlan {
	try {
		const nativeFormat = String(plan?.format);
		const nativeMimeType = nativeFormat === 'aiff' ? 'audio/aiff' : 'audio/wav';
		const nativeExtension = nativeFormat === 'aiff' ? '.aiff' : '.wav';
		if (plan?.mode !== 'stems'
			|| !DIRECT_STEM_FORMATS.has(nativeFormat)
			|| plan.mimeType !== nativeMimeType
			|| !Number.isSafeInteger(plan.outputFileBytesPerRender)
			|| Number(plan.outputFileBytesPerRender) <= 0
			|| !Array.isArray(plan.outputs)
			|| !plan.outputs.length
			|| plan.archive?.format !== 'zip'
			|| plan.archive.mimeType !== 'application/zip'
			|| typeof plan.archive.fileName !== 'string'
			|| !plan.archive.fileName.toLowerCase().endsWith('.zip')
			|| !Number.isSafeInteger(plan.archive.expectedByteLength)
			|| Number(plan.archive.expectedByteLength) <= 0
			|| !Array.isArray(plan.archive.entries)
			|| plan.archive.entries.length !== plan.outputs.length
			|| !isZip32Layout(plan.archive.zip32)) return false;
		const entryBytes = plan.outputFileBytesPerRender as number;
		const entries = plan.archive.entries as readonly DirectStemArchiveEntry[];
		const outputs = plan.outputs as readonly DirectStemArchiveOutput[];
		for (const [index, entry] of entries.entries()) {
			if (typeof entry?.fileName !== 'string'
				|| entry.fileName !== outputs[index]?.fileName
				|| !entry.fileName.toLowerCase().endsWith(nativeExtension)
				|| typeof outputs[index]?.trackId !== 'string'
				|| !outputs[index]?.trackId
				|| entry.expectedByteLength !== entryBytes) return false;
		}
		const expected = inspectZip32Layout(entries.map((entry) => ({
			fileName: entry.fileName as string,
			byteLength: entry.expectedByteLength as number,
		})));
		return expected.eligible
			&& sameZip32Layout(expected, plan.archive.zip32)
			&& expected.archiveByteLength === plan.archive.expectedByteLength;
	} catch {
		return false;
	}
}

function captureContract(plan: DirectStemArchivePlan): DirectStemArchiveContract | null {
	if (!exactDirectStemArchivePlan(plan)) return null;
	return Object.freeze({
		archiveByteLength: plan.archive.expectedByteLength,
		archiveFileName: plan.archive.fileName,
		entryByteLength: plan.outputFileBytesPerRender,
		format: plan.format as DirectStemArchiveContract['format'],
		outputs: Object.freeze(plan.outputs.map((output) => Object.freeze({
			fileName: output.fileName,
			trackId: output.trackId,
		}))),
		zip32: Object.freeze({ ...plan.archive.zip32 }),
	});
}

function assertPreparedPlan(
	destination: DirectStemArchiveDestination,
	plan: DirectStemArchivePlan,
): DirectStemArchiveContract {
	const expected = preparedContracts.get(destination);
	const current = captureContract(plan);
	if (!expected || !current || !sameContract(expected, current)) {
		throw new Error('The direct stem archive plan changed after its destination was selected.');
	}
	return expected;
}

function sameContract(left: DirectStemArchiveContract, right: DirectStemArchiveContract): boolean {
	return left.archiveByteLength === right.archiveByteLength
		&& left.archiveFileName === right.archiveFileName
		&& left.entryByteLength === right.entryByteLength
		&& left.format === right.format
		&& sameZip32Layout(left.zip32, right.zip32)
		&& left.outputs.length === right.outputs.length
		&& left.outputs.every((output, index) => (
			output.fileName === right.outputs[index]?.fileName
			&& output.trackId === right.outputs[index]?.trackId
		));
}

function assertReady(options: DirectStemArchiveStreamOptions): void {
	options.signal.throwIfAborted();
	options.assertCurrent();
	assertPreparedPlan(options.destination, options.plan);
}

function zipInputByteLength(input: Zip32StreamInput | null | undefined): number {
	if (input instanceof Blob) return input.size;
	if (input instanceof ArrayBuffer) return input.byteLength;
	if (ArrayBuffer.isView(input)) return input.byteLength;
	throw new TypeError('Direct stem archive render output has no valid input bytes.');
}

async function consumeEncodedStem(
	encoded: DirectStemArchiveEncodedOutput,
	consume: () => Promise<void>,
): Promise<void> {
	let primary: unknown;
	let failed = false;
	try {
		await consume();
	} catch (error) {
		primary = error;
		failed = true;
	}
	try {
		await encoded.cleanup?.();
	} catch (cleanupError) {
		if (failed) {
			throw combineErrors(primary, cleanupError, 'Direct stem input cleanup also failed.');
		}
		throw cleanupError;
	}
	if (failed) throw primary;
}

function assertArchiveResult(
	contract: DirectStemArchiveContract,
	destination: DirectStemArchiveDestination,
	result: SequentialZip32Result<DirectStemArchiveDestination>,
): void {
	if (result.output !== destination
		|| result.byteLength !== contract.archiveByteLength
		|| !sameZip32Layout(result.layout, contract.zip32)) {
		throw new Error('The streamed ZIP archive does not match its exact plan.');
	}
}

async function abortWithPrimary(
	destination: DirectStemArchiveDestination,
	primary: unknown,
): Promise<Error> {
	try {
		await destination.abort(primary);
		return normalizeError(primary);
	} catch (cleanupError) {
		return combineErrors(primary, cleanupError, 'Direct stem archive destination cleanup also failed.');
	}
}

function combineErrors(primary: unknown, cleanup: unknown, message: string): AggregateError {
	const primaryError = normalizeError(primary);
	return new AggregateError([primaryError, normalizeError(cleanup)], `${primaryError.message} ${message}`);
}

function normalizeError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}

function isZip32Layout(value: unknown): value is Zip32Layout {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const layout = value as Readonly<Record<string, unknown>>;
	return layout.eligible === true
		&& ['entryCount', 'localByteLength', 'centralDirectoryByteLength', 'archiveByteLength']
			.every((field) => Number.isSafeInteger(layout[field]) && Number(layout[field]) >= 0);
}

function sameZip32Layout(left: Zip32Layout, right: Zip32Layout): boolean {
	return left.eligible === right.eligible
		&& left.entryCount === right.entryCount
		&& left.localByteLength === right.localByteLength
		&& left.centralDirectoryByteLength === right.centralDirectoryByteLength
		&& left.archiveByteLength === right.archiveByteLength;
}

function emptyPreparation(): DirectStemArchivePreparation {
	return Object.freeze({ cancelled: null, destination: null });
}
