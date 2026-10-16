/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainArray as array, readClosedDomainField as field, readClosedDomainRecord as record } from '../../../closed-domain-value.ts';
import { captureRepairSignalV1, checkRepairSignalV1 } from '../../../imaging/pixel-frame-repair-lifetime-v1.ts';
import type { ImageHdrRadianceDiagnosticsV1 } from '../../../imaging/image-hdr-radiance-v1.ts';
import type { ImageHdrMergeAuthoringOptionsCurrentV1, ImageHdrMergeAuthoringPortCurrentV1,
	ImageHdrMergeAuthoringPreviewCurrentV1, ImageHdrMergeAuthoringSelectionCurrentV1 } from '../../../image-hdr-merge-authoring-port-current-v1.ts';

export interface ImageHdrMergeAuthoringSnapshotCurrentV1<Acknowledgement = unknown> {
	readonly selection: Readonly<ImageHdrMergeAuthoringSelectionCurrentV1> | null;
	readonly options: Readonly<ImageHdrMergeAuthoringOptionsCurrentV1> | null;
	readonly working: boolean;
	readonly failed: boolean;
	readonly closed: boolean;
	readonly previewReady: boolean;
	readonly diagnostics: Readonly<ImageHdrRadianceDiagnosticsV1> | null;
	readonly acknowledged: Readonly<Acknowledgement> | null;
}
type Port<A> = Readonly<ImageHdrMergeAuthoringPortCurrentV1<A>>;
type OperationKind = 'open' | 'preview' | 'merge' | 'change';
const INITIAL = Object.freeze({ selection: null, options: null, working: false, failed: false, closed: false, previewReady: false, diagnostics: null, acknowledged: null });

/** One opted-in source generation. Product code owns native authentication and
 * publication; this owner joins its serial requests and latches a real ACK. */
export class ImageHdrMergeAuthoringCurrentV1<Acknowledgement = unknown> {
	readonly #portValue: unknown;
	readonly #isCurrent: () => boolean;
	#port: Port<Acknowledgement> | null = null;
	#view: Readonly<ImageHdrMergeAuthoringSnapshotCurrentV1<Acknowledgement>> = INITIAL;
	#listeners = new Set<(value: Readonly<ImageHdrMergeAuthoringSnapshotCurrentV1<Acknowledgement>>) => void>();
	#pending: Promise<void> = Promise.resolve();
	#active: AbortController | null = null;
	#kind: OperationKind | null = null;
	#opened = false;
	#closing: Promise<void> | null = null;
	#sequence = 0;
	#failure: Readonly<{ error: unknown }> | null = null;

