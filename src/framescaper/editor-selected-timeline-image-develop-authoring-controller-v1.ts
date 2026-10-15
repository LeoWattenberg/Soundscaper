/* SPDX-License-Identifier: AGPL-3.0-only */

import { cloneFramescaperProject } from './editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from './editor-project-runtime-profile.ts';
import type { FramescaperImageSourceSetCommandTimelineImage } from './editor-project-timeline-image-image-command.ts';
import type { FramescaperStoredImageAssetStoreTimelineImage } from './editor-selected-timeline-image-image-frame-source.ts';
import type { FramescaperCurrentImageFrameReader } from './timeline-image-current-frame-source.ts';
import type { ImageDevelopStateCurrentV1 } from '../common/editor/imaging/image-develop-state-current-v1.ts';
import type { PixelFrameV1 } from '../common/editor/imaging/pixel-frame-contract-v1.ts';
import { defaultImageDevelopStateV1 } from '../common/editor/imaging/image-develop-state-v1.ts';
import type { WithImageDevelopDraftFrameV1 } from '../common/editor/controller/shared/image-develop-draft-presentation-v1.ts';
import type { ImageBrushMaskResourceAcknowledgementV1, ImageBrushMaskResourcePortV1, WithImageBrushMaskDraftFrameV1 } from '../common/editor/image-brush-mask-resource-port-v1.ts';
import type { MediaAssetWriteOptions, OwnedMediaAssetWriter } from '../common/editor/storage/media-asset-write-contract.ts';
import { assertFramescaperNativeImageSignalCurrentV1, retireFramescaperNativeImageCurrentV1 } from './internal/timeline-image-native-pack-owner-current-v1.ts';
import type { WithImageRepairSpotsOriginalFrameV1 } from '../common/editor/controller/shared/image-repair-spots-authoring-v1.ts';
import { suspendVideoPreviewForAuthoringV1 } from '../common/editor/controller/clip-video/video-preview-authoring-suspension-v1.ts';
import { sameProjectSnapshot } from '../common/editor/storage/project-snapshot-equality.ts';
import { readClosedDomainRecord, readClosedDomainField } from '../common/editor/closed-domain-value.ts';
import { prepareFramescaperRawImageWorkingCurrentV1, FRAMESCAPER_RAW_IMAGE_AUTHORING_BYTES_CURRENT_V1 } from './internal/timeline-image-raw-working-plan-current-v1.ts';

interface Controller {
	readonly project: unknown;
	getSnapshot(): Readonly<{ selectedClipId?: unknown; readOnly?: unknown }>;
	readonly actions: Readonly<{ edit: Readonly<{ commit(command: FramescaperImageSourceSetCommandTimelineImage): unknown }> }>;
}
export interface FramescaperImageDevelopAuthoringSessionCurrentV1 {
	readonly nativeCurrent?: true;
	readonly sourceName: string;
	readonly develop: Readonly<ImageDevelopStateCurrentV1>;
	readonly withOriginalFrame: WithImageRepairSpotsOriginalFrameV1;
	readonly withDraftFrame?: WithImageDevelopDraftFrameV1;
	readonly brushMasks?: Readonly<ImageBrushMaskResourcePortV1<ImageBrushMaskResourceAcknowledgementV1 & { readonly projectId: string }> & { readonly projectId: string }>;
	readonly withBrushDraftFrame?: WithImageBrushMaskDraftFrameV1;
	isCurrent(): boolean;
	apply(develop: Readonly<ImageDevelopStateCurrentV1>): void;
	closeAndJoin(): Promise<void>;
}
export interface FramescaperImageDevelopAuthoringPortCurrentV1 {
	open(options?: Readonly<{ signal?: AbortSignal }>): Promise<Readonly<FramescaperImageDevelopAuthoringSessionCurrentV1>>;
}
const PORTS = new WeakMap<object, Readonly<FramescaperImageDevelopAuthoringPortCurrentV1>>();
const CHECK = AbortSignal.prototype.throwIfAborted;
const NativeController = AbortController, ANY = AbortSignal.any, ABORT = AbortController.prototype.abort;
interface BrushStore extends FramescaperStoredImageAssetStoreTimelineImage {
	getMediaAssetMetadata(key: string): Promise<unknown>;
	beginMediaAssetWrite(key: string, metadata: Readonly<Record<string, unknown>>, options: MediaAssetWriteOptions): Promise<OwnedMediaAssetWriter>;
}
export function framescaperImageDevelopAuthoringForCurrentV1(owner: object): Readonly<FramescaperImageDevelopAuthoringPortCurrentV1> | null {
	return PORTS.get(owner) ?? null;
}
/** The real product composition lends its selected store and existing edit
 * command. This boundary creates no project store, writer, or Photo identity. */
