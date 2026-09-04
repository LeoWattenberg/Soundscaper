/* SPDX-License-Identifier: AGPL-3.0-only */
import { admitBrowserExportBlob } from '../browser-export-output.ts';
import { createExportChapterPlan } from '../export-chapters.ts';
import type { DeliveryConformanceFinding } from '../delivery-conformance.ts';

// Legacy JavaScript ports are narrowed as their owning services migrate.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RuntimeValue = any;

interface StreamingStemArchiveExport {
	readonly conformance: readonly DeliveryConformanceFinding[];
	readonly blob: Blob;
	readonly fileName: string;
	readonly cleanup: RuntimeValue;
}

/**
 * Deliver every output of a stem or chapter plan into one archive the browser
 * downloads.
 *
 * A stem is one track of the project over the delivery's single range; a
 * chapter is the whole mix over a span of its own, so it renders the export
 * project under a plan that names that span. Either way each output is a file
 * the reader can reopen, so each is conformed from its own bytes before it
 * joins the archive rather than the archive being conformed once at the end.
 */
export async function streamStemArchiveExport({
	abortSignal,
	admitOutputBytes,
	conformExport,
	copy,
	createStreamingStemArchive,
	exportProject,
	exportRenderSources,
	plan,
	renderAndEncode,
	reportProgress,
	settings,
	stemProject,
	throwIfAborted,
}: {
	abortSignal: RuntimeValue,
	admitOutputBytes: number,
	conformExport: (
		plan: RuntimeValue, encoded: RuntimeValue, start: number, end: number,
	) => Promise<readonly DeliveryConformanceFinding[]>,
	copy: RuntimeValue,
	createStreamingStemArchive: RuntimeValue,
	exportProject: RuntimeValue,
	exportRenderSources: RuntimeValue,
	plan: RuntimeValue,
	renderAndEncode: RuntimeValue,
	reportProgress: (progress: number) => void,
	settings: RuntimeValue,
	stemProject: RuntimeValue,
	throwIfAborted: (signal: RuntimeValue) => void,
}): Promise<StreamingStemArchiveExport> {
	if (!plan.archive) throw new Error('The stem export plan has no archive descriptor.');
	const archive = await createStreamingStemArchive(plan.archive, copy);
	try {
		const findings: DeliveryConformanceFinding[] = [];
		const chapters = plan.mode === 'chapters';
		for (let index = 0; index < plan.outputs.length; index += 1) {
			throwIfAborted(abortSignal);
			const output = plan.outputs[index];
			const snapshot = chapters ? exportProject : stemProject(exportProject, output.trackId);
			const outputPlan = chapters ? createExportChapterPlan(plan, output) : plan;
			const encoded = await renderAndEncode(snapshot, outputPlan, settings, abortSignal, exportRenderSources, output, {
				start: index / plan.outputs.length,
				end: (index + 1) / plan.outputs.length,
			});
			try {
				findings.push(...await conformExport(
					outputPlan, encoded, index / plan.outputs.length, (index + 1) / plan.outputs.length,
				));
				await archive.add(output.fileName, encoded.blob || encoded.bytes, abortSignal);
			} finally {
				await encoded.cleanup?.();
			}
			reportProgress((index + 1) / plan.outputs.length);
		}
		const result = await archive.finish();
		return {
			conformance: Object.freeze(findings),
			blob: admitBrowserExportBlob(result.blob, 'Audio stem archive', admitOutputBytes),
			fileName: plan.archive.fileName,
			cleanup: result.cleanup,
		};
	} catch (error) {
		await archive.abort();
		throw error;
	}
}
