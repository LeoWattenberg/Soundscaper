/* SPDX-License-Identifier: AGPL-3.0-only */
import { motionDocumentFileName } from '../../../../motionscaper/editor-document-file-name.ts';
import type { MotionDeliveryIntent } from '../../../../motionscaper/editor-delivery-queue.ts';
interface StreamingPicker { showSaveFilePicker?(options: { suggestedName: string; types: readonly { description: string; accept: Record<string, string[]> }[] }): Promise<FileSystemFileHandle> }
export function motionRenderFileName(title: string, format: MotionDeliveryIntent['format']): string {
	return motionDocumentFileName(title).replace(/\.mscape$/u, `.${format === 'png' ? 'tar' : format === 'prores' ? 'mov' : format}`);
}
/** Called directly by a user command so browser picker activation is retained. */
export async function chooseMotionRenderDestination(title: string, format: MotionDeliveryIntent['format'], description: string): Promise<WritableStream<Uint8Array> | undefined> {
	const picker = globalThis as StreamingPicker; if (format === 'prores' || !picker.showSaveFilePicker) return undefined;
	const fileName = motionRenderFileName(title, format); const extension = fileName.slice(fileName.lastIndexOf('.'));
	const handle = await picker.showSaveFilePicker({ suggestedName: fileName, types: [{ description, accept: { [format === 'png' ? 'application/x-tar' : `video/${format}`]: [extension] } }] });
	return handle.createWritable();
}
export function downloadMotionRender(blob: Blob, title: string, format: MotionDeliveryIntent['format']): void {
	const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = motionRenderFileName(title, format);
	document.body.append(link); link.click(); link.remove(); globalThis.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
