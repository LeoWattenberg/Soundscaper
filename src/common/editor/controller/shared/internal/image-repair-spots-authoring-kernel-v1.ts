/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../../../closed-domain-value.ts';
import { PHOTO_DEVELOP_FULL_RESOLUTION_LIMITS_V1 } from '../../../photo-library-develop-full-resolution-port-v1.ts';
import type { ImageDevelopStateCurrentV1 } from '../../../imaging/image-develop-state-current-v1.ts';
import type { ImageDevelopStateV3 } from '../../../imaging/image-develop-state-v3.ts';
import { normalizeImageDevelopRepairSpotsV1, type ImageDevelopRepairPointV1, type ImageDevelopRepairSpotV1,
	type ImageDevelopRepairSpotsV1 } from '../../../imaging/image-develop-repair-spots-v1.ts';
import { replaceImageDevelopRepairSpotsV1 } from '../../../imaging/image-develop-repair-commands-v1.ts';
import { planImageDevelopRepairSpotsV1 } from '../../../imaging/image-develop-repair-plan-v1.ts';
import { withRepairSpotsPixelFrameV1 } from '../../../imaging/pixel-frame-repair-spots-v1.ts';
import { admitPixelFrameV1 } from '../../../imaging/pixel-frame-admission-v1.ts';
import { readImageRepairSpotsOriginalMetadataCurrentV1, validateImageRepairSpotsCurrentV1 } from '../../../imaging/image-repair-spots-native-current-v1.ts';
import { detachPhotoLibraryDevelopSettingsV3 } from '../photo-library-develop-command-v3.ts';

import type { PixelFrameV1 } from '../../../imaging/pixel-frame-contract-v1.ts';

export type WithImageRepairSpotsOriginalViewV1<Original> = <Result>(consume: (view: Original) => Result | Promise<Result>, options?: Readonly<{ signal?: AbortSignal }>) => Promise<Result>;
export interface ImageRepairSpotsAuthoringKernelOptionsV1<Original> {
	readonly withOriginalFrame: WithImageRepairSpotsOriginalViewV1<Original>;
	readonly frame: (view: Original) => Readonly<PixelFrameV1>;
	readonly develop: ImageDevelopStateCurrentV1;
	readonly isCurrent: () => boolean;
	readonly signal?: AbortSignal;
}
export interface ImageRepairSpotsAuthoringSnapshotV1 {
	readonly repairs: Readonly<ImageDevelopRepairSpotsV1>;
	readonly selectedId: string | null;
	readonly width: number;
	readonly height: number;
	readonly ready: boolean;
	readonly busy: boolean;
	readonly closed: boolean;
}
const CHECK = AbortSignal.prototype.throwIfAborted, ABORT = AbortController.prototype.abort;
const ADD = EventTarget.prototype.addEventListener, REMOVE = EventTarget.prototype.removeEventListener;
const ABORTED = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!;
const REASON = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'reason')!.get!;

/** Local scalar repairs borrow one selected authenticated Original at a time.
 * No preview copy, catalog writer or retained pixel body is created. */
export class ImageRepairSpotsAuthoringKernelV1<Original> {
	readonly #read: WithImageRepairSpotsOriginalViewV1<Original>;
	readonly #frame: (view: Original) => Readonly<PixelFrameV1>;
	readonly #develop: Readonly<ImageDevelopStateCurrentV1>;
	readonly #current: () => boolean;
	readonly #currentNative: boolean;
	readonly #stop = new AbortController();
	readonly #external: AbortSignal | undefined;
	readonly #cancelled: () => void;
	#view: Readonly<ImageRepairSpotsAuthoringSnapshotV1>;
	#listener: ((view: Readonly<ImageRepairSpotsAuthoringSnapshotV1>) => void) | null = null;
	#pending: Promise<unknown> | null = null;
	#closing: Promise<void> | null = null;
	#editing = false;
	#gesture: Readonly<{ repairs: Readonly<ImageDevelopRepairSpotsV1>; id: string; handle: 'target' | 'source' }> | null = null;

