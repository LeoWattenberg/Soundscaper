/* SPDX-License-Identifier: AGPL-3.0-only */
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../common/editor/closed-domain-value.ts';
import { captureRepairSignalV1, checkRepairSignalV1, withRepairPixelFrameLifetimeV1 } from '../common/editor/imaging/pixel-frame-repair-lifetime-v1.ts';
import { prepareFramescaperHdrImageOriginalCurrentV1 } from '../common/editor/timeline-image-model-hdr-current-v1.ts';
import type { OwnedMediaAssetWriter, OwnedMediaAssetPublication, MediaAssetWriteOptions } from '../common/editor/storage/media-asset-write-contract.ts';
import type { StorageRepositoryPort } from '../common/editor/storage/repository-port.ts';
import { cloneFramescaperProject, type FramescaperProject } from './editor-project.ts';
import { applyFramescaperProjectCommand } from './editor-project-commands.ts';
import { assertFramescaperProjectRuntimeProfile } from './editor-project-runtime-profile.ts';
import { FramescaperTimelineImagePublicationRepositoryTimelineImage, type FramescaperTimelineImageProjectCodecTimelineImage } from './editor-timeline-image-publication-timeline-image.ts';
import { preparePublication } from './internal/timeline-image-publication-transition-v1.ts';

const MiB = 1024 * 1024, MAXIMUM = 1024 * MiB;
const CODEC: FramescaperTimelineImageProjectCodecTimelineImage = Object.freeze({ authenticate: assertFramescaperProjectRuntimeProfile,
	clone: cloneFramescaperProject, apply: applyFramescaperProjectCommand });
const TYPED = Object.getPrototypeOf(Uint8Array.prototype) as object;
const BUFFER = Object.getOwnPropertyDescriptor(TYPED, 'buffer')!.get!, LENGTH = Object.getOwnPropertyDescriptor(TYPED, 'byteLength')!.get!;
const OFFSET = Object.getOwnPropertyDescriptor(TYPED, 'byteOffset')!.get!, TAG = Object.getOwnPropertyDescriptor(TYPED, Symbol.toStringTag)!.get!;
const SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!, RESIZABLE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable')!.get!;
const SET = Uint8Array.prototype.set;
type Begin = (key: string, metadata: Readonly<Record<string, unknown>>, options: MediaAssetWriteOptions) => Promise<OwnedMediaAssetWriter>;

/** A separately named Current HDR publisher. Its existing repository owns the
 * exact one-source/one-clip transition and project CAS. Only this fixed policy
 * admits Source5, authenticates native float authority and uses the existing
 * owned media commit/discard capability. The permanent Source1 owner is exact. */
export class FramescaperTimelineImageHdrPublisherCurrentV1 {
	readonly #profile: unknown;
	readonly #repository: FramescaperTimelineImagePublicationRepositoryTimelineImage;
	readonly #begin: Begin;
	constructor(profile: unknown, dependencies: unknown) {
		assertFramescaperProjectRuntimeProfile(profile);
		const input = record(dependencies, 'Frame HDR publication dependencies', ['port', 'store']);
		const port = field(input, 'port', 'Frame HDR publication dependencies') as StorageRepositoryPort;
		this.#begin = method<Begin>(field(input, 'store', 'Frame HDR publication dependencies'), 'beginMediaAssetWrite');
		const database = method<StorageRepositoryPort['database']>(port, 'database');
		const memory = Object.getOwnPropertyDescriptor(port, 'memory');
		if (!memory || !Object.hasOwn(memory, 'value') || !memory.value || typeof memory.value !== 'object') throw new TypeError('Frame HDR publication requires its pinned native backend.');
		this.#profile = profile; this.#repository = new FramescaperTimelineImagePublicationRepositoryTimelineImage(profile,
			{ memory: memory.value as StorageRepositoryPort['memory'], database }, CODEC);
	}

	async publishIfCurrent(value: unknown): Promise<FramescaperProject | null> {
		const signalProperty = typeof value === 'object' && value !== null ? Object.getOwnPropertyDescriptor(value, 'signal') : undefined;
		if (signalProperty && !Object.hasOwn(signalProperty, 'value')) throw new TypeError('Frame HDR publication signal must be own data.');
		const signal = captureRepairSignalV1(signalProperty?.value), check = () => { checkRepairSignalV1(signal); }; check();
		const input = record(value, 'Frame HDR publication', ['expected', 'project', 'bytes', 'signal'], ['expected', 'project', 'bytes']);
		const publication = preparePublication(this.#profile, { expected: field(input, 'expected', 'Frame HDR publication'),
			project: field(input, 'project', 'Frame HDR publication') }, CODEC);
		const planned = prepareFramescaperHdrImageOriginalCurrentV1(publication.source), source = planned.source;
		const binary = captureBytes(field(input, 'bytes', 'Frame HDR publication'), source.assetByteLength);
		if (BigInt(binary.physicalBytes) + BigInt(source.assetByteLength) * 2n + planned.decodeWorkingBytes + BigInt(MiB) > BigInt(MAXIMUM)) {
			throw new RangeError('Frame HDR publication exceeds its 1 GiB physical phase budget.');
		}
		check();
		return withRepairPixelFrameLifetimeV1(async owner => {
			const bytes = owner.bytes(source.assetByteLength); Reflect.apply(SET, bytes, [binary.bytes]);
			const { withFramescaperHdrImageOriginalCurrentV1 } = await import('../common/editor/timeline-image-hdr-original-current-v1.ts'); check();
			await withFramescaperHdrImageOriginalCurrentV1({ source, ...(signal ? { signal } : {}), read: (offset, length) => bytes.slice(offset, offset + length) }, () => undefined); check();
			let writer: Readonly<OwnedMediaAssetWriter> | undefined, committed: Readonly<Pick<OwnedMediaAssetPublication, 'discardIfCurrent'>> | undefined;
			let acknowledged = false;
			try {
				writer = captureWriter(await this.#begin(source.storageKey,
					{ name: source.name, kind: 'timeline-image', encoding: 'framescaper-image-asset-v1', mimeType: source.mimeType },
					{ expectedBytes: source.assetByteLength, expectedSha256: source.contentSha256, ...(signal ? { signal } : {}) })); check();
				const options = signal ? { signal } : {};
				for (let offset = 0; offset < bytes.length; offset += writer.maximumChunkBytes) {
					check(); const held = writer, count = Math.min(writer.maximumChunkBytes, bytes.length - offset);
					await withRepairPixelFrameLifetimeV1(async scope => {
						const chunk = scope.bytes(count); Reflect.apply(SET, chunk, [bytes.subarray(offset, offset + count)]);
						await held.write(chunk, options); check();
					});
				}
				const committedValue = await writer.commitOwned(options);
				// Register the exact cleanup receiver before inspecting any late
				// cancellation. No broad key-based delete is ever substituted.
				committed = Object.freeze({ discardIfCurrent: method<() => Promise<boolean>>(committedValue, 'discardIfCurrent') }); check();
				const result = await this.#repository.publishIfCurrent({ expected: publication.expected, project: publication.project });
				if (result !== null) { acknowledged = true; return cloneFramescaperProject(this.#profile, result); }
				await committed.discardIfCurrent(); committed = undefined; return null;
			} catch (error) {
				const failures: unknown[] = [error];
				if (!acknowledged) {
					try { if (committed) await committed.discardIfCurrent(); else await writer?.abort(); }
					catch (cleanup) { if (!Object.is(error, cleanup)) failures.push(cleanup); }
				}
				if (failures.length > 1) throw new AggregateError(failures, 'Frame HDR publication and owned-body retirement failed.', { cause: error });
				throw error;
			}
		});
	}
}