	constructor(value: unknown) {
		const input = record(value, 'HDR authoring binding', ['port', 'isCurrent']);
		this.#portValue = field(input, 'port', 'HDR authoring binding');
		const isCurrent = field(input, 'isCurrent', 'HDR authoring binding');
		if (typeof isCurrent !== 'function') throw new TypeError('HDR authoring requires a generation fence.');
		this.#isCurrent = () => Reflect.apply(isCurrent, value, []) === true;
	}
	snapshot(): Readonly<ImageHdrMergeAuthoringSnapshotCurrentV1<Acknowledgement>> { return this.#view; }
	subscribe(listener: (view: Readonly<ImageHdrMergeAuthoringSnapshotCurrentV1<Acknowledgement>>) => void): () => void {
		if (typeof listener !== 'function') throw new TypeError('HDR authoring requires a scalar observer.');
		this.#listeners.add(listener); listener(this.#view); return () => { this.#listeners.delete(listener); };
	}
	open(before: Promise<void> = Promise.resolve(), options: Readonly<{ signal?: AbortSignal }> = {}): Promise<void> {
		let signal: AbortSignal | undefined;
		try {
			signal = readSignal(options); checkRepairSignalV1(signal);
			if (this.#opened || this.#closing) throw new Error('HDR authoring is already opened or closed.');
			this.#opened = true;
			// Preabort is checked before reflecting a potentially hostile capability.
			this.#port = capturePort<Acknowledgement>(this.#portValue);
		} catch (error) { return Promise.reject(error); }
		return this.#run('open', async joined => {
			await before; this.#check(joined);
			const selected = captureSelection(await this.#port!.readSelection({ signal: joined })); this.#check(joined);
			const options = captureOptions({ schemaVersion: 1, referenceIndex: 0,
				exposureMultipliers: selected.suggestedExposureMultipliers ?? selected.sources.map(() => 1),
				alignment: 'none', deghost: { mode: 'off', threshold: .1 }, fileName: 'HDR merge.lshdr' }, selected.sources.length);
			this.#publish({ selection: selected, options });
		}, signal);
	}
	setOptions(value: unknown): Promise<void> {
		let captured: Readonly<ImageHdrMergeAuthoringOptionsCurrentV1>;
		try { this.#admitChange(); captured = captureOptions(value, this.#view.selection!.sources.length); }
		catch (error) { return Promise.reject(error); }
		return this.#run('change', async signal => { this.#check(signal); this.#publish({ options: captured }); });
	}
	setReference(value: unknown): Promise<void> {
		try {
			this.#admitChange();
			const options = this.#view.options!, index = integer(value, 0, options.exposureMultipliers.length - 1), reference = options.exposureMultipliers[index]!;
			return this.setOptions({ ...options, referenceIndex: index, exposureMultipliers: options.exposureMultipliers.map((n, at) => at === index ? 1 : n / reference) });
		} catch (error) { return Promise.reject(error); }
	}
	preview(consume: (value: Readonly<ImageHdrMergeAuthoringPreviewCurrentV1>) => unknown): Promise<void> {
		try { this.#admitOperation(); if (typeof consume !== 'function') throw new TypeError('HDR Preview requires a scoped painter.'); }
		catch (error) { return Promise.reject(error); }
		const options = this.#view.options!;
		return this.#run('preview', async signal => {
			let delivered = false, result: Readonly<ImageHdrRadianceDiagnosticsV1> | null = null;
			await this.#port!.withPreview(options, view => {
				this.#check(signal); if (delivered) throw new TypeError('HDR Preview delivered more than one frame.');
				result = captureDiagnostics(view.diagnostics); delivered = true;
				return consume(view);
			}, { signal });
			this.#check(signal); if (!delivered || !result) throw new TypeError('HDR Preview did not deliver a native result.');
			this.#publish({ previewReady: true, diagnostics: result });
		});
	}
	merge(): Promise<void> {
		try { this.#admitOperation(); }
		catch (error) { return Promise.reject(error); }
		const options = this.#view.options!;
		return this.#run('merge', async signal => {
			let acknowledged = false;
			const acknowledge = (value: Readonly<Acknowledgement>) => {
				if (acknowledged) {
					if (!Object.is(value, this.#view.acknowledged)) throw new TypeError('HDR publication returned conflicting acknowledgements.');
					return;
				}
				// Native acknowledgement precedes cancellation/currentness fences.
				acknowledged = true; this.#publish({ acknowledged: value });
			};
			const result = await this.#port!.merge(options, { signal, onAcknowledged: acknowledge });
			if (!acknowledged) acknowledge(result.acknowledgement);
			else if (!Object.is(result.acknowledgement, this.#view.acknowledged)) throw new TypeError('HDR publication changed its acknowledgement.');
			this.#check(signal); this.#publish({ diagnostics: captureDiagnostics(result.diagnostics) });
		});
	}
	close(): Promise<void> {
		if (this.#closing) return this.#closing;
		let resolve!: () => void, reject!: (error: unknown) => void;
		this.#closing = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
		this.#sequence++; this.#publish({ closed: true, previewReady: false }); this.#active?.abort();
		void this.#pending.then(() => {
			this.#publish({ working: false }); if (this.#failure) throw this.#failure.error;
		}).then(resolve, reject);
		return this.#closing;
	}
	#admitChange(): void {
		this.#check(); if (!this.#opened || !this.#view.selection || !this.#view.options) throw new Error('HDR source selection is unavailable.');
		if (this.#kind === 'merge' || this.#view.acknowledged !== null) throw new Error('HDR publication is already pending or acknowledged.');
	}
	#admitOperation(): void {
		this.#admitChange(); if (this.#view.working) throw new Error('An HDR operation is already pending.');
	}
	#check(signal?: AbortSignal): void {
		checkRepairSignalV1(signal); if (this.#closing || this.#view.closed) throw new Error('HDR authoring generation is closed.');
		if (!this.#isCurrent()) throw new Error('HDR source selection changed.');
	}
	#run(kind: OperationKind, action: (signal: AbortSignal) => Promise<void>, caller?: AbortSignal): Promise<void> {
		const previous = this.#pending, previousStop = this.#active, stop = new AbortController(), sequence = ++this.#sequence;
		const signal = caller ? AbortSignal.any([stop.signal, caller]) : stop.signal;
		let resolve!: () => void;
		this.#pending = new Promise<void>(yes => { resolve = yes; }); this.#active = stop; this.#kind = kind;
		previousStop?.abort(); this.#publish({ working: true, failed: false, previewReady: false, diagnostics: null });
		const work = (async () => {
			try { await previous; this.#check(signal); await action(signal); }
			catch (error) {
				const cancelled = signal.aborted && Object.is(error, signal.reason);
				if (!cancelled) this.#retain(error);
				if (sequence === this.#sequence && !this.#closing) this.#publish({ failed: !cancelled, previewReady: false });
				throw error;
			} finally {
				if (sequence === this.#sequence) { this.#active = null; this.#kind = null; this.#publish({ working: false }); }
			}
		})();
		void work.then(resolve, resolve); return work;
	}
	#retain(error: unknown): void {
		if (this.#failure && Object.is(this.#failure.error, error)) return;
		this.#failure = { error: this.#failure ? new AggregateError([this.#failure.error, error], 'HDR authoring operations failed.', { cause: this.#failure.error }) : error };
	}
	#publish(change: Partial<ImageHdrMergeAuthoringSnapshotCurrentV1<Acknowledgement>>): void {
		this.#view = Object.freeze({ ...this.#view, ...change });
		for (const listener of this.#listeners) { try { listener(this.#view); } catch (error) { this.#retain(error); } }
	}
}

function capturePort<A>(value: unknown): Port<A> {
	const input = record(value, 'HDR authoring port', ['schemaVersion', 'readSelection', 'withPreview', 'merge']);
	if (field(input, 'schemaVersion', 'HDR authoring port') !== 1) throw new RangeError('Unsupported HDR authoring port version.');
	const read = field(input, 'readSelection', 'HDR authoring port'), preview = field(input, 'withPreview', 'HDR authoring port'), merge = field(input, 'merge', 'HDR authoring port');
	if (typeof read !== 'function' || typeof preview !== 'function' || typeof merge !== 'function') throw new TypeError('HDR authoring requires complete source, Preview and publication capabilities.');
	return Object.freeze<Port<A>>({ schemaVersion: 1,
		readSelection: options => Reflect.apply(read, value, [options]) as ReturnType<Port<A>['readSelection']>,
		withPreview: <R>(options: Readonly<ImageHdrMergeAuthoringOptionsCurrentV1>, consume: (view: Readonly<ImageHdrMergeAuthoringPreviewCurrentV1>) => R | Promise<R>, runtime?: Readonly<{ signal?: AbortSignal }>) => Reflect.apply(preview, value, [options, consume, runtime]) as Promise<R>,
		merge: (options, runtime) => Reflect.apply(merge, value, [options, runtime]) as ReturnType<Port<A>['merge']>,
	});
}
function captureSelection(value: unknown): Readonly<ImageHdrMergeAuthoringSelectionCurrentV1> {
	const input = record(value, 'HDR source selection', ['schemaVersion', 'sources', 'suggestedExposureMultipliers']);
	if (field(input, 'schemaVersion', 'HDR source selection') !== 1) throw new RangeError('Unsupported HDR source selection.');
	const keys = new Set<string>();
	const sources = array(field(input, 'sources', 'HDR source selection'), 'HDR source rows', 2, 9).map(value => {
		const row = record(value, 'HDR source row', ['key', 'label', 'width', 'height', 'exposureSeconds', 'aperture', 'iso']);
		const key = text(field(row, 'key', 'HDR source row'), 512), label = text(field(row, 'label', 'HDR source row'), 4096);
		if (keys.has(key)) throw new RangeError('HDR source rows must be distinct.'); keys.add(key);
		const width = integer(field(row, 'width', 'HDR source row'), 1, 8192), height = integer(field(row, 'height', 'HDR source row'), 1, 8192);
		if (width * height > 16777216) throw new RangeError('HDR source extent exceeds the native profile.');
		return Object.freeze({ key, label, width, height, exposureSeconds: nullablePositive(field(row, 'exposureSeconds', 'HDR source row')),
			aperture: nullablePositive(field(row, 'aperture', 'HDR source row')), iso: nullablePositive(field(row, 'iso', 'HDR source row')) });
	});
	if (sources.some(source => source.width !== sources[0]!.width || source.height !== sources[0]!.height)) throw new RangeError('HDR source extents must match.');
	const proposed = field(input, 'suggestedExposureMultipliers', 'HDR source selection');
	const suggestedExposureMultipliers = proposed === null ? null : Object.freeze(array(proposed, 'HDR exposure suggestions', sources.length, sources.length).map(value => finite(value, 1 / 65536, 65536)));
	if (suggestedExposureMultipliers && suggestedExposureMultipliers[0] !== 1) throw new RangeError('HDR exposure suggestions must reference the first source.');
	return Object.freeze({ schemaVersion: 1, sources: Object.freeze(sources), suggestedExposureMultipliers });
}
function captureOptions(value: unknown, count: number): Readonly<ImageHdrMergeAuthoringOptionsCurrentV1> {
	const input = record(value, 'HDR authored options', ['schemaVersion', 'referenceIndex', 'exposureMultipliers', 'alignment', 'deghost', 'fileName']);
	if (field(input, 'schemaVersion', 'HDR authored options') !== 1) throw new RangeError('Unsupported HDR authored options.');
	const referenceIndex = integer(field(input, 'referenceIndex', 'HDR authored options'), 0, count - 1);
	const exposureMultipliers = Object.freeze(array(field(input, 'exposureMultipliers', 'HDR authored options'), 'HDR authored exposures', count, count).map(value => finite(value, 1 / 65536, 65536)));
	if (exposureMultipliers[referenceIndex] !== 1) throw new RangeError('HDR reference exposure must be exactly one.');
	const alignment = field(input, 'alignment', 'HDR authored options'); if (alignment !== 'none' && alignment !== 'ward-mtb-v1') throw new RangeError('Unsupported HDR alignment.');
	const ghost = record(field(input, 'deghost', 'HDR authored options'), 'HDR deghost options', ['mode', 'threshold']), mode = field(ghost, 'mode', 'HDR deghost options');
	if (mode !== 'off' && mode !== 'reference-v1') throw new RangeError('Unsupported HDR deghost mode.');
	const fileName = text(field(input, 'fileName', 'HDR authored options'), 240);
	if (fileName.includes('/') || fileName.includes('\\') || !fileName.toLowerCase().endsWith('.lshdr') || fileName === '.lshdr') throw new RangeError('HDR filename must be a safe .lshdr name.');
	return Object.freeze({ schemaVersion: 1, referenceIndex, exposureMultipliers, alignment, deghost: Object.freeze({ mode, threshold: finite(field(ghost, 'threshold', 'HDR deghost options'), 0, 1) }), fileName });
}
function captureDiagnostics(value: unknown): Readonly<ImageHdrRadianceDiagnosticsV1> {
	const input = record(value, 'HDR result diagnostics', ['motionPixels', 'inconsistentPixels', 'referenceClippedPixels', 'unresolvedPixels', 'fallbackChannels']);
	return Object.freeze({ motionPixels: integer(field(input, 'motionPixels', 'HDR result diagnostics'), 0, 16777216),
		inconsistentPixels: integer(field(input, 'inconsistentPixels', 'HDR result diagnostics'), 0, 16777216), referenceClippedPixels: integer(field(input, 'referenceClippedPixels', 'HDR result diagnostics'), 0, 16777216),
		unresolvedPixels: integer(field(input, 'unresolvedPixels', 'HDR result diagnostics'), 0, 16777216), fallbackChannels: integer(field(input, 'fallbackChannels', 'HDR result diagnostics'), 0, 50331648) });
}
function readSignal(value: unknown): AbortSignal | undefined {
	const input = record(value, 'HDR authoring signal options', ['signal'], []);
	return captureRepairSignalV1(Object.hasOwn(input, 'signal') ? field(input, 'signal', 'HDR authoring signal options') : undefined);
}
function finite(value: unknown, minimum: number, maximum: number): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || Object.is(value, -0) || value < minimum || value > maximum) throw new RangeError('HDR scalar is outside its finite authored range.'); return value;
}
function integer(value: unknown, minimum: number, maximum: number): number { const result = finite(value, minimum, maximum); if (!Number.isSafeInteger(result)) throw new RangeError('HDR authoring requires an integer index or extent.'); return result; }
function text(value: unknown, maximum: number): string {
	if (typeof value !== 'string' || !value.length || value.length > maximum) throw new TypeError('HDR authoring requires bounded safe text.');
	for (let index = 0; index < value.length; index++) { const code = value.charCodeAt(index); if (code <= 31 || code === 127) throw new TypeError('HDR authoring requires bounded safe text.'); }
	return value;
}
function nullablePositive(value: unknown): number | null { return value === null ? null : finite(value, Number.MIN_VALUE, Number.MAX_VALUE); }
