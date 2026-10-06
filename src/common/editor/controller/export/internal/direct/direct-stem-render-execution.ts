/* SPDX-License-Identifier: AGPL-3.0-only */
import { streamDirectStemArchive, type DirectStemArchiveDestination, type DirectStemArchiveOutput } from './direct-stem-archive-export.ts';
import type { AudioExportRenderOptions, ExportEncodedOutput } from '../audio/audio-export-render-orchestration.ts';
import { admitDirectStemPipeline } from './direct-stem-pipeline-admission.ts';
import { createOwnedStemRenderer, supportsOwnedStemRendering, type OwnedStemRenderResources } from '../archive/owned-stem-renderer.ts';
import { createMonotonicStemPresentation, type StemPresentationPorts } from '../archive/owned-stem-progress.ts';
import { renderConformedStem } from '../archive/render-conformed-stem.ts';
import { conformDeliveredExport } from '../delivery/delivery-conformance-action.ts';
import type { DeliveryConformanceFinding, DeliveryConformancePlan } from '../../../../delivery-conformance.ts';

interface StemOutput extends DirectStemArchiveOutput { readonly includeMaster?: boolean; readonly respectMuteSolo?: boolean }
interface StemSnapshot { readonly sampleRate: number; readonly masterChannels: number }
type StemPlan = AudioExportRenderOptions['plan'] & DeliveryConformancePlan & Readonly<{ outputs: readonly StemOutput[] }>;
type Awaitable<Value> = PromiseLike<Value> | Value;

/** The existing producer plus an admitted private following-render producer; archive authority remains in the prepared destination. */
export async function executeDirectStemRenderArchive(options: Readonly<{
	destination: DirectStemArchiveDestination; plan: StemPlan; snapshot: StemSnapshot;
	settings: AudioExportRenderOptions['settings']; renderSources: AudioExportRenderOptions['renderSources'];
	signal: AbortSignal; assertCurrent: () => void; resources: OwnedStemRenderResources;
	presentation: StemPresentationPorts; getPerformanceOptimizationMode?: () => unknown;
	preflightStorage(bytes: number, kind: 'export'): Promise<unknown>;
	stemProject(snapshot: StemSnapshot, trackId: string): StemSnapshot;
	renderSequential(snapshot: StemSnapshot, output: StemOutput, index: number): Awaitable<ExportEncodedOutput>;
	conformSequential(plan: StemPlan, encoded: ExportEncodedOutput, start: number, end: number): Promise<readonly DeliveryConformanceFinding[]>;
}>) {
	const { plan } = options; const presentation = createMonotonicStemPresentation(options.presentation);
	const renderInputs = (): string => JSON.stringify([plan, options.settings, options.snapshot.sampleRate, options.snapshot.masterChannels]);
	let capturedInputs: string | null = null;
	const assertOwnedCurrent = (): void => {
		options.signal.throwIfAborted(); options.assertCurrent();
		if (renderInputs() !== capturedInputs) throw new Error('The admitted stem rendering inputs changed during export.');
	};
	const findings: DeliveryConformanceFinding[] = [];
	const outputFor = (output: DirectStemArchiveOutput, index: number): StemOutput => {
		const rendered = plan.outputs[index];
		if (!rendered || rendered.trackId !== output.trackId || rendered.fileName !== output.fileName) throw new Error('The direct stem archive output changed before rendering.');
		return rendered;
	};
	let preference: unknown;
	try { if (typeof options.getPerformanceOptimizationMode === 'function') preference = options.getPerformanceOptimizationMode(); } catch { /* Optional preference ports cannot change the sequential producer. */ }
	let admission = admitDirectStemPipeline(plan, options.snapshot, preference);
	if (admission) { try { capturedInputs = renderInputs(); } catch { /* Non-JSON injected inputs retain the sequential producer. */ } }
	if (typeof presentation.task?.setPhase !== 'function' || typeof presentation.task.update !== 'function'
		|| !supportsOwnedStemRendering(options.resources) || capturedInputs === null) admission = null;
	if (admission) {
		try { await options.preflightStorage(admission.temporaryBytes, 'export'); }
		catch { options.signal.throwIfAborted(); options.assertCurrent(); admission = null; }
		if (admission) assertOwnedCurrent();
		if (admission && !presentation.task.setPhase('Rendering', { start: 0, end: 1, value: 0 }, { key: 'rendering' })) admission = null;
	}
	const result = await streamDirectStemArchive({ destination: options.destination, plan, signal: options.signal, assertCurrent: admission ? assertOwnedCurrent : options.assertCurrent,
		async renderStem(output, index) {
			const target = outputFor(output, index);
			const { encoded, conformance } = await renderConformedStem({
				render: () => options.renderSequential(options.stemProject(options.snapshot, target.trackId), target, index),
				conform: (candidate) => options.conformSequential(plan, candidate, index / plan.outputs.length, (index + 1) / plan.outputs.length),
			});
			findings.push(...conformance); return encoded;
		},
		renderOneAhead: admission ? async (output, index, signal) => {
			const target = outputFor(output, index); const owned = createOwnedStemRenderer(options.resources, presentation, signal);
			const assertCurrent = (): void => { signal.throwIfAborted(); assertOwnedCurrent(); };
			try {
				const { encoded, conformance } = await renderConformedStem({
					render: () => owned.render({ snapshot: options.stemProject(options.snapshot, target.trackId), plan, settings: options.settings,
						renderSources: options.renderSources, renderTarget: target, assertDirectCurrent: assertCurrent,
						progressRange: { start: index / plan.outputs.length, end: (index + 1) / plan.outputs.length } }),
					async conform(candidate) {
						assertCurrent(); owned.progress.reportAbsolute((index + .92) / plan.outputs.length);
						const conformance = await conformDeliveredExport(plan, candidate);
						assertCurrent(); owned.progress.reportAbsolute((index + .98) / plan.outputs.length); return conformance;
					},
				});
				findings.push(...conformance); return encoded;
			} finally { owned.progress.dispose(); }
		} : undefined,
		onStemComplete(progress) { presentation.reportProgress(progress); },
	});
	return Object.freeze({ result, conformance: Object.freeze(findings) });
}
