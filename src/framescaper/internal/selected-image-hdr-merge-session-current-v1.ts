/* SPDX-License-Identifier: AGPL-3.0-only */
import { readClosedDomainArray as array, readClosedDomainField as field, readClosedDomainRecord as record } from '../../common/editor/closed-domain-value.ts';
import type { ImageHdrMergeAuthoringPortCurrentV1, ImageHdrMergeAuthoringSelectionCurrentV1 } from '../../common/editor/image-hdr-merge-authoring-port-current-v1.ts';
import type { PixelFrameV1 } from '../../common/editor/imaging/pixel-frame-contract-v1.ts';
import { prepareImageHdrMergeV1 } from '../../common/editor/imaging/image-hdr-merge-contract-v1.ts';
import { captureRepairSignalV1, checkRepairSignalV1 } from '../../common/editor/imaging/pixel-frame-repair-lifetime-v1.ts';
import { suspendVideoPreviewForAuthoringV1 } from '../../common/editor/controller/clip-video/video-preview-authoring-suspension-v1.ts';
import { prepareFramescaperHdrMergeCanonicalSourceCurrentV1, withFramescaperHdrMergeCanonicalSourceCurrentV1, prepareFramescaperHdrMergeResultNameCurrentV1 } from './image-hdr-merge-frame-source-current-v1.ts';
import { createStableId } from '../../common/editor/stable-id.js';
import { sameProjectSnapshot } from '../../common/editor/storage/project-snapshot-equality.ts';
import { cloneFramescaperProject } from '../editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../editor-project-runtime-profile.ts';
import { createFramescaperTimelineImageHdrCurrentProjectPublicationV1 } from '../editor-timeline-image-current-project-publication-timeline-image.ts';
import type { ImageHdrMergePortsCurrentV1 } from '../../common/editor/controller/shared/image-hdr-merge-current-v1.ts';
import type { CapturedFramescaperImageHdrMergeBindingCurrentV1, FramescaperImageHdrMergeAcknowledgementCurrentV1, FramescaperImageHdrMergeSessionCurrentV1 } from '../editor-selected-image-hdr-merge-current-v1.ts';

const JOIN = AbortSignal.any.bind(AbortSignal);

/** Optional native owner. All external methods and the selected project were
 * captured synchronously by the menu-facing registry before loading this code. */
