/* SPDX-License-Identifier: AGPL-3.0-only */

import { useCallback } from 'react';
import { readClosedDomainArray as array, readClosedDomainField as field, readClosedDomainRecord as record } from '../../closed-domain-value.ts';
import { captureRepairSignalV1, checkRepairSignalV1 } from '../../imaging/pixel-frame-repair-lifetime-v1.ts';
import type { ImageHdrMergeAuthoringPortCurrentV1, ImageHdrMergeAuthoringOptionsCurrentV1, ImageHdrMergeAuthoringPreviewCurrentV1 } from '../../image-hdr-merge-authoring-port-current-v1.ts';
import type { PhotoLibrarySessionPortCurrentV1 } from '../../photo-library-session-port-current-v1.ts';
import type { PhotoLibraryImportItemV1 } from '../../photo-library-session-port-v1.ts';
import type { PhotoLibraryHdrMergePortCurrentV1 } from '../../photo-library-hdr-merge-port-current-v1.ts';

export interface PhotoHdrMergeWorkflowHostCurrentV1 {
	readonly signal: AbortSignal;
	acquire(): Promise<Readonly<PhotoLibrarySessionPortCurrentV1>>;
	isCurrent(): boolean;
	refresh(): Promise<void>;
}
export type ExecutePhotoHdrMergeCurrentV1 = (action: (host: Readonly<PhotoHdrMergeWorkflowHostCurrentV1>) => Promise<void>, signal?: AbortSignal) => Promise<'completed' | 'failed' | 'cancelled' | 'busy'>;
type Native = Readonly<PhotoLibraryHdrMergePortCurrentV1>;
type Selection = Awaited<ReturnType<Native['readSelection']>>;

/** Capture an existing selected Session. All work uses its maintained action
 * owner; a fresh second action refreshes a real ACK after the first one joins. */
