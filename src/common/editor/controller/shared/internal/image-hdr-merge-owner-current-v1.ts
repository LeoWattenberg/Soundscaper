/* SPDX-License-Identifier: AGPL-3.0-only */
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../../../closed-domain-value.ts';
import { withImageHdrAlignmentGuideV1, alignImageHdrGuidesV1, type ImageHdrAlignmentGuideV1 } from '../../../imaging/image-hdr-alignment-v1.ts';
import { finalizeImageHdrMergeV1, type ImageHdrAlignedMergePlanV1, type ImageHdrAlignmentV1 } from '../../../imaging/image-hdr-merge-contract-v1.ts';
import { normalizeImageHdrOriginalProvenanceV1 } from '../../../imaging/image-hdr-original-contract-v1.ts';
import { encodeImageHdrOriginalV1 } from '../../../imaging/image-hdr-original-v1.ts';
import { prepareImageHdrRadianceTileV1, withImageHdrRadianceTileV1, type ImageHdrRadianceDiagnosticsV1 } from '../../../imaging/image-hdr-radiance-v1.ts';
import { LinearDevelopOwnerV1 } from '../../../imaging/image-develop-linear-owner-v1.ts';
import { checkRepairSignalV1 } from '../../../imaging/pixel-frame-repair-lifetime-v1.ts';
import type { ImageHdrPixelStagingHandleV1, ImageHdrPixelStagingStoreV1 } from '../../../storage/image-hdr-pixel-staging-v1.ts';
import type { ImageHdrMergeResultCurrentV1 } from '../image-hdr-merge-current-v1.ts';
import type { CapturedImageHdrMergeCurrentV1 } from './image-hdr-merge-capture-current-v1.ts';
import { captureHdrCanonicalFrameCurrentV1, stageHdrCanonicalFrameCurrentV1, readHdrStagedWindowCurrentV1, HDR_MERGE_PHASE_BYTES_CURRENT_V1 } from './image-hdr-merge-source-staging-current-v1.ts';

const MiB = 1024 * 1024, SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;
const TYPED = Object.getPrototypeOf(Uint8Array.prototype) as object, BUFFER = Object.getOwnPropertyDescriptor(TYPED, 'buffer')!.get!;
const FILL = Uint8Array.prototype.fill;

export async function withCapturedImageHdrMergeCurrentV1<Result>(captured: Readonly<CapturedImageHdrMergeCurrentV1>,
	consume: (view: Readonly<ImageHdrMergeResultCurrentV1>) => Result | Promise<Result>): Promise<Result> {
	const check = () => { checkRepairSignalV1(captured.signal); };
	let encoded: Readonly<ImageHdrMergeResultCurrentV1> | undefined, backing: ArrayBuffer | undefined, length = 0;
	let outcome: { value: Result } | { error: unknown };
	try {
		let opened = false;
		await captured.withStaging(async storeValue => {
			if (opened) throw new TypeError('HDR staging may enter its engine scope only once.'); opened = true;
			const store = captureStore(storeValue), staged = await stageSources(captured, store, check); check();
			encoded = await renderMaster(captured, store, staged.handles, staged.aligned, check);
			backing = Reflect.apply(BUFFER, encoded.bytes, []) as ArrayBuffer; length = Number(Reflect.apply(SIZE, backing, []));
		}, { ...(captured.signal ? { signal: captured.signal } : {}) });
		check(); if (!encoded || !backing) throw new TypeError('HDR staging did not complete its captured work.');
		const result = await consume(encoded); check(); outcome = { value: result };
	} catch (error) { outcome = { error }; }
	const failures: unknown[] = 'error' in outcome ? [outcome.error] : [];
	if (encoded && backing) {
		try {
			if (Number(Reflect.apply(SIZE, backing, [])) !== length) throw new TypeError('HDR encoded result detached before physical retirement.');
			const bytes = new Uint8Array(backing);
			try { if (bytesToHex(sha256(bytes)) !== encoded.sha256) throw new RangeError('HDR encoded Original changed during its immutable borrow.'); }
			finally { Reflect.apply(FILL, bytes, [0]); }
		} catch (error) { if (!failures.some(reason => Object.is(reason, error))) failures.push(error); }
	}
	if (failures.length === 1) throw failures[0];
	if (failures.length > 1) throw new AggregateError(failures, 'HDR merge and encoded retirement failed.', { cause: failures[0] });
	if ('value' in outcome) return outcome.value; throw new Error('HDR merge has no admitted outcome.');
}

