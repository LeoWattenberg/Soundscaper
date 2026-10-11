/* SPDX-License-Identifier: AGPL-3.0-only */
import { normalizeMotionAeGaussianProfile, type MotionAeGaussianProfile } from './motion-ae-gaussian-profile.ts';
import type { MotionAeComposition, MotionAeExchange, MotionAeFootage, MotionAeReportEntry } from './motion-ae-exchange-types.ts';
import type { MotionAeRenderedComposition } from './motion-ae-host-render.ts';
import { stringifyMotionAeHostJson } from './motion-ae-host-json.ts';
export interface MotionAeExportTransaction {
	copyMedia(footage: MotionAeFootage): void;
	/** Optional, explicitly selected whole-composition render into this new package. */
	render?(compositions: readonly MotionAeComposition[]): MotionAeRenderedComposition;
	/** Publish motionae.json last, only after every retained file has copied successfully. */
	publish(manifest: string): void;
	/** Remove only newly-created package files. Never remove or overwrite original sources. */
	rollback(): void;
}
export interface MotionAeExportHost {
	readonly gaussianProfile?: MotionAeGaussianProfile;
	readonly version: string; readonly projectName: string; readonly color: MotionAeExchange['color'];
	compositions(report: MotionAeReportEntry[]): readonly MotionAeComposition[];
	footage(report: MotionAeReportEntry[]): readonly MotionAeFootage[];
	checkCancelled(): void;
	begin(transferId: string): MotionAeExportTransaction;
}
export function exportMotionAeHostProject(host: MotionAeExportHost, transferId: string): MotionAeExchange {
	if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(transferId)) throw new Error('AE transfer identity is invalid.');
	host.checkCancelled();
	const report: MotionAeReportEntry[] = [{ scopeId: transferId, propertyPath: '', status: 'unsupported', code: 'qualification',
		message: 'This development bridge has not been qualified in installed After Effects. Review the transfer report and compare the result before using it.' }];
	const transaction = host.begin(transferId);
	try {
		const compositions = host.compositions(report); let footage = host.footage(report);
		if (compositions.length > 256 || footage.length > 4096 || report.length > 65_536) throw new Error('AE bridge item/report budget exceeded.');
		let totalBytes = 0, totalLayers = 0;
		for (let index = 0; index < compositions.length; index++) {
			totalLayers += compositions[index]!.layers.length;
			if (totalLayers > 4096) throw new Error('AE bridge layer budget exceeded.');
		}
		for (let index = 0; index < footage.length; index++) {
			host.checkCancelled(); const item = footage[index]!;
			if (item.path === null) continue;
			totalBytes += item.byteLength ?? 0;
			if (totalBytes > 274_877_906_944) throw new Error('AE bridge media byte budget exceeded.'); transaction.copyMedia(item);
		}
		if (transaction.render) {
			host.checkCancelled(); const rendered = transaction.render(compositions); footage = footage.concat(rendered.footage);
			for (let index = 0; index < rendered.report.length; index++) report.push(rendered.report[index]!);
			for (let index = 0; index < rendered.footage.length; index++) totalBytes += rendered.footage[index]!.byteLength ?? 0;
			if (footage.length > 4096 || report.length > 65_536 || totalBytes > 274_877_906_944) throw new Error('AE rendered package item/report/media budget exceeded.');
		}
		const exchange: MotionAeExchange = { format: 'org.motionscaper.ae-exchange', version: 1, transferId,
			producer: { application: 'after-effects', version: host.version, bridgeVersion: '0.1.0' }, source: { name: host.projectName, revisionDigest: null },
			color: host.color, compositions, footage, report, ...(host.gaussianProfile ? { gaussianProfile: normalizeMotionAeGaussianProfile(host.gaussianProfile) } : {}) };
		host.checkCancelled(); const serialized = stringifyMotionAeHostJson(exchange); host.checkCancelled(); transaction.publish(serialized); return exchange;
	} catch (error) {
		try { transaction.rollback(); } catch (cleanup) {
			const cause = { primary: error, cleanup }, failure = new Error('AE transfer failed: ' + String(error) + '; package cleanup failed: ' + String(cleanup), { cause });
			failure.cause = cause; // Older ExtendScript Error constructors ignore the optional options argument.
			throw failure;
		}
		throw error;
	}
}