export function usePhotoLibraryWorkflowHdrMergeCurrentV1(execute: ExecutePhotoHdrMergeCurrentV1) {
	return useCallback((idsValue: readonly string[], isSelected: () => boolean = () => true): Readonly<ImageHdrMergeAuthoringPortCurrentV1<PhotoLibraryImportItemV1>> => {
		const ids = Object.freeze(array(idsValue, 'HDR menu photo selection', 2, 9).map(id));
		if (new Set(ids).size !== ids.length || typeof isSelected !== 'function') throw new TypeError('HDR requires a distinct captured photo selection.');
		let native: Native | null = null, methods: Native | null = null, selection: Selection | null = null;
		const checked = (host: Readonly<PhotoHdrMergeWorkflowHostCurrentV1>, signal?: AbortSignal, selected = true) => {
			checkRepairSignalV1(signal); checkRepairSignalV1(host.signal);
			if (!host.isCurrent() || selected && !isSelected()) throw new DOMException('HDR photo selection changed.', 'AbortError');
		};
		const acquire = async (host: Readonly<PhotoHdrMergeWorkflowHostCurrentV1>, selected = true): Promise<Native> => {
			checked(host, undefined, selected);
			const session = await host.acquire(); checked(host, undefined, selected);
			const child = session.hdrMergeCurrent;
			if (!child || child.schemaVersion !== 1 || native && child !== native) throw new Error('The selected HDR Session is unavailable or changed.');
			if (!native) {
				const input = record(child, 'selected HDR Session child', ['schemaVersion', 'readSelection', 'withPreview', 'merge']);
				const read = field(input, 'readSelection', 'selected HDR Session child'), preview = field(input, 'withPreview', 'selected HDR Session child'), merge = field(input, 'merge', 'selected HDR Session child');
				if (typeof read !== 'function' || typeof preview !== 'function' || typeof merge !== 'function') throw new TypeError('The selected HDR Session lacks complete native capabilities.');
				native = child;
				methods = Object.freeze<Native>({ schemaVersion: 1,
					readSelection: (request, options) => Reflect.apply(read, child, [request, options]) as ReturnType<Native['readSelection']>,
					withPreview: <Result,>(request: Parameters<Native['withPreview']>[0], consume: (view: Readonly<ImageHdrMergeAuthoringPreviewCurrentV1>) => Result | Promise<Result>, options?: Readonly<{ signal?: AbortSignal }>) => Reflect.apply(preview, child, [request, consume, options]) as Promise<Result>,
					merge: (request, options) => Reflect.apply(merge, child, [request, options]) as ReturnType<Native['merge']>,
				});
			}
			return methods!;
		};
		const run = async <Result,>(action: (host: Readonly<PhotoHdrMergeWorkflowHostCurrentV1>) => Promise<Result>, signal?: AbortSignal): Promise<Result> => {
			const state: { outcome?: Readonly<{ value: Result }> | Readonly<{ error: unknown }> } = {};
			const status = await execute(async host => { try { state.outcome = { value: await action(host) }; } catch (error) { state.outcome = { error }; throw error; } }, signal);
			if (state.outcome) { if ('error' in state.outcome) throw state.outcome.error; return state.outcome.value; }
			checkRepairSignalV1(signal); throw new Error(status === 'busy' ? 'A photo library operation is already pending.' : 'The HDR library generation is unavailable.');
		};
		const request = (options: Readonly<ImageHdrMergeAuthoringOptionsCurrentV1>) => {
			if (!selection || selection.sources.length !== options.exposureMultipliers.length) throw new Error('HDR source facts have not been captured.');
			return Object.freeze({ schemaVersion: 1 as const, inputs: Object.freeze(selection.sources.map((source, index) => Object.freeze({
				photoId: source.photoId, expectedRevision: source.revision, exposureMultiplier: options.exposureMultipliers[index]!,
			}))), referenceIndex: options.referenceIndex, alignment: options.alignment, deghost: options.deghost, fileName: options.fileName });
		};
		return Object.freeze<ImageHdrMergeAuthoringPortCurrentV1<PhotoLibraryImportItemV1>>({ schemaVersion: 1,
			async readSelection(options) {
				const signal = captureRepairSignalV1(options?.signal); checkRepairSignalV1(signal);
				return run(async host => {
					const port = await acquire(host), result = await port.readSelection({ schemaVersion: 1, photoIds: ids }, { signal: host.signal }); checked(host, signal);
					if (result.schemaVersion !== 1 || result.sources.length !== ids.length || result.sources.some((source, index) => source.photoId !== ids[index])) throw new TypeError('Native HDR source facts differ from the captured menu selection.');
					selection = Object.freeze({ ...result, sources: Object.freeze(result.sources.map(source => Object.freeze({ ...source }))),
						suggestedExposureMultipliers: result.suggestedExposureMultipliers ? Object.freeze([...result.suggestedExposureMultipliers]) : null });
					return Object.freeze({ schemaVersion: 1, sources: Object.freeze(selection.sources.map(source => Object.freeze({ key: `${source.photoId}@${source.revision}`,
						label: source.fileName, width: source.width, height: source.height, exposureSeconds: source.exposureSeconds, aperture: source.aperture, iso: source.iso }))),
						suggestedExposureMultipliers: selection.suggestedExposureMultipliers });
				}, signal);
			},
			async withPreview(options, consume, runtime) {
				const signal = captureRepairSignalV1(runtime?.signal); checkRepairSignalV1(signal); const captured = request(options);
				return run(async host => {
					const port = await acquire(host);
					const result = await port.withPreview(captured, view => { checked(host, signal); return consume(view); }, { signal: host.signal });
					checked(host, signal); return result;
				}, signal);
			},
			async merge(options, runtime) {
				const signal = captureRepairSignalV1(runtime?.signal); checkRepairSignalV1(signal); const captured = request(options), acknowledge = runtime?.onAcknowledged;
				const state: { acknowledged: Readonly<PhotoLibraryImportItemV1> | null; result: Awaited<ReturnType<Native['merge']>> | null; failed: Readonly<{ error: unknown }> | null } = { acknowledged: null, result: null, failed: null };
				const latch = (value: Readonly<PhotoLibraryImportItemV1>) => {
					const admitted = receipt(value);
					if (state.acknowledged) { if (JSON.stringify(admitted) !== JSON.stringify(state.acknowledged)) throw new TypeError('HDR publication changed its native acknowledgement.'); return; }
					state.acknowledged = admitted; acknowledge?.(admitted);
				};
				try { await run(async host => {
					const port = await acquire(host); state.result = await port.merge(captured, { signal: host.signal, onAcknowledged: latch });
					latch(state.result.receipt); checked(host, signal, false);
				}, signal); } catch (error) { state.failed = { error }; }
				if (state.acknowledged) {
					// The first operation has fully joined. A late cancelled caller
					// must not cancel refresh of an already durable publication.
					try { await run(async host => { await acquire(host, false); checked(host, undefined, false); await host.refresh(); checked(host, undefined, false); }); }
					catch (error) { state.failed = { error: state.failed && !Object.is(state.failed.error, error) ? new AggregateError([state.failed.error, error], 'HDR publication and library refresh failed.', { cause: state.failed.error }) : error }; }
				}
				if (state.failed) throw state.failed.error;
				if (!state.acknowledged || !state.result) throw new TypeError('HDR publication returned no native acknowledgement.');
				return Object.freeze({ acknowledgement: state.acknowledged, diagnostics: state.result.diagnostics });
			},
		});
	}, [execute]);
}
function id(value: unknown): string { if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)) throw new TypeError('HDR requires a selected photo identity.'); return value; }
function receipt(value: unknown): Readonly<PhotoLibraryImportItemV1> {
	const label = 'HDR native acknowledgement', input = record(value, label, ['index', 'fileName', 'photoId', 'status', 'reusedOriginal', 'message', 'hasMetadataNotices']);
	const index = field(input, 'index', label), fileName = field(input, 'fileName', label), message = field(input, 'message', label), reusedOriginal = field(input, 'reusedOriginal', label), hasMetadataNotices = field(input, 'hasMetadataNotices', label);
	if (index !== 0 || field(input, 'status', label) !== 'imported' || typeof fileName !== 'string' || fileName.length < 1 || fileName.length > 240
		|| message !== null && typeof message !== 'string' || typeof reusedOriginal !== 'boolean' || typeof hasMetadataNotices !== 'boolean') throw new TypeError('HDR requires a positive native publication acknowledgement.');
	return Object.freeze({ index: 0, fileName, photoId: id(field(input, 'photoId', label)), status: 'imported', reusedOriginal, message, hasMetadataNotices });
}