async function stageSources(captured: Readonly<CapturedImageHdrMergeCurrentV1>, store: Readonly<ImageHdrPixelStagingStoreV1>, check: () => void) {
	const plan = captured.plan, handles: Readonly<ImageHdrPixelStagingHandleV1>[] = [], offsets: Readonly<ImageHdrAlignmentV1>[] = [];
	const owner = new LinearDevelopOwnerV1(32 * MiB, HDR_MERGE_PHASE_BYTES_CURRENT_V1);
	const aligned = await owner.run(async () => {
		let reference: Readonly<ImageHdrAlignmentGuideV1> | undefined;
		const order = [plan.referenceIndex, ...plan.inputs.map((_, index) => index).filter(index => index !== plan.referenceIndex)];
		for (const index of order) {
			check();
			await captured.withCanonicalFrame(index, async value => {
				check(); const source = captureHdrCanonicalFrameCurrentV1(value, plan.inputs[index]!.descriptor,
					captured.facts.inputs[index]!.original.byteLength, reference?.pixels.byteLength ?? 0, captured.signal);
				handles[index] = await stageHdrCanonicalFrameCurrentV1(store, source.frame, source.physicalBytes, source.check);
				if (plan.alignment === 'none' || index === plan.referenceIndex) offsets[index] = Object.freeze({ x: 0, y: 0, error: 0, support: 0 });
				if (plan.alignment === 'ward-mtb-v1') await withImageHdrAlignmentGuideV1(source.frame, async guide => {
					if (index === plan.referenceIndex) {
						const pixels = owner.bytes(guide.pixels.byteLength); pixels.set(guide.pixels);
						reference = Object.freeze({ width: guide.width, height: guide.height, pixels });
					} else {
						if (!reference) throw new Error('HDR registration requires its captured reference guide.');
						offsets[index] = await alignImageHdrGuidesV1(reference, guide, { ...(captured.signal ? { signal: captured.signal } : {}) });
					}
				}, captured.signal);
				source.check();
			}, captured.signal); check();
		}
		return finalizeImageHdrMergeV1(plan, offsets);
	});
	return Object.freeze({ handles: Object.freeze(handles), aligned });
}