	constructor(options: Readonly<ImageRepairSpotsAuthoringKernelOptionsV1<Original>>, profile: 'legacy-byte' | 'current-native' = 'legacy-byte') {
		const signalData = Object.getOwnPropertyDescriptor(options, 'signal');
		this.#external = captureImageRepairSpotsSignalV1(signalData && Object.hasOwn(signalData, 'value') ? signalData.value : undefined);
		if (profile !== 'legacy-byte' && profile !== 'current-native') throw new TypeError('Unknown repair authoring profile.');
		this.#currentNative = profile === 'current-native';
		const input = record(options, 'repair authoring options', ['withOriginalFrame', 'frame', 'develop', 'isCurrent', 'signal'], ['withOriginalFrame', 'frame', 'develop', 'isCurrent']);
		if ((Object.hasOwn(input, 'signal') ? field(input, 'signal', 'repair authoring options') : undefined) !== this.#external) {
			throw new TypeError('Repair authoring cancellation changed during admission.');
		}
		const current = field(input, 'isCurrent', 'repair authoring options'), read = field(input, 'withOriginalFrame', 'repair authoring options'), frame = field(input, 'frame', 'repair authoring options');
		if (typeof current !== 'function') throw new TypeError('Repair authoring requires a current entry check.');
		if (typeof read !== 'function' || typeof frame !== 'function') throw new TypeError('Repair authoring requires the selected Original capability.');
		this.#current = () => Reflect.apply(current, options, []) === true;
		this.#read = <Result>(consume: (view: Original) => Result | Promise<Result>, request?: Readonly<{ signal?: AbortSignal }>) =>
			Reflect.apply(read, options, [consume, request]) as Promise<Result>;
		this.#frame = view => Reflect.apply(frame, options, [view]) as Readonly<PixelFrameV1>;
		this.#develop = detachPhotoLibraryDevelopSettingsV3(field(input, 'develop', 'repair authoring options'));
		const repairs = this.#develop.processVersion === 3 ? this.#develop.repairs : normalizeImageDevelopRepairSpotsV1({ schemaVersion: 1, spots: [] });
		this.#view = Object.freeze({ repairs, selectedId: null, width: 0, height: 0, ready: false, busy: false, closed: false });
		this.#cancelled = () => { Reflect.apply(ABORT, this.#stop, [Reflect.apply(REASON, this.#external!, [])]); };
		if (this.#external !== undefined) {
			Reflect.apply(CHECK, this.#external, []); Reflect.apply(ADD, this.#external, ['abort', this.#cancelled, { once: true }]);
			if (Reflect.apply(ABORTED, this.#external, [])) this.#cancelled();
		}
	}
	snapshot(): Readonly<ImageRepairSpotsAuthoringSnapshotV1> { return this.#view; }
	subscribe(listener: (snapshot: Readonly<ImageRepairSpotsAuthoringSnapshotV1>) => void): () => void {
		if (typeof listener !== 'function') throw new TypeError('Repair authoring requires a scalar listener.');
		if (this.#view.closed) throw new Error('Repair authoring is closed.');
		this.#listener = listener; this.#notify(); return () => { if (this.#listener === listener) this.#listener = null; };
	}
	open(): Promise<void> {
		return this.#run(() => { if (this.#view.ready) throw new Error('Repair authoring is already open.'); }, async () => {
			const dimensions = await this.#borrow(view => {
				const metadata = this.#metadata(view); planImageDevelopRepairSpotsV1(this.#view.repairs, metadata.width, metadata.height);
				return metadata;
			});
			this.#check(); this.#publish({ width: dimensions.width, height: dimensions.height, ready: true });
		});
	}
	add(value: ImageDevelopRepairSpotV1): void {
		this.#change(() => { const spot = normalizedSpot(value); return { repairs: this.#repairs([...this.#view.repairs.spots, spot]), selectedId: spot.id }; });
	}
	update(value: ImageDevelopRepairSpotV1): void {
		this.#change(() => { const spot = normalizedSpot(value); this.#find(spot.id);
			return { repairs: this.#repairs(this.#view.repairs.spots.map(current => current.id === spot.id ? spot : current)) }; });
	}
	remove(value: string): void {
		this.#change(() => { const id = stableId(value); this.#find(id); this.#gesture = null;
			return { repairs: this.#repairs(this.#view.repairs.spots.filter(spot => spot.id !== id)), selectedId: this.#view.selectedId === id ? null : this.#view.selectedId }; });
	}
	move(value: string, direction: 'up' | 'down'): void {
		this.#change(() => {
			const id = stableId(value); this.#find(id);
			if (direction !== 'up' && direction !== 'down') throw new TypeError('Repair order requires up or down.');
			const spots = [...this.#view.repairs.spots], index = spots.findIndex(spot => spot.id === id), next = index + (direction === 'up' ? -1 : 1);
			if (next >= 0 && next < spots.length) [spots[index], spots[next]] = [spots[next]!, spots[index]!];
			this.#gesture = null; return { repairs: this.#repairs(spots) };
		});
	}
	select(value: string | null): void {
		this.#change(() => { const id = value === null ? null : stableId(value); if (id !== null) this.#find(id); return { selectedId: id }; });
	}
	beginMove(value: string, handle: 'target' | 'source'): void {
		this.#change(() => {
			const id = stableId(value); this.#find(id);
			if (handle !== 'target' && handle !== 'source') throw new TypeError('Repair movement requires target or source.');
			if (this.#gesture) throw new Error('A repair movement is already active.');
			this.#gesture = Object.freeze({ id, handle, repairs: this.#view.repairs }); return { selectedId: id };
		});
	}
	previewMove(value: Readonly<ImageDevelopRepairPointV1>): void {
		this.#change(() => {
			const gesture = this.#gesture; if (!gesture) throw new Error('Repair movement requires an active handle.');
			const point = record(value, 'repair movement', ['x', 'y']), current = this.#find(gesture.id);
			const spot = normalizedSpot({ ...current, [gesture.handle]: { x: field(point, 'x', 'repair movement'), y: field(point, 'y', 'repair movement') } });
			return { repairs: this.#repairs(this.#view.repairs.spots.map(candidate => candidate.id === spot.id ? spot : candidate)) };
		});
	}
	commitMove(): void { this.#change(() => { this.#gesture = null; return {}; }); }
	cancelMove(): void { this.#change(() => { const gesture = this.#gesture; this.#gesture = null; return gesture ? { repairs: gesture.repairs } : {}; }); }
	withOriginalFrame<Result>(consume: (view: Readonly<Original>) => Result | Promise<Result>): Promise<Result> {
		return this.#run(() => { this.#ready(); if (typeof consume !== 'function') throw new TypeError('Original display requires a joined consumer.'); return consume; }, callback => this.#borrow(callback));
	}
	apply(): Promise<Readonly<ImageDevelopStateV3>> {
		return this.#run(() => {
			this.#ready(); if (this.#gesture) throw new Error('Finish the current repair movement before applying.');
			const develop = replaceImageDevelopRepairSpotsV1(this.#develop, this.#view.repairs);
			planImageDevelopRepairSpotsV1(develop.repairs, this.#view.width, this.#view.height); return develop;
		}, async develop => {
			await this.#borrow(view => {
				const metadata = this.#metadata(view); planImageDevelopRepairSpotsV1(develop.repairs, metadata.width, metadata.height);
				if (this.#currentNative) return validateImageRepairSpotsCurrentV1(this.#frame(view), develop.repairs, this.#stop.signal);
				return withRepairSpotsPixelFrameV1({ frame: this.#frame(view), repairs: develop.repairs, signal: this.#stop.signal }, () => { this.#check(); },
					{ limits: PHOTO_DEVELOP_FULL_RESOLUTION_LIMITS_V1.source });
			});
			this.#check(); return develop;
		});
	}
	cancelAndJoin(): Promise<void> {
		if (this.#closing) return this.#closing;
		let resolve!: () => void, reject!: (reason: unknown) => void;
		this.#closing = new Promise<void>((accept, refuse) => { resolve = accept; reject = refuse; });
		this.#listener = null; this.#gesture = null; this.#view = Object.freeze({ ...this.#view, ready: false, closed: true });
		Reflect.apply(ABORT, this.#stop, []);
		const cleanup = async () => {
			await this.#pending?.catch(() => undefined);
			if (this.#external !== undefined) Reflect.apply(REMOVE, this.#external, ['abort', this.#cancelled]);
			this.#view = Object.freeze({ ...this.#view, busy: false });
		};
		void cleanup().then(resolve, reject); return this.#closing;
	}

	#metadata(view: Readonly<Original>): Readonly<{ width: number; height: number }> {
		const frame = this.#frame(view);
		const metadata = this.#currentNative ? readImageRepairSpotsOriginalMetadataCurrentV1(frame) : (() => {
			const admitted = admitPixelFrameV1(field(frame, 'descriptor', 'repair Original frame'), { limits: PHOTO_DEVELOP_FULL_RESOLUTION_LIMITS_V1.source });
			if (admitted.descriptor.sampleFormat !== 'unorm8') throw new TypeError('Repair authoring requires the native UNORM8 Original.');
			return admitted.descriptor;
		})();
		const { width, height } = metadata;
		if (this.#view.ready && (width !== this.#view.width || height !== this.#view.height)) throw new Error('Repair Original dimensions changed.');
		return Object.freeze({ width, height });
	}
	async #borrow<Result>(consume: (view: Readonly<Original>) => Result | Promise<Result>): Promise<Result> {
		let child: Promise<Result> | undefined, active = true, delivered = false;
		const failures: unknown[] = [], repeated = new TypeError('The Original owner delivered more than one repair frame.');
		const fail = (error: unknown) => { if (!failures.some(value => Object.is(value, error))) failures.push(error); };
		try {
			await this.#read(view => {
				if (!active || delivered) { fail(repeated); throw repeated; } delivered = true;
				let resolve!: (value: Result | PromiseLike<Result>) => void, reject!: (reason: unknown) => void;
				child = new Promise<Result>((accept, refuse) => { resolve = accept; reject = refuse; }); void child.catch(fail);
				try {
					this.#check(); this.#metadata(view);
					const result = Reflect.apply(consume, undefined, [view]) as Result | Promise<Result>;
					resolve(Promise.resolve(result).then(value => { this.#check(); return value; }));
				} catch (error) { try { this.#check(); } catch (reason) { reject(reason); return child; } reject(error); }
				return child;
			}, { signal: this.#stop.signal });
		} catch (error) { fail(error); }
		if (child) await child.catch(fail); active = false;
		if (!delivered && failures.length === 0) fail(new TypeError('The Original owner did not deliver a repair frame.'));
		if (failures.length === 1) throw failures[0];
		if (failures.length > 1) throw new AggregateError(failures, 'Repair Original borrowing failed.', { cause: failures[0] });
		this.#check(); return await child!;
	}
	#repairs(spots: readonly Readonly<ImageDevelopRepairSpotV1>[]): Readonly<ImageDevelopRepairSpotsV1> {
		const repairs = normalizeImageDevelopRepairSpotsV1({ schemaVersion: 1, spots });
		planImageDevelopRepairSpotsV1(repairs, this.#view.width, this.#view.height); return repairs;
	}
	#find(id: string): Readonly<ImageDevelopRepairSpotV1> {
		const spot = this.#view.repairs.spots.find(candidate => candidate.id === id); if (!spot) throw new Error('The selected repair spot is missing.'); return spot;
	}
	#ready(): void { if (!this.#view.ready) throw new Error('Repair authoring requires an authenticated Original.'); }
	#check(): void {
		Reflect.apply(CHECK, this.#stop.signal, []);
		try { const current = this.#current(); Reflect.apply(CHECK, this.#stop.signal, []); if (!current) throw new Error('Repair authoring entry is stale.'); }
		catch (error) { Reflect.apply(CHECK, this.#stop.signal, []); throw error; }
	}
	#change(admit: () => Partial<ImageRepairSpotsAuthoringSnapshotV1>): void {
		if (this.#view.closed || this.#pending || this.#editing) throw new Error('Repair authoring cannot edit a retired or busy draft.');
		this.#editing = true; const gesture = this.#gesture;
		try { this.#check(); this.#ready(); const update = admit(); this.#check(); this.#publish(update); }
		catch (error) { if (!this.#view.closed) this.#gesture = gesture; throw error; }
		finally { this.#editing = false; }
	}
	#publish(update: Partial<ImageRepairSpotsAuthoringSnapshotV1>): void { this.#view = Object.freeze({ ...this.#view, ...update }); this.#notify(); }
	#notify(): void { try { this.#listener?.(this.#view); } catch { /* Observers cannot strand Original retirement. */ } }
	#run<Input, Result>(admit: () => Input, operation: (input: Input) => Promise<Result>): Promise<Result> {
		if (this.#view.closed || this.#pending || this.#editing) return Promise.reject(new Error('Repair authoring is retired or already has an Original demand.'));
		let resolve!: (value: Result | PromiseLike<Result>) => void, reject!: (reason: unknown) => void;
		const work = new Promise<Result>((accept, refuse) => { resolve = accept; reject = refuse; }); this.#pending = work;
		const settle = () => { if (this.#pending === work) { this.#pending = null; this.#publish({ busy: false }); } };
		void work.then(settle, settle); this.#publish({ busy: true });
		try { this.#check(); const input = admit(); this.#check(); resolve(operation(input)); }
		catch (error) { try { Reflect.apply(CHECK, this.#stop.signal, []); } catch (reason) { reject(reason); return work; } reject(error); }
		return work;
	}
}
function normalizedSpot(value: unknown): Readonly<ImageDevelopRepairSpotV1> {
	return normalizeImageDevelopRepairSpotsV1({ schemaVersion: 1, spots: [value] }).spots[0]!;
}
function stableId(value: unknown): string {
	if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)) throw new TypeError('Repair authoring requires a stable Photo/spot ID.'); return value;
}
export function captureImageRepairSpotsSignalV1(value: unknown): AbortSignal | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== 'object' || value === null) throw new TypeError('Repair authoring requires native cancellation.');
	Reflect.apply(CHECK, value, []);
	if (Object.getPrototypeOf(value) !== AbortSignal.prototype || ['aborted', 'reason', 'throwIfAborted', 'addEventListener', 'removeEventListener'].some(key => Object.hasOwn(value, key))) {
		throw new TypeError('Repair cancellation may not shadow native behavior.');
	}
	return value as AbortSignal;
}