export function bindFramescaperImageDevelopAuthoringCurrentV1(options: Readonly<{ controller: Controller; store: FramescaperStoredImageAssetStoreTimelineImage }>): void {
	const controller = options.controller, snapshot = controller.getSnapshot.bind(controller), edit = controller.actions.edit;
	const commit = edit.commit.bind(edit), store = options.store;
	const load = captureStoreMethod<FramescaperStoredImageAssetStoreTimelineImage['loadMediaAsset']>(store, 'loadMediaAsset');
	if (!load) throw new TypeError('Selected Frame authoring requires its native media reader.');
	const metadata = captureStoreMethod<BrushStore['getMediaAssetMetadata']>(store, 'getMediaAssetMetadata');
	const begin = captureStoreMethod<BrushStore['beginMediaAssetWrite']>(store, 'beginMediaAssetWrite');
	const borrowed = Object.freeze<FramescaperStoredImageAssetStoreTimelineImage>({
		loadMediaAsset: (...args) => Reflect.apply(load, store, args) as ReturnType<typeof load>,
	});
	const writable = metadata && begin ? Object.freeze<BrushStore>({ ...borrowed,
		getMediaAssetMetadata: (...args) => Reflect.apply(metadata, store, args) as ReturnType<typeof metadata>,
		beginMediaAssetWrite: (...args) => Reflect.apply(begin, store, args) as ReturnType<typeof begin>,
	}) : undefined;
	PORTS.set(controller, Object.freeze({ async open(value = {}) {
		const descriptor = Object.getOwnPropertyDescriptor(value, 'signal');
		if (descriptor && !Object.hasOwn(descriptor, 'value')) throw new TypeError('Image Develop signal must be an own data property.');
		const external = descriptor?.value as AbortSignal | undefined;
		assertFramescaperNativeImageSignalCurrentV1(external);
		const stop = new NativeController(), signal = external === undefined ? stop.signal : ANY([external, stop.signal]);
		const check = () => { if (signal !== undefined) Reflect.apply(CHECK, signal, []); };
		check(); readClosedDomainRecord(value, 'Image Develop options', ['signal'], []);
		const selected = snapshot(); if (selected.readOnly === true) throw new Error('The selected Frame project is read only.');
		const project = cloneFramescaperProject(PROFILE, controller.project), clipId = selected.selectedClipId;
		const clip = [...project.clips, ...project.projectBin.clips].find(item => item.id === clipId);
		const source = clip && project.sources.find(item => item.id === clip.sourceId);
		if (!clip || clip.kind !== 'image' || !source || source.kind !== 'image') throw new Error('Image Develop requires a selected static image.');
		const develop = source.schemaVersion === 1 ? defaultImageDevelopStateV1() : source.develop;
		if (source.schemaVersion === 4) prepareFramescaperRawImageWorkingCurrentV1(source, { authoringBytes: FRAMESCAPER_RAW_IMAGE_AUTHORING_BYTES_CURRENT_V1 });
		else if (BigInt(source.assetByteLength) * 3n + BigInt(source.canonical.width) * BigInt(source.canonical.height) * 4n + 4_096n > 512n * 1024n * 1024n) {
			throw new RangeError('Frame Original authoring exceeds its 512 MiB working byte bound.');
		}
		const [{ prepareFramescaperImageDevelopSourceCurrentV1 }, { prepareImageDevelopMaskOverlaySelectionV1 },
			{ createFramescaperImageBrushMaskPortCurrentV1 }, { prepareFramescaperImageBrushDraftFrameCurrentV1 }] = await Promise.all([
			import('./timeline-image-develop-authoring-current-v1.ts'), import('../common/editor/imaging/image-develop-mask-overlay-v1.ts'),
			import('./internal/selected-image-brush-mask-port-current-v1.ts'), import('./internal/selected-image-brush-draft-render-owner-current-v1.ts'),
		]);
		check();
		prepareFramescaperImageDevelopSourceCurrentV1(project, clip.id, develop);
		let sealed = false, applied = false, reader: FramescaperCurrentImageFrameReader | undefined, opening: Promise<FramescaperCurrentImageFrameReader> | undefined;
		const pending = new Set<Promise<unknown>>(); let closing: Promise<void> | undefined;
		const isCurrent = () => {
			if (sealed || applied) return false;
			try { check(); const current = snapshot(); return current.readOnly !== true && current.selectedClipId === clip.id
				&& sameProjectSnapshot(cloneFramescaperProject(PROFILE, controller.project), project); } catch { return false; }
		};
		const current = () => { check(); if (!isCurrent()) throw new Error('The selected Frame image changed during authoring.'); };
		const suspension = await suspendVideoPreviewForAuthoringV1(controller, signal);
		try { current(); } catch (error) { suspension.release(); throw error; }
		let authenticating: Promise<void> | undefined;
		const authenticateRetained = async (admitted: AbortSignal) => {
			const fence = () => { Reflect.apply(CHECK, admitted, []); current(); };
			const [{ collectFramescaperImageProjectResourcesCurrentV1: collect }, { createFramescaperCubeLutSourceFinishing: createLuts },
				{ createFramescaperMaskRasterSourceTimelineImageV1: createBrushes }] = await Promise.all([
				import('../common/editor/video-cube-lut-project-references-current-v1.ts'), import('./cube-lut-source-finishing.ts'), import('./timeline-image-mask-raster-source-v1.ts'),
			]);
			fence(); const refs = collect(project), luts = createLuts(borrowed), brushes = createBrushes(borrowed);
			const cleanup = [() => luts.close(), () => brushes.close()];
			try {
				for (const ref of refs.luts) { fence(); await luts.withBytes(ref, () => undefined, { signal: admitted }); fence(); }
				for (const ref of refs.brushes) { fence(); await brushes.withBytes(ref, () => undefined, { signal: admitted }); fence(); }
			} catch (error) { await retireFramescaperNativeImageCurrentV1({ error }, cleanup); throw error; }
			await retireFramescaperNativeImageCurrentV1(undefined, cleanup);
		};
		const authenticate = () => authenticating ??= authenticateRetained(signal);
		try { await authenticate(); current(); } catch (error) { suspension.release(); throw error; }
		const operation = <Result>(run: (admitted: AbortSignal) => Promise<Result>, callerOptions: Readonly<{ signal?: AbortSignal }> = {}): Promise<Result> => {
			if (sealed) return Promise.reject(new Error('The Frame image authoring scope is closed.'));
			if (pending.size) return Promise.reject(new Error('Frame image authoring work is already pending.'));
			let resolve!: (value: Result | PromiseLike<Result>) => void, reject!: (error: unknown) => void;
			const work = new Promise<Result>((yes, no) => { resolve = yes; reject = no; }); pending.add(work); void work.catch(() => undefined);
			void (async () => {
				let admitted = signal;
				try {
					current(); const callerField = Object.getOwnPropertyDescriptor(callerOptions, 'signal');
					if (callerField && !Object.hasOwn(callerField, 'value')) throw new TypeError('Frame image signal must be an own data property.');
					const caller = callerField?.value as AbortSignal | undefined;
					assertFramescaperNativeImageSignalCurrentV1(caller); admitted = caller === undefined ? signal : ANY([signal, caller]);
					readClosedDomainRecord(callerOptions, 'Frame image options', ['signal'], []); Reflect.apply(CHECK, admitted, []); current();
				} catch (error) { Reflect.apply(CHECK, admitted, []); current(); throw error; }
				return run(admitted);
			})().then(result => { pending.delete(work); resolve(result); }, error => { pending.delete(work); reject(error); });
			return work;
		};
		const brushOwner = writable ? createFramescaperImageBrushMaskPortCurrentV1({ project, store: writable,
			assertCurrent: current, operation, authenticate: authenticateRetained }) : undefined;
		const canonical = async <Result>(consume: (frame: Readonly<PixelFrameV1>) => Result | Promise<Result>, admitted: AbortSignal): Promise<Result> => {
			const borrowerCurrent = () => { Reflect.apply(CHECK, admitted, []); current(); };
			borrowerCurrent(); if (typeof consume !== 'function') throw new TypeError('Frame Original borrowing requires a consumer.');
			await authenticate(); borrowerCurrent();
			opening ??= import('./timeline-image-current-frame-source.ts').then(module => module.openFramescaperCurrentImageFrameSource(borrowed, source, signal, undefined, 'canonical-authoring'));
			reader = await opening; borrowerCurrent();
			return reader.withCanonicalFrame(async frame => { borrowerCurrent(); const result = await consume(frame); borrowerCurrent(); return result; }, admitted);
		};
		const withOriginalFrame: WithImageRepairSpotsOriginalFrameV1 = (consume, callerOptions = {}) => operation(admitted => canonical(consume, admitted), callerOptions);
		const withDraftFrame: WithImageDevelopDraftFrameV1 = (request, consume, callerOptions = {}) => operation(async admitted => {
			Reflect.apply(CHECK, admitted, []); current();
			let captured: Parameters<WithImageDevelopDraftFrameV1>[0];
			try {
				if (typeof consume !== 'function') throw new TypeError('Frame draft borrowing requires a consumer.');
				const input = readClosedDomainRecord(request, 'Frame Develop draft', ['develop', 'maskOverlay'], ['develop']);
				const prepared = prepareFramescaperImageDevelopSourceCurrentV1(project, clip.id, readClosedDomainField(input, 'develop', 'Frame Develop draft'));
				if (!prepared.source) throw new TypeError('Frame draft rendering requires its exact image source.');
				captured = Object.freeze({ develop: prepared.source.schemaVersion === 1 ? defaultImageDevelopStateV1() : prepared.source.develop,
					...(Object.hasOwn(input, 'maskOverlay') ? { maskOverlay: prepareImageDevelopMaskOverlaySelectionV1(readClosedDomainField(input, 'maskOverlay', 'Frame Develop draft')) } : {}) });
				Reflect.apply(CHECK, admitted, []); current();
			} catch (error) { Reflect.apply(CHECK, admitted, []); current(); throw error; }
			const { withFramescaperImageDevelopDraftFrameCurrentV1: render } = await import('./internal/selected-image-develop-draft-render-owner-current-v1.ts');
			Reflect.apply(CHECK, admitted, []); current();
			return render({ project, clipId: clip.id, store: borrowed, assertCurrent: current,
				withOriginalFrame: (accept, options = {}) => canonical(accept, options.signal ?? admitted) }, captured, consume, admitted);
		}, callerOptions);
		const withBrushDraftFrame: WithImageBrushMaskDraftFrameV1 = (request, consume, callerOptions = {}) => operation(async admitted => {
			Reflect.apply(CHECK, admitted, []); current();
			let captured: ReturnType<typeof prepareFramescaperImageBrushDraftFrameCurrentV1>;
			try { captured = prepareFramescaperImageBrushDraftFrameCurrentV1(request); }
			catch (error) { Reflect.apply(CHECK, admitted, []); current(); throw error; }
			let outcome: { error: unknown } | undefined;
			try {
				try {
					if (typeof consume !== 'function') throw new TypeError('Frame brush draft borrowing requires a consumer.');
					prepareFramescaperImageDevelopSourceCurrentV1(project, clip.id, captured.develop);
					Reflect.apply(CHECK, admitted, []); current();
				} catch (error) { Reflect.apply(CHECK, admitted, []); current(); throw error; }
				const { withFramescaperImageBrushDraftFrameCurrentV1: render } = await import('./internal/selected-image-brush-draft-render-owner-current-v1.ts');
				Reflect.apply(CHECK, admitted, []); current();
				return await render({ project, clipId: clip.id, store: borrowed, assertCurrent: current,
					withOriginalFrame: (accept, options = {}) => canonical(accept, options.signal ?? admitted) }, captured, consume, admitted);
			} catch (error) { outcome = { error }; throw error; }
			finally { await retireFramescaperNativeImageCurrentV1(outcome, [() => captured.retire()]); }
		}, callerOptions);
		return Object.freeze<FramescaperImageDevelopAuthoringSessionCurrentV1>({ sourceName: source.name, develop, withOriginalFrame, withDraftFrame, withBrushDraftFrame,
			...(source.schemaVersion === 4 ? { nativeCurrent: true as const } : {}),
			...(brushOwner ? { brushMasks: brushOwner.port } : {}), isCurrent,
			apply(next) {
				current(); if (pending.size) throw new Error('Frame image work must join before Apply.');
				const command = prepareFramescaperImageDevelopSourceCurrentV1(project, clip.id, next); current();
				if (!sameProjectSnapshot(command.source, command.expectedSource)) Reflect.apply(commit, edit, [command]);
				applied = true;
			},
			closeAndJoin() {
				if (closing) return closing; sealed = true;
				closing = (async () => { const errors: unknown[] = [];
					await Promise.allSettled([...pending]);
					if (brushOwner) try { await brushOwner.closeAndJoin(); } catch (error) { errors.push(error); }
					if (opening) try { reader = await opening; } catch { /* The borrower retains its exact acquisition failure. */ }
					if (reader) try { await reader.closeAndJoin(); } catch (error) { errors.push(error); }
					suspension.release();
					if (errors.length === 1) throw errors[0];
					if (errors.length) throw new AggregateError(errors, 'Frame image authoring retirement failed.');
				})(); void closing.catch(() => undefined);
				Reflect.apply(ABORT, stop, [new Error('The selected Frame image changed during authoring.')]); return closing;
			},
		});
	} }));
}
function captureStoreMethod<Method extends (...args: never[]) => unknown>(store: object, key: string): Method | undefined {
	let owner: object | null = store;
	for (let depth = 0; owner && depth < 32; depth++) {
		const descriptor = Object.getOwnPropertyDescriptor(owner, key);
		if (descriptor) {
			if (!Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') throw new TypeError('Selected Frame storage requires captured data methods.');
			return descriptor.value as Method;
		}
		owner = Object.getPrototypeOf(owner) as object | null;
	}
	return undefined;
}
