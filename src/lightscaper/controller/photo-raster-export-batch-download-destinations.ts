/* SPDX-License-Identifier: AGPL-3.0-only */

import type { BrowserFileSaveRequest, BrowserSavedFile, PreparedBrowserSave } from '../../common/editor/browser-file-save-service.ts';
import type { PhotoRasterExportBatchV1, PhotoRasterExportBatchMemberV1 } from './photo-raster-export-batch-v1.ts';
import type { PhotoRasterExportBatchDestinations } from './photo-raster-export-batch-queue.ts';

/** Capture explicit download targets in the initial Start gesture. No member
 * may request a deferred picker or claim browser downloads as durable saves. */
export function createPhotoRasterBatchDownloadDestinations(plan: Readonly<PhotoRasterExportBatchV1>, runtime: unknown): Readonly<PhotoRasterExportBatchDestinations> {
	const pin = <Method>(key: string): Method => {
		if (!runtime || typeof runtime !== 'object') throw new TypeError('Photo downloads require a save runtime.');
		const descriptor = Object.getOwnPropertyDescriptor(runtime, key), fn: unknown = descriptor?.value;
		if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof fn !== 'function') throw new TypeError('Photo downloads require own save capabilities.');
		return ((...args: unknown[]) => Reflect.apply(fn, runtime, args) as unknown) as Method;
	};
	const prepare = pin<(request: BrowserFileSaveRequest) => PreparedBrowserSave | PromiseLike<PreparedBrowserSave>>('prepareSave');
	const save = pin<(request: BrowserFileSaveRequest) => BrowserSavedFile | PromiseLike<BrowserSavedFile>>('saveFile');
	const sidecarEnabled = plan.sidecarEnabled === true;
	const targets = new Map(plan.members.map(member => [member, Object.freeze({
		image: Object.freeze({ browserDownload: true, name: member.fileName }),
		sidecar: sidecarEnabled ? Object.freeze({ browserDownload: true, name: member.fileName + '.lightscaper.json' }) : null,
	})]));
	const pending = new Set<Promise<unknown>>(); let closed = false, retirement: Promise<void> | null = null;
	const requestFor = (member: Readonly<PhotoRasterExportBatchMemberV1>, request: BrowserFileSaveRequest, sidecar = false): BrowserFileSaveRequest => {
		if (closed) throw new DOMException('Photo download destinations retired.', 'AbortError');
		const memberTargets = targets.get(member);
		if (!memberTargets) throw new TypeError('Photo download member is outside the captured plan.');
		const target = sidecar ? memberTargets.sidecar : memberTargets.image;
		if (!target) throw new TypeError('Photo companion download was not requested.');
		return { ...request, target, suggestedName: target.name, fileName: target.name, useFileSystemAccess: false };
	};
	const join = <Result>(invoke: () => Result | PromiseLike<Result>): Promise<Result> => {
		const work = Promise.resolve(invoke()); pending.add(work);
		void work.then(() => { pending.delete(work); }, () => { pending.delete(work); }); return work;
	};
	return Object.freeze<PhotoRasterExportBatchDestinations>({
		prepareSave(member, request) { const captured = requestFor(member, request); return join(() => prepare(captured)); },
		saveFile(member, request) { const captured = requestFor(member, request); return join(() => save(captured)); },
		...(sidecarEnabled ? { saveSidecar(member: Readonly<PhotoRasterExportBatchMemberV1>, request: BrowserFileSaveRequest) { const captured = requestFor(member, request, true); return join(() => save(captured)); } } : {}),
		retireAndJoin() {
			if (retirement) return retirement;
			closed = true;
			retirement = Promise.allSettled([...pending]).then(results => {
				const failed = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
				if (failed.length === 1) throw failed[0]!.reason;
				if (failed.length > 1) throw new AggregateError(failed.map(result => result.reason), 'Photo download destinations did not settle.');
			}); return retirement;
		},
	});
}
