/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../../closed-domain-value.ts';
import { appendBrushMaskStrokeV1, createBrushMaskHistoryV1, undoBrushMaskHistoryV1, redoBrushMaskHistoryV1, withBrushMaskPlaneV1,
	type BrushMaskHistoryV1, type BrushMaskStrokeV1 } from '../../imaging/brush-mask-plane-v1.ts';
import { BRUSH_MASK_RESOURCE_LIMITS_V1, normalizeBrushMaskResourceReferenceV1, withBrushMaskResourceV1, withPreparedBrushMaskResourceV1,
	type BrushMaskResourceReferenceV1 } from '../../imaging/brush-mask-resource-v1.ts';
import { captureImageBrushMaskResourcePortV1, type ImageBrushMaskResourceAcknowledgementV1,
	type ImageBrushMaskResourcePortV1 } from '../../image-brush-mask-resource-port-v1.ts';

export interface ImageBrushMaskAuthoringOptionsV1<Receipt extends ImageBrushMaskResourceAcknowledgementV1> {
	readonly port: Readonly<ImageBrushMaskResourcePortV1<Receipt>>;
	readonly isCurrent: () => boolean;
	readonly prepareAcknowledgement: (value: unknown, expected: Readonly<BrushMaskResourceReferenceV1>) => Readonly<Receipt>;
	readonly signal?: AbortSignal;
}
export interface ImageBrushMaskAuthoringOpenV1 {
	readonly width: number;
	readonly height: number;
	readonly reference?: Readonly<BrushMaskResourceReferenceV1>;
}
export interface ImageBrushMaskAuthoringSnapshotV1<Receipt extends ImageBrushMaskResourceAcknowledgementV1> {
	readonly width: number;
	readonly height: number;
	readonly history: Readonly<BrushMaskHistoryV1>;
	readonly ready: boolean;
	readonly busy: boolean;
	readonly closed: boolean;
	readonly receipt: Readonly<Receipt> | null;
}
export type ImageBrushMaskDisplayV1 = Pick<ImageBrushMaskAuthoringSnapshotV1<ImageBrushMaskResourceAcknowledgementV1>, 'width' | 'height' | 'history'>;

export interface ImageBrushMaskAuthoringOwnerV1<Receipt extends ImageBrushMaskResourceAcknowledgementV1> {
	open(request: ImageBrushMaskAuthoringOpenV1): Promise<void>;
	snapshot(): Readonly<ImageBrushMaskAuthoringSnapshotV1<Receipt>>;
	subscribe(listener: (view: Readonly<ImageBrushMaskAuthoringSnapshotV1<Receipt>>) => void): () => void;
	append(stroke: BrushMaskStrokeV1): void;
	undo(): void;
	redo(): void;
	withDisplay<Result>(consume: (alpha: Uint8Array<ArrayBuffer>, view: Readonly<ImageBrushMaskDisplayV1>) => Result | Promise<Result>): Promise<Result>;
	install(): Promise<Readonly<Receipt>>;
	cancelAndJoin(): Promise<void>;
}

const NativeBytes = Uint8Array, SET = NativeBytes.prototype.set, FILL = NativeBytes.prototype.fill;
const SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;
const CHECK = AbortSignal.prototype.throwIfAborted, ADD = AbortSignal.prototype.addEventListener, REMOVE = AbortSignal.prototype.removeEventListener;
const ABORTED = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!;
const REASON = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'reason')!.get!;
const REF_FIELDS = Object.freeze(['storageKey', 'sha256', 'width', 'height', 'byteLength']);
type Alpha = Uint8Array<ArrayBuffer>;

/** Opt-in authoring owns one <=1MiB alpha base and bounded scalar history.
 * Replay/display and encoded installation are serial borrowed scopes, joined
 * before retirement wipes the base. No unpublished renderer source, product edit,
 * persisted strokes, resource deletion or extra Session lifetime is created. */