function captureBytes(value: unknown, expected: number): Readonly<{ bytes: Uint8Array<ArrayBuffer>; physicalBytes: number }> {
	if (typeof value !== 'object' || value === null || Object.getPrototypeOf(value) !== Uint8Array.prototype
		|| Reflect.apply(TAG, value, []) !== 'Uint8Array' || ['buffer', 'byteOffset', 'byteLength', 'length'].some(key => Object.hasOwn(value, key))) {
		throw new TypeError('Frame HDR publication requires unshadowed native bytes.');
	}
	const backing = Reflect.apply(BUFFER, value, []) as ArrayBuffer, length = Number(Reflect.apply(LENGTH, value, []));
	const physicalBytes = Number(Reflect.apply(SIZE, backing, []));
	if (Object.getPrototypeOf(backing) !== ArrayBuffer.prototype || Reflect.apply(RESIZABLE, backing, []) || !physicalBytes || length !== expected) {
		throw new RangeError('Frame HDR publication requires its exact fixed encoded body.');
	}
	return Object.freeze({ bytes: new Uint8Array(backing, Number(Reflect.apply(OFFSET, value, [])), length), physicalBytes });
}
function method<Method extends (...args: never[]) => unknown>(receiver: unknown, key: string): Method {
	if (!receiver || typeof receiver !== 'object') throw new TypeError('Frame HDR publication requires an owned data capability.');
	let owner: object | null = receiver;
	for (let depth = 0; owner && depth < 32; depth++) {
		const descriptor = Object.getOwnPropertyDescriptor(owner, key);
		if (descriptor) {
			if (!Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') throw new TypeError(`Frame HDR publication requires data method ${key}.`);
			const run = descriptor.value as Method; return ((...args: Parameters<Method>) => Reflect.apply(run, receiver, args)) as Method;
		}
		owner = Object.getPrototypeOf(owner) as object | null;
	}
	throw new TypeError(`Frame HDR publication requires ${key}.`);
}
function captureWriter(value: OwnedMediaAssetWriter): Readonly<OwnedMediaAssetWriter> {
	const maximum = value.maximumChunkBytes;
	if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 16 * MiB) throw new RangeError('Frame HDR writer has an invalid bounded chunk size.');
	return Object.freeze({ maximumChunkBytes: Math.min(maximum, MiB), bytesWritten: 0,
		write: method<OwnedMediaAssetWriter['write']>(value, 'write'), commit: method<OwnedMediaAssetWriter['commit']>(value, 'commit'),
		commitOwned: method<OwnedMediaAssetWriter['commitOwned']>(value, 'commitOwned'), abort: method<OwnedMediaAssetWriter['abort']>(value, 'abort') });
}