async function renderMaster(captured: Readonly<CapturedImageHdrMergeCurrentV1>, store: Readonly<ImageHdrPixelStagingStoreV1>,
	handles: readonly Readonly<ImageHdrPixelStagingHandleV1>[], aligned: Readonly<ImageHdrAlignedMergePlanV1>, check: () => void): Promise<Readonly<ImageHdrMergeResultCurrentV1>> {
	const provenance = normalizeImageHdrOriginalProvenanceV1({ ...captured.facts, output: aligned.output,
		inputs: captured.facts.inputs.map((input, index) => ({ ...input, offset: { x: aligned.offsets[index]!.x, y: aligned.offsets[index]!.y },
			alignmentError: aligned.offsets[index]!.error, alignmentSupport: aligned.offsets[index]!.support })) });
	const byteLength = aligned.output.width * aligned.output.height * 16;
	if (byteLength + 32 * MiB + aligned.maximumTileWorkingBytes > HDR_MERGE_PHASE_BYTES_CURRENT_V1) throw new RangeError('HDR master and tile phase exceeds its working budget.');
	const owner = new LinearDevelopOwnerV1(32 * MiB, HDR_MERGE_PHASE_BYTES_CURRENT_V1);
	let encoded: Readonly<ImageHdrMergeResultCurrentV1> | undefined;
	try { return await owner.run(async () => {
		const pixels = owner.floats(byteLength / 4), diagnostics = { motionPixels: 0, inconsistentPixels: 0, referenceClippedPixels: 0, unresolvedPixels: 0, fallbackChannels: 0 };
		for (let y = 0; y < aligned.output.height; y += 256) for (let x = 0; x < aligned.output.width; x += 256) {
			check(); const tile = prepareImageHdrRadianceTileV1(aligned, { x, y, width: Math.min(256, aligned.output.width - x), height: Math.min(256, aligned.output.height - y) });
			const windowsOwner = new LinearDevelopOwnerV1(byteLength + 32 * MiB + tile.maximumWorkingBytes, HDR_MERGE_PHASE_BYTES_CURRENT_V1);
			await windowsOwner.run(async () => {
				const frames = [];
				for (let index = 0; index < tile.windows.length; index++) frames.push(await readHdrStagedWindowCurrentV1(store, handles[index]!, aligned.inputs[index]!.descriptor, tile.windows[index]!, windowsOwner, check));
				await withImageHdrRadianceTileV1(tile, frames, view => {
					for (let row = 0; row < tile.descriptor.height; row++) pixels.set(view.frame.pixels.subarray(row * tile.descriptor.width * 4, (row + 1) * tile.descriptor.width * 4), ((y + row) * aligned.output.width + x) * 4);
					addDiagnostics(diagnostics, view.diagnostics);
				}, captured.signal);
			}); check();
		}
		const bytes = await encodeImageHdrOriginalV1({ descriptor: aligned.descriptor, pixels }, provenance, { ...(captured.signal ? { signal: captured.signal } : {}) });
		encoded = Object.freeze({ bytes, byteLength: bytes.byteLength, sha256: bytesToHex(sha256(bytes)), provenance, diagnostics: Object.freeze(diagnostics) });
		return encoded;
	}); } catch (error) {
		// Encoding has its own output allocation. If retiring the master fails,
		// that successful codec output must still retire without being published.
		if (encoded) {
			let retirement: { error: unknown } | undefined;
			try { Reflect.apply(FILL, new Uint8Array(Reflect.apply(BUFFER, encoded.bytes, []) as ArrayBuffer), [0]); }
			catch (cleanup) { retirement = { error: cleanup }; }
			if (retirement) throw new AggregateError([error, retirement.error], 'HDR master and unpublished encoding retirement failed.', { cause: error });
		}
		throw error;
	}
}

function addDiagnostics(target: { -readonly [Key in keyof ImageHdrRadianceDiagnosticsV1]: number }, value: Readonly<ImageHdrRadianceDiagnosticsV1>) {
	target.motionPixels += value.motionPixels; target.inconsistentPixels += value.inconsistentPixels;
	target.referenceClippedPixels += value.referenceClippedPixels; target.unresolvedPixels += value.unresolvedPixels; target.fallbackChannels += value.fallbackChannels;
}
function captureStore(value: unknown): Readonly<ImageHdrPixelStagingStoreV1> {
	const input = record(value, 'HDR scoped staging', ['write', 'withRead']), write = field(input, 'write', 'HDR scoped staging'), read = field(input, 'withRead', 'HDR scoped staging');
	if (typeof write !== 'function' || typeof read !== 'function') throw new TypeError('HDR merging requires complete scoped staging.');
	return Object.freeze({ write: (...args: Parameters<ImageHdrPixelStagingStoreV1['write']>) => Reflect.apply(write, value, args) as ReturnType<ImageHdrPixelStagingStoreV1['write']>,
		withRead: <Result>(handle: Readonly<ImageHdrPixelStagingHandleV1>, offset: number, length: number, consume: (bytes: Uint8Array<ArrayBuffer>) => Result | Promise<Result>) =>
			Reflect.apply(read, value, [handle, offset, length, consume]) as Promise<Result> });
}