export class ImageBrushMaskAuthoringV1<Receipt extends ImageBrushMaskResourceAcknowledgementV1> implements ImageBrushMaskAuthoringOwnerV1<Receipt> {
	readonly #port: Readonly<ImageBrushMaskResourcePortV1<Receipt>>;
	readonly #current: () => boolean;
	readonly #prepareAcknowledgement: ImageBrushMaskAuthoringOptionsV1<Receipt>['prepareAcknowledgement'];
	readonly #stop = new AbortController();
	readonly #external: AbortSignal | undefined;
	readonly #cancelled: () => void;
	#base: Alpha | null = null;
	#baseBacking: ArrayBuffer | null = null;
	#pending: Promise<unknown> | null = null;
	#closing: Promise<void> | null = null;
	#listener: ((view: Readonly<ImageBrushMaskAuthoringSnapshotV1<Receipt>>) => void) | null = null;
	#view: Readonly<ImageBrushMaskAuthoringSnapshotV1<Receipt>> = Object.freeze({ width: 0, height: 0,
		history: createBrushMaskHistoryV1(), ready: false, busy: false, closed: false, receipt: null });

	constructor(options: ImageBrushMaskAuthoringOptionsV1<Receipt>) {
		const input = record(options, 'brush authoring options', ['port', 'isCurrent', 'signal', 'prepareAcknowledgement'], ['port', 'isCurrent', 'prepareAcknowledgement']);
		this.#external = captureSignal(Object.hasOwn(input, 'signal') ? field(input, 'signal', 'brush authoring options') : undefined);
		const current = field(input, 'isCurrent', 'brush authoring options');
		if (typeof current !== 'function') throw new TypeError('Brush authoring requires a current entry check.');
		this.#current = () => Reflect.apply(current, options, []) === true;
		const prepare = field(input, 'prepareAcknowledgement', 'brush authoring options');
		if (typeof prepare !== 'function') throw new TypeError('Brush authoring requires an acknowledgement validator.');
		this.#prepareAcknowledgement = (value, expected) => Reflect.apply(prepare, options, [value, expected]) as Readonly<Receipt>;
		this.#port = captureImageBrushMaskResourcePortV1<Receipt>(field(input, 'port', 'brush authoring options'));
		this.#cancelled = () => { this.#stop.abort(Reflect.apply(REASON, this.#external!, [])); };
		if (this.#external !== undefined) {
			Reflect.apply(CHECK, this.#external, []);
			Reflect.apply(ADD, this.#external, ['abort', this.#cancelled, { once: true }]);
			if (Reflect.apply(ABORTED, this.#external, [])) this.#cancelled();
		}
	}

	open(request: ImageBrushMaskAuthoringOpenV1): Promise<void> {
		return this.#run(() => {
			if (this.#base) throw new Error('Brush authoring already owns a grid.');
			const input = record(request, 'brush authoring grid', ['width', 'height', 'reference'], ['width', 'height']);
			const width = dimension(field(input, 'width', 'brush authoring grid')), height = dimension(field(input, 'height', 'brush authoring grid'));
			admitWorkingBytes(width, height);
			const reference = Object.hasOwn(input, 'reference') ? admitReference(field(input, 'reference', 'brush authoring grid')) : undefined;
			if (reference && (reference.width !== width || reference.height !== height)) throw new RangeError('Brush re-edit dimensions must match the installed body.');
			return { width, height, reference };
		}, async input => {
			let candidate: Alpha | undefined, backing: ArrayBuffer | undefined, delivered = false;
			try {
				if (input.reference) await this.#port.source.withBytes(input.reference, bytes => {
					if (delivered) throw new TypeError('Brush source delivered a body more than once.'); delivered = true;
					return withBrushMaskResourceV1({ reference: input.reference, bytes, signal: this.#stop.signal }, resource => {
						this.#check(); candidate = new NativeBytes(input.width * input.height); backing = candidate.buffer;
						Reflect.apply(SET, candidate, [resource.alpha]);
					});
				}, { signal: this.#stop.signal });
				else { candidate = new NativeBytes(input.width * input.height); backing = candidate.buffer; }
				this.#check();
				if (!candidate || !backing) throw new TypeError('Brush source did not deliver its authenticated body.');
				this.#base = candidate; this.#baseBacking = backing; candidate = undefined;
				this.#publish({ width: input.width, height: input.height, history: createBrushMaskHistoryV1(), ready: true, receipt: null });
			} finally { if (candidate && backing) wipe(candidate, backing); }
		});
	}
	snapshot(): Readonly<ImageBrushMaskAuthoringSnapshotV1<Receipt>> { return this.#view; }
	subscribe(listener: (view: Readonly<ImageBrushMaskAuthoringSnapshotV1<Receipt>>) => void): () => void {
		if (typeof listener !== 'function') throw new TypeError('Brush authoring requires a scalar listener.');
		if (this.#view.closed) throw new Error('Brush authoring is closed.');
		this.#listener = listener; this.#notify(); return () => { if (this.#listener === listener) this.#listener = null; };
	}
	append(stroke: BrushMaskStrokeV1): void {
		this.#editable(); const history = appendBrushMaskStrokeV1(this.#view.history, stroke); this.#check(); this.#publish({ history, receipt: null });
	}
	undo(): void { this.#editable(); this.#publish({ history: undoBrushMaskHistoryV1(this.#view.history), receipt: null }); }
	redo(): void { this.#editable(); this.#publish({ history: redoBrushMaskHistoryV1(this.#view.history), receipt: null }); }
	withDisplay<Result>(consume: (alpha: Uint8Array<ArrayBuffer>, view: Readonly<ImageBrushMaskDisplayV1>) => Result | Promise<Result>): Promise<Result> {
		return this.#run(() => {
			this.#ready(); if (typeof consume !== 'function') throw new TypeError('Brush display requires a joined consumer.');
			return this.#display();
		}, view => withBrushMaskPlaneV1({ ...view, baseAlpha: this.#base, signal: this.#stop.signal }, async alpha => {
			const backing = alpha.buffer, length = Number(Reflect.apply(SIZE, backing, []));
			let outcome: { value: Result } | { error: unknown };
			try { this.#check(); const value = await (Reflect.apply(consume, undefined, [alpha, view]) as Result | Promise<Result>);
				this.#check(); outcome = { value }; } catch (error) { outcome = { error }; }
			if (Number(Reflect.apply(SIZE, backing, [])) !== length) {
				const physical = new TypeError('Brush replay backing changed before physical retirement.');
				if ('error' in outcome) throw new AggregateError([outcome.error, physical], 'Brush replay operation and physical retirement failed.', { cause: outcome.error });
				throw physical;
			}
			if ('error' in outcome) throw outcome.error; return outcome.value;
		}));
	}
	install(): Promise<Readonly<Receipt>> {
		return this.#run(() => { this.#ready(); return this.#display(); }, async view => {
			let receipt: Readonly<Receipt> | undefined;
			try {
				await withBrushMaskPlaneV1({ ...view, baseAlpha: this.#base, signal: this.#stop.signal }, alpha => {
					this.#check();
					return withPreparedBrushMaskResourceV1({ width: view.width, height: view.height, alpha, signal: this.#stop.signal }, async prepared => {
						this.#check();
						receipt = this.#prepareAcknowledgement(await this.#port.install(prepared.reference, prepared.bytes, { signal: this.#stop.signal }), prepared.reference);
						// This is storage ACK only. Workspace still fences its exact draft
						// before editing; a retired entry may retain an unreferenced body.
						this.#publish({ receipt });
					});
				});
			} catch (error) {
				if (!receipt || !Reflect.apply(ABORTED, this.#stop.signal, []) || !Object.is(error, Reflect.apply(REASON, this.#stop.signal, []))) throw error;
			}
			if (!receipt) throw new Error('Brush installation did not acknowledge its body.');
			return receipt;
		});
	}
	cancelAndJoin(): Promise<void> {
		if (this.#closing) return this.#closing;
		let resolve!: () => void, reject!: (reason: unknown) => void;
		this.#closing = new Promise<void>((accept, refuse) => { resolve = accept; reject = refuse; });
		this.#listener = null; this.#view = Object.freeze({ ...this.#view, closed: true, ready: false }); this.#stop.abort();
		const cleanup = async () => {
			await this.#pending?.catch(() => undefined);
			const errors: unknown[] = [];
			try { if (this.#base && this.#baseBacking) wipe(this.#base, this.#baseBacking); } catch (error) { errors.push(error); }
			this.#base = null; this.#baseBacking = null;
			try { if (this.#external !== undefined) Reflect.apply(REMOVE, this.#external, ['abort', this.#cancelled]); } catch (error) { errors.push(error); }
			this.#view = Object.freeze({ ...this.#view, busy: false });
			if (errors.length === 1) throw errors[0];
			if (errors.length > 1) throw new AggregateError(errors, 'Brush authoring retirement failed.', { cause: errors[0] });
		};
		void cleanup().then(resolve, reject);
		return this.#closing;
	}

	#display(): Readonly<ImageBrushMaskDisplayV1> {
		return Object.freeze({ width: this.#view.width, height: this.#view.height, history: this.#view.history });
	}
	#ready(): void { if (!this.#base || !this.#view.ready) throw new Error('Brush authoring requires an opened grid.'); }
	#editable(): void {
		if (this.#view.closed) throw new Error('Brush authoring is closed.');
		if (this.#pending) throw new Error('A brush authoring operation is pending.'); this.#check(); this.#ready();
	}
	#check(): void {
		Reflect.apply(CHECK, this.#stop.signal, []);
		const current = this.#current(); Reflect.apply(CHECK, this.#stop.signal, []);
		if (!current) throw new Error('Brush authoring entry is stale.');
	}
	#publish(update: Partial<ImageBrushMaskAuthoringSnapshotV1<Receipt>>): void { this.#view = Object.freeze({ ...this.#view, ...update }); this.#notify(); }
	#notify(): void { try { this.#listener?.(this.#view); } catch { /* Scalar observers cannot erase ACKs or strand borrowed bytes. */ } }
	#run<Input, Result>(admit: () => Input, operation: (input: Input) => Promise<Result>): Promise<Result> {
		if (this.#view.closed) return Promise.reject(new Error('Brush authoring is closed.'));
		if (this.#pending) return Promise.reject(new Error('A brush authoring operation is pending.'));
		let resolve!: (value: Result | PromiseLike<Result>) => void, reject!: (reason: unknown) => void;
		const work = new Promise<Result>((accept, refuse) => { resolve = accept; reject = refuse; }); this.#pending = work;
		void work.then(() => settle(), () => settle()); this.#publish({ busy: true });
		const settle = () => { if (this.#pending === work) { this.#pending = null; this.#publish({ busy: false }); } };
		try { this.#check(); const input = admit(); this.#check(); resolve(operation(input)); }
		catch (error) { try { Reflect.apply(CHECK, this.#stop.signal, []); } catch (cancelled) { reject(cancelled); return work; } reject(error); }
		return work;
	}
}

function dimension(value: unknown): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || Object.is(value, -0) || value < 1 || value > BRUSH_MASK_RESOURCE_LIMITS_V1.maximumSide) {
		throw new RangeError('Brush dimensions require canonical integers from 1 through 1024.');
	}
	return value;
}
function admitReference(value: unknown): Readonly<BrushMaskResourceReferenceV1> {
	if (typeof value === 'string') return normalizeBrushMaskResourceReferenceV1(value);
	const input = record(value, 'brush authoring reference', REF_FIELDS);
	const canonical = normalizeBrushMaskResourceReferenceV1(field(input, 'storageKey', 'brush authoring reference'));
	for (const key of REF_FIELDS) if (field(input, key, 'brush authoring reference') !== canonical[key as keyof BrushMaskResourceReferenceV1]) throw new TypeError('Brush reference differs from its canonical identity.');
	return canonical;
}
function captureSignal(value: unknown): AbortSignal | undefined {
	if (value === undefined) return undefined;
	if (value === null || typeof value !== 'object') throw new TypeError('Brush authoring requires a native cancellation signal.');
	Reflect.apply(CHECK, value, []);
	if (Object.getPrototypeOf(value) !== AbortSignal.prototype || ['aborted', 'reason', 'throwIfAborted', 'addEventListener', 'removeEventListener'].some(key => Object.hasOwn(value, key))) {
		throw new TypeError('Brush authoring cancellation may not shadow native behavior.');
	}
	return value as AbortSignal;
}
function admitWorkingBytes(width: number, height: number): void {
	// Conservative component overlap: base/replay/encoder alpha plus RGBA display,
	// five encoded read/auth/install spans and SHA. This is not a browser heap cap.
	const pixels = BigInt(width) * BigInt(height), peak = pixels * 8n + (pixels + 16n) * 5n + 64n;
	if (peak > 67_108_864n) throw new RangeError('Brush authoring exceeds its working byte budget.');
}
function wipe(alpha: Alpha, backing: ArrayBuffer): void {
	if (Reflect.apply(SIZE, backing, []) !== 0) Reflect.apply(FILL, new NativeBytes(backing), [0]);
}