export async function openFramescaperImageHdrMergeSessionCurrentV1(binding: Readonly<CapturedFramescaperImageHdrMergeBindingCurrentV1>,
	input: Readonly<{ project: unknown; signal?: AbortSignal }>): Promise<Readonly<FramescaperImageHdrMergeSessionCurrentV1>> {
	const { controller, snapshot, store } = binding;
	const adoption = createFramescaperTimelineImageHdrCurrentProjectPublicationV1(binding.publication);
	const createId = binding.createId ?? createStableId, stage = binding.withStaging;
	const external = captureRepairSignalV1(input.signal), stop = new AbortController(), signal = external ? JOIN([external, stop.signal]) : stop.signal;
	const checkSignal = () => { checkRepairSignalV1(signal); }; checkSignal();
	const project = cloneFramescaperProject(PROFILE, input.project), selected = array(project.selection.clipIds, 'Frame HDR selected clips', 2, 9);
	const ids = selected.map(value => { if (typeof value !== 'string') throw new TypeError('Frame HDR requires exact selected clip IDs.'); return value; });
	if (new Set(ids).size !== ids.length) throw new RangeError('Frame HDR selection contains duplicate clips.');
	const plans = ids.map(id => {
		const clip = project.clips.find(value => value.id === id);
		const source = clip && project.sources.find(value => value.id === clip.sourceId);
		if (clip?.kind !== 'image' || source?.kind !== 'image') throw new RangeError('Frame HDR requires selected still image Originals.');
		return prepareFramescaperHdrMergeCanonicalSourceCurrentV1(source);
	});
	if (new Set(plans.map(value => value.source.id)).size !== plans.length) throw new RangeError('Frame HDR requires distinct canonical source Originals.');
	if (plans.some(value => value.descriptor.width !== plans[0]!.descriptor.width || value.descriptor.height !== plans[0]!.descriptor.height)) throw new RangeError('Frame HDR canonical Original extents must match.');
	let sealed = false, publishing = false, closing: Promise<void> | undefined;
	const pending = new Set<Promise<unknown>>();
	const isCurrent = () => {
		if (sealed || publishing) return false;
		try { checkSignal(); const state = snapshot(); return state.readOnly !== true && state.importing !== true
			&& sameProjectSnapshot(cloneFramescaperProject(PROFILE, controller.project), project); } catch { return false; }
	};
	const current = () => { checkSignal(); if (!isCurrent()) throw new Error('The selected Frame HDR project or selection changed.'); };
	// Selection changes do not dirty the editor. Join the existing forced save
	// before native work so both the root and its revision match our exact CAS.
	current(); await binding.prepareCurrentProject(); current();
	const suspension = await suspendVideoPreviewForAuthoringV1(controller, signal);
	try { current(); } catch (error) { suspension.release(); throw error; }
	const rows = Object.freeze(plans.map((value, index) => Object.freeze({ key: ids[index]!, label: value.source.original.fileName,
		width: value.descriptor.width, height: value.descriptor.height, exposureSeconds: null, aperture: null, iso: null })));
	const authoringSelection: Readonly<ImageHdrMergeAuthoringSelectionCurrentV1> = Object.freeze({ schemaVersion: 1, sources: rows, suggestedExposureMultipliers: null });
	const selection = Object.freeze({ projectId: project.id, revision: project.revision, inputs: rows });
	const launch = <Result>(admitted: AbortSignal, run: () => Promise<Result>): Promise<Result> => {
		if (sealed || pending.size) return Promise.reject(new Error('Frame HDR authoring is closed or already has pending work.'));
		const work = Promise.resolve().then(() => { checkRepairSignalV1(admitted); current(); return run(); }); pending.add(work);
		void work.then(() => { pending.delete(work); }, () => { pending.delete(work); }); return work;
	};
	const capture = (value: unknown, callOptions: Readonly<{ signal?: AbortSignal }>) => {
		const caller = captureOptionsSignal(callOptions), admitted = caller ? JOIN([signal, caller]) : signal; checkRepairSignalV1(admitted); current();
		const raw = record(value, 'Frame HDR authored options', ['schemaVersion', 'referenceIndex', 'exposureMultipliers', 'alignment', 'deghost', 'fileName']);
		if (field(raw, 'schemaVersion', 'Frame HDR authored options') !== 1) throw new RangeError('Unsupported Frame HDR authored options version.');
		const ratios = array(field(raw, 'exposureMultipliers', 'Frame HDR authored options'), 'Frame HDR exposures', plans.length, plans.length);
		const numerical = prepareImageHdrMergeV1({ schemaVersion: 1, referenceIndex: field(raw, 'referenceIndex', 'Frame HDR authored options'),
			alignment: field(raw, 'alignment', 'Frame HDR authored options'), deghost: field(raw, 'deghost', 'Frame HDR authored options'),
			inputs: plans.map((plan, index) => ({ descriptor: plan.descriptor, exposureMultiplier: ratios[index] })) });
		const fileName = prepareFramescaperHdrMergeResultNameCurrentV1(field(raw, 'fileName', 'Frame HDR authored options'));
		const request = Object.freeze({ schemaVersion: 1, referenceIndex: numerical.referenceIndex, alignment: numerical.alignment, deghost: numerical.deghost, signal: admitted,
			inputs: Object.freeze(plans.map((plan, index) => Object.freeze({ product: 'framescaper', ownerId: project.id, sourceId: plan.source.id, revision: project.revision,
				original: { fileName: plan.source.original.fileName, mimeType: plan.source.original.mimeType, sha256: plan.source.original.sha256,
					byteLength: plan.source.original.byteLength, width: plan.descriptor.width, height: plan.descriptor.height },
				descriptor: plan.descriptor, exposureMultiplier: numerical.inputs[index]!.exposureMultiplier }))) });
		const ports: Readonly<ImageHdrMergePortsCurrentV1> = Object.freeze({
			withCanonicalFrame: <Result>(index: number, consume: (frame: Readonly<PixelFrameV1>) => Result | Promise<Result>, nativeSignal?: AbortSignal) => {
				current(); const plan = plans[index]; if (!plan) throw new RangeError('Frame HDR canonical index is outside its captured selection.');
				return withFramescaperHdrMergeCanonicalSourceCurrentV1(plan, store, consume, { signal: nativeSignal ?? admitted, assertCurrent: current });
			}, ...(stage ? { withStaging: stage } : {}),
		});
		return { admitted, fileName, request, ports };
	};
	const withPreview: FramescaperImageHdrMergeSessionCurrentV1['withPreview'] = async (value, consume, callOptions = {}) => {
		const captured = capture(value, callOptions);
		if (typeof consume !== 'function') return Promise.reject(new TypeError('Frame HDR Preview requires a scoped consumer.'));
		return launch(captured.admitted, async () => {
			const { withMergedImageHdrPreviewCurrentV1 } = await import('../../common/editor/controller/shared/image-hdr-merge-preview-current-v1.ts'); current();
			const result = await withMergedImageHdrPreviewCurrentV1(captured.request, captured.ports, async view => {
				current(); const result = await consume(view); current(); return result;
			}); current(); return result;
		});
	};
	const merge: FramescaperImageHdrMergeSessionCurrentV1['merge'] = async (value, callOptions = {}) => {
		const signalProperty = Object.getOwnPropertyDescriptor(callOptions, 'signal');
		if (signalProperty && !Object.hasOwn(signalProperty, 'value')) throw new TypeError('Frame HDR signal must be own data.');
		const caller = captureRepairSignalV1(signalProperty?.value);
		const call = record(callOptions, 'Frame HDR merge options', ['signal', 'onAcknowledged'], []);
		const notify = Object.hasOwn(call, 'onAcknowledged') ? field(call, 'onAcknowledged', 'Frame HDR merge options') : undefined;
		if (notify !== undefined && typeof notify !== 'function') return Promise.reject(new TypeError('Frame HDR acknowledgement requires an inert callback.'));
		const captured = capture(value, caller ? { signal: caller } : {});
		const sourceId = createId('image-source'), clipId = createId('image-clip');
		return launch(captured.admitted, async () => {
			const { withMergedImageHdrOriginalCurrentV1 } = await import('../../common/editor/controller/shared/image-hdr-merge-current-v1.ts'); current();
			const { withFramescaperHdrMergeResultCurrentV1 } = await import('./image-hdr-merge-frame-result-current-v1.ts'); current();
			let committed: Readonly<FramescaperImageHdrMergeAcknowledgementCurrentV1> | undefined;
			try {
				await withMergedImageHdrOriginalCurrentV1(captured.request, captured.ports, async merged => {
					current(); await withFramescaperHdrMergeResultCurrentV1({ merged, project, sourceId, clipId, fileName: captured.fileName, signal: captured.admitted }, async result => {
						current(); const adopted = await adoption.publish({ project, source: result.source, clip: result.clip, bytes: result.bytes,
							command: result.command as Parameters<typeof adoption.publish>[0]['command'], signal: captured.admitted });
						committed = Object.freeze({ schemaVersion: 1, projectId: adopted.project.id, revision: adopted.project.revision,
							sourceId, clipId, diagnostics: merged.diagnostics, notices: adopted.notices,
							...(Object.hasOwn(adopted, 'retirementFailure') ? { retirementFailure: adopted.retirementFailure } : {}) }); publishing = true;
					});
				});
			} catch (retirementFailure) {
				if (!committed) throw retirementFailure;
				const previous = committed.retirementFailure;
				const failure = Object.hasOwn(committed, 'retirementFailure') && !Object.is(previous, retirementFailure)
					? new AggregateError([previous, retirementFailure], 'Committed HDR adoption and native retirement failed.', { cause: previous }) : retirementFailure;
				committed = Object.freeze({ ...committed, notices: Object.freeze([...committed.notices, 'HDR was saved. A later authoring retirement failed.']), retirementFailure: failure });
			}
			if (!committed) throw new Error('Frame HDR has no genuine project acknowledgement.');
			if (notify) Reflect.apply(notify, callOptions, [committed]); return committed;
		});
	};
	const port: Readonly<ImageHdrMergeAuthoringPortCurrentV1<FramescaperImageHdrMergeAcknowledgementCurrentV1>> = Object.freeze({ schemaVersion: 1,
		async readSelection(readOptions = {}) { captureOptionsSignal(readOptions); current(); return authoringSelection; }, withPreview,
		async merge(value: Parameters<ImageHdrMergeAuthoringPortCurrentV1<FramescaperImageHdrMergeAcknowledgementCurrentV1>['merge']>[0],
			callOptions?: Parameters<ImageHdrMergeAuthoringPortCurrentV1<FramescaperImageHdrMergeAcknowledgementCurrentV1>['merge']>[1]) {
			const acknowledgement = await merge(value, callOptions); return Object.freeze({ acknowledgement, diagnostics: acknowledgement.diagnostics });
		},
	});
	return Object.freeze({ selection, port, isCurrent, withPreview, merge,
		closeAndJoin() {
			if (closing) return closing; sealed = true; stop.abort(new Error('Frame HDR authoring scope retired.'));
			closing = (async () => { await Promise.allSettled([...pending]); suspension.release(); })(); return closing;
		},
	});
}

function captureOptionsSignal(value: Readonly<{ signal?: AbortSignal }>): AbortSignal | undefined {
	const descriptor = Object.getOwnPropertyDescriptor(value, 'signal');
	if (descriptor && !Object.hasOwn(descriptor, 'value')) throw new TypeError('Frame HDR signal must be own data.');
	const signal = captureRepairSignalV1(descriptor?.value); record(value, 'Frame HDR operation options', ['signal'], []); return signal;
}
