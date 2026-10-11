/* SPDX-License-Identifier: AGPL-3.0-only */
import { admitMotionAeCustodyInput, normalizeMotionAeConversionReport, normalizeMotionAeExchange } from './motion-ae-exchange.ts';
import type { MotionAeExchange, MotionAeReportEntry } from './motion-ae-exchange-types.ts';
import type { MotionAsset } from './motion-asset.ts';
import { freezeMotionValue, motionArray, motionDigest, motionId, motionInteger, motionRecord } from './motion-values.ts';

/** Inert source intent and original media links, carried by normal saved revisions and .mscape archives. */
export interface MotionAeProjectCustody {
	readonly format: 'org.motionscaper.ae-project-custody'; readonly version: 1;
	readonly exchange: MotionAeExchange; readonly report: readonly MotionAeReportEntry[];
	readonly media: readonly { readonly sourceId: string; readonly assetId: string; readonly sha256: string; readonly byteLength: number }[];
}

/** Inspect a data descriptor without invoking a getter, before the generic project traversal. */
export function admitMotionProjectCustody(value: unknown): void {
	if (value === null || typeof value !== 'object') return;
	const field = Object.getOwnPropertyDescriptor(value, 'interchangeCustody');
	if (field && Object.hasOwn(field, 'value')) admitMotionAeCustodyInput(field.value as unknown);
}

export function normalizeMotionAeProjectCustody(value: unknown, assets: readonly MotionAsset[]): MotionAeProjectCustody {
	admitMotionAeCustodyInput(value);
	const record = motionRecord(value, ['format', 'version', 'exchange', 'report', 'media'], 'Motion interchange custody');
	if (record.format !== 'org.motionscaper.ae-project-custody' || record.version !== 1) throw new Error('Motion interchange custody format/version is unsupported.');
	const exchange = normalizeMotionAeExchange(record.exchange), report = normalizeMotionAeConversionReport(record.report, exchange);
	const media = motionArray(record.media, 4096, 'AE custody media').map((item) => {
		const entry = motionRecord(item, ['sourceId', 'assetId', 'sha256', 'byteLength'], 'AE custody media binding');
		return { sourceId: motionId(entry.sourceId), assetId: motionId(entry.assetId), sha256: motionDigest(entry.sha256), byteLength: motionInteger(entry.byteLength, 'AE custody original media bytes', 1) };
	});
	const sourceIds = new Set<string>(); const byAsset = new Map(assets.map((asset) => [asset.id, asset]));
	for (const binding of media) {
		const source = exchange.footage.find((item) => item.id === binding.sourceId), asset = byAsset.get(binding.assetId);
		if (sourceIds.has(binding.sourceId) || !source || source.path === null || !asset || asset.kind === 'font'
			|| source.byteLength !== asset.byteLength || binding.byteLength !== asset.byteLength || binding.sha256 !== asset.sha256
			|| (source.sha256 !== null && source.sha256 !== asset.sha256)) throw new Error('AE custody original media binding is incomplete or changed.');
		sourceIds.add(binding.sourceId);
	}
	if (sourceIds.size !== exchange.footage.length) throw new Error('Every original AE media file must be retained as a verified project asset. Relink missing media or use a supported inert carrier before importing.');
	const result: MotionAeProjectCustody = { format: record.format, version: 1, exchange, report, media };
	if (new TextEncoder().encode(JSON.stringify(result)).byteLength > 16 * 1024 * 1024) throw new RangeError('AE project custody exceeds its 16 MiB serialized budget.');
	return freezeMotionValue(result);
}
