/* SPDX-License-Identifier: AGPL-3.0-only */
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../common/editor/closed-domain-value.ts';
import { normalizeVideoEffectsV2 } from '../common/editor/video-effects-v2.ts';
import { normalizeCubeLutProfileEffectV1 } from '../common/editor/video-cube-lut-profile-v1.ts';
import { parseCubeLutV1, VIDEO_COLOR_LIMITS_V1, type VideoCubeLutReferenceV1 } from '../common/editor/video-color-cube-lut-v27.ts';
import { withCubeLutResourceV1 } from '../common/editor/imaging/cube-lut-resource-v1.ts';
import { createFramescaperCubeLutSourceFinishing } from './cube-lut-source-finishing.ts';
import type { MediaAssetWriter, MediaAssetWriteOptions } from '../common/editor/storage/media-asset-write-contract.ts';
import type { BlobLike } from '../common/editor/storage/media-records.ts';
import type { CubeLutEffectBindingV1, CubeLutEffectPortV1 } from '../common/editor/controller/clip-video/cube-lut-effect-port-v1.ts';

interface Owner { readonly project: unknown; readonly actions: { readonly edit: { commit(command: unknown): unknown } }; }
interface Store {
	getMediaAssetMetadata(key: string): PromiseLike<unknown | null>;
	loadMediaAsset(key: string, options?: Readonly<{ signal?: AbortSignal }>): PromiseLike<BlobLike | null>;
	beginMediaAssetWrite(key: string, metadata: Readonly<Record<string, unknown>>, options: MediaAssetWriteOptions): PromiseLike<MediaAssetWriter>;
}
interface Target { readonly projectId: unknown; readonly revision: unknown; readonly effects: string; readonly effect: ReturnType<typeof normalizeCubeLutProfileEffectV1>; }
const CHECK = AbortSignal.prototype.throwIfAborted, ANY = AbortSignal.any, ABORT = AbortController.prototype.abort;
const SIZE = Object.getOwnPropertyDescriptor(Blob.prototype, 'size')!.get!, READ = Blob.prototype.arrayBuffer;
const NativeBytes = Uint8Array, FILL = NativeBytes.prototype.fill;
const BUFFER_SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;

/** Append-only immutable bodies. A failed recipe commit leaves a newly published
 * body under the media owner's pending retention/GC authority; it never grants
 * this action deletion of a digest shared by another project or lost ACK. */
export function createFramescaperCubeLutEffectActionsFinishing(options: Readonly<{ owner: Owner; store: Store }>): Readonly<CubeLutEffectPortV1 & { close(): Promise<void> }> {
	const owner = options.owner, store = options.store, edit = owner.actions.edit;
	const commit = method(edit, 'commit'), metadata = method(store, 'getMediaAssetMetadata'), begin = method(store, 'beginMediaAssetWrite');
	const source = createFramescaperCubeLutSourceFinishing(store), bindings = new WeakMap<object, Target>(), stop = new AbortController();
	let sealed = false, busy = false, drain: Promise<void> | undefined, closing: Promise<void> | undefined;
	const cleanup: { failed: boolean; value?: unknown } = { failed: false };
	const actions = Object.freeze({
		capture(clipId: string, effectId: string, expectedEffects?: readonly unknown[]) {
			if (sealed || typeof clipId !== 'string' || typeof effectId !== 'string') return null;
			const target = readTarget(clipId, effectId); if (!target) return null;
			if (expectedEffects !== undefined && target.effects !== JSON.stringify(normalizeVideoEffectsV2(expectedEffects))) return null;
			if (sealed) return null;
			const binding = Object.freeze({ clipId, effectId }); bindings.set(binding, target); return binding;
		},
		isCurrent(binding: Readonly<CubeLutEffectBindingV1>) {
			const target = bindings.get(binding); if (sealed || !target) return false;
			const next = readTarget(binding.clipId, binding.effectId);
			return !sealed && next !== null && target.projectId === next.projectId && target.revision === next.revision && target.effects === next.effects;
		},
		importFile(binding: Readonly<CubeLutEffectBindingV1>, file: Blob, optionsValue: unknown = {}) {
			return start(async () => {
				const descriptor = optionsValue !== null && typeof optionsValue === 'object' ? Object.getOwnPropertyDescriptor(optionsValue, 'signal') : undefined;
				const signalValue = descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value as unknown : undefined;
				if (signalValue !== undefined) check(signalValue as AbortSignal);
				const signal = signalValue === undefined ? stop.signal : Reflect.apply(ANY, AbortSignal, [[signalValue, stop.signal]]) as AbortSignal;
				const failure = { captured: false };
				try { check(signal);
					const input = record(optionsValue, 'Frame LUT import options', ['signal'], []);
					const admittedSignal = Object.hasOwn(input, 'signal') ? field(input, 'signal', 'Frame LUT import options') : undefined;
					check(signal); if (admittedSignal !== signalValue) throw new TypeError('The Frame LUT signal changed during admission.');
					check(signal); assertBinding(binding);
					const size = Number(Reflect.apply(SIZE, file, []));
					if (size < 1 || size > VIDEO_COLOR_LIMITS_V1.maximumCubeLutBytes) throw new RangeError('Frame LUT file exceeds the owning byte bound.');
					const buffer = await Reflect.apply(READ, file, []) as ArrayBuffer, bytes = new NativeBytes(buffer);
					try {
						check(signal); assertBinding(binding);
						if (bytes.byteLength !== size) throw new RangeError('Frame LUT file length changed.');
						const reference = referenceFor(bytes);
						await withCubeLutResourceV1({ reference, bytes, signal }, () => undefined);
						check(signal); assertBinding(binding);
						const existing = await Reflect.apply(metadata, store, [reference.storageKey]) as unknown;
						check(signal); assertBinding(binding);
						if (existing === null) await write(reference, bytes, signal, failure);
						await source.withBytes(reference, () => undefined, { signal });
						check(signal); assertBinding(binding);
						const target = bindings.get(binding)!;
						if (JSON.stringify(target.effect.params.lut) !== JSON.stringify(reference)) await publish(binding, reference);
						return reference;
					} finally { if (Reflect.apply(BUFFER_SIZE, buffer, []) !== 0) Reflect.apply(FILL, bytes, [0]); }
				} catch (error) { if (!cleanup.failed && !failure.captured) check(signal); throw error; }
			});
		},
		clear(binding: Readonly<CubeLutEffectBindingV1>) {
			return start(async () => { assertBinding(binding); if (bindings.get(binding)!.effect.params.lut !== null) await publish(binding, null); });
		},
		close() {
			if (closing) return closing; sealed = true;
			closing = (drain ?? Promise.resolve()).then(async () => { await source.close(); if (cleanup.failed) throw cleanup.value; });
			void closing.catch(() => undefined); Reflect.apply(ABORT, stop, []); return closing;
		},
	});
	return actions;
	function start<T>(work: () => Promise<T>): Promise<T> {
		if (cleanup.failed) return Promise.reject(cleanup.value);
		if (sealed) return Promise.reject(new Error('The Frame LUT action is closed.'));
		if (busy) return Promise.reject(new Error('The Frame LUT action cannot overlap active imports.'));
		busy = true; let complete!: () => void; drain = new Promise<void>(resolve => { complete = resolve; });
		const result = work(); void result.then(settle, settle); return result;
		function settle() { busy = false; drain = undefined; complete(); }
	}
	function assertBinding(binding: Readonly<CubeLutEffectBindingV1>) {
		if (!actions.isCurrent(binding)) throw new Error('The Frame LUT target changed or was retired.');
	}
	function readTarget(clipId: string, effectId: string): Target | null {
		const project = owner.project as Readonly<Record<string, unknown>>;
		if (!project || !Array.isArray(project.clips)) return null;
		const clip = (project.clips as readonly Readonly<Record<string, unknown>>[]).find(value => value.id === clipId);
		if (clip?.kind !== 'video') return null;
		const effects = normalizeVideoEffectsV2(clip.videoEffects), effect = effects.find(value => value.id === effectId);
		if (effect?.type !== 'cube-lut-profile-v1') return null;
		return { projectId: project.id, revision: project.revision, effects: JSON.stringify(effects), effect: normalizeCubeLutProfileEffectV1(effect) };
	}
	async function publish(binding: Readonly<CubeLutEffectBindingV1>, reference: Readonly<VideoCubeLutReferenceV1> | null) {
		assertBinding(binding);
		await Reflect.apply(commit, edit, [{ type: 'video-effect/update', clipId: binding.clipId, effectId: binding.effectId, changes: { params: { lut: reference } } }]);
		const next = readTarget(binding.clipId, binding.effectId);
		if (next === null || next.projectId !== bindings.get(binding)!.projectId
			|| JSON.stringify(next.effect.params.lut) !== JSON.stringify(reference)) throw new Error('Frame LUT recipe publication was not acknowledged.');
	}
	async function write(reference: Readonly<VideoCubeLutReferenceV1>, bytes: Uint8Array<ArrayBuffer>, signal: AbortSignal, failure: { captured: boolean }) {
		const writer = await Reflect.apply(begin, store, [reference.storageKey, { name: '.cube LUT', mimeType: 'text/plain' },
			{ expectedBytes: reference.byteLength, expectedSha256: reference.sha256, signal }]) as MediaAssetWriter;
		let abort: ReturnType<typeof method> | undefined;
		try {
			abort = method(writer, 'abort');
			const write = method(writer, 'write'), finish = method(writer, 'commit');
			const maximum = writer.maximumChunkBytes;
			if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 4 * 1024 * 1024) throw new RangeError('Frame LUT writer chunk bound is invalid.');
			for (let offset = 0; offset < bytes.byteLength; offset += maximum) {
				check(signal); await Reflect.apply(write, writer, [new NativeBytes(bytes.buffer, bytes.byteOffset + offset, Math.min(maximum, bytes.byteLength - offset)), { signal }]);
			}
			check(signal); await Reflect.apply(finish, writer, [{ signal }]);
		} catch (error) {
			let primary = error; try { check(signal); } catch (reason) { primary = reason; }
			failure.captured = true;
			if (abort === undefined) { cleanup.failed = true; cleanup.value = error; sealed = true;
				if (!Object.is(primary, error)) throw new AggregateError([primary, error], 'Frame LUT cancellation and abort admission both failed.', { cause: error });
				throw error; }
			try { await Reflect.apply(abort, writer, []); }
			catch (failure) { cleanup.failed = true; cleanup.value = failure; sealed = true;
				if (!Object.is(primary, failure)) throw new AggregateError([primary, failure], 'Frame LUT write and retirement both failed.', { cause: failure }); }
			throw primary;
		}
	}
}
function check(signal: AbortSignal): void { Reflect.apply(CHECK, signal, []); }
function referenceFor(bytes: Uint8Array): Readonly<VideoCubeLutReferenceV1> {
	if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) throw new TypeError('Frame LUT UTF8 may not start with a BOM.');
	const parsed = parseCubeLutV1(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes));
	return Object.freeze({ storageKey: `lut-sha256:${parsed.sha256}`, sha256: parsed.sha256, byteLength: parsed.byteLength,
		size: parsed.size, domainMin: parsed.domainMin, domainMax: parsed.domainMax });
}
function method(value: object, key: string): (...args: unknown[]) => unknown {
	let owner: object | null = value;
	for (let depth = 0; owner && depth < 32; depth++) {
		const descriptor = Object.getOwnPropertyDescriptor(owner, key);
		if (descriptor) { if (typeof descriptor.value !== 'function' || !Object.hasOwn(descriptor, 'value')) throw new TypeError('Frame LUT ports require captured data methods.');
			return descriptor.value as (...args: unknown[]) => unknown; }
		owner = Object.getPrototypeOf(owner) as object | null;
	}
	throw new TypeError('Frame LUT resource port is incomplete.');
}
