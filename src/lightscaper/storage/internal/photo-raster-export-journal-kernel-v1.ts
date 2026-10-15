/* SPDX-License-Identifier: AGPL-3.0-only */
import { readClosedDomainArray as array, readClosedDomainField as field, readClosedDomainRecord as record } from '../../../common/editor/closed-domain-value.ts';
import { IMAGE_DEVELOP_LIMITS_V1 } from '../../../common/editor/imaging/image-develop-contract-v1.ts';
import type { PhotoRasterExportBatchMemberV1, PhotoRasterExportBatchV1 } from '../../controller/photo-raster-export-batch-v1.ts';
import type { PhotoRasterExportBatchCurrentV1 } from '../../controller/photo-raster-export-batch-current-v1.ts';
import type { PhotoRasterExportProfileV1 } from '../../controller/photo-raster-export-contract-v1.ts';
import { capturePhotoRasterExportBatchForProfileV1 } from '../../controller/internal/photo-raster-export-batch-kernel-v1.ts';
import type { PhotoRasterExportJournalCurrentV1 } from '../photo-raster-export-journal-current-v1.ts';

export const PHOTO_RASTER_EXPORT_SIDECAR_MAXIMUM_BYTES_V1 = IMAGE_DEVELOP_LIMITS_V1.maximumBytes;
export const PHOTO_RASTER_EXPORT_JOURNAL_MAXIMUM_BYTES_V1 = 1_048_576;
export interface PhotoRasterExportBindingV1 {
	readonly originalSha256: string;
	readonly recipeSha256: string;
	readonly lutSha256: readonly string[];
	readonly sidecarSha256?: string;
}
/** Native download initiation, never a physical-file Saved assertion. */
export interface PhotoRasterExportDownloadAckV1 {
	readonly status: 'download-started';
	readonly method: 'download';
	readonly fileName: string;
	readonly size: number;
}
export interface PhotoRasterExportSidecarAckV1 {
	readonly status: 'download-started';
	readonly method: 'download';
	readonly fileName: string;
	readonly size: number;
	readonly mediaType: 'application/json';
}
export interface PhotoRasterExportJournalMemberV1 extends PhotoRasterExportBatchMemberV1 {
	readonly binding: Readonly<PhotoRasterExportBindingV1>;
	readonly state: 'pending' | 'started' | 'committed';
	readonly delivery: Readonly<PhotoRasterExportDownloadAckV1> | null;
	readonly sidecar?: Readonly<{ state: 'pending' | 'started' | 'committed'; delivery: Readonly<PhotoRasterExportSidecarAckV1> | null }>;
}
export interface PhotoRasterExportJournalV1 {
	readonly schemaVersion: 1;
	readonly kind: 'photo-raster-export-journal';
	readonly catalogId: string;
	readonly revision: number;
	readonly batchId: string;
	readonly format: 'png' | 'jpeg';
	readonly filenameTemplate: string;
	readonly members: readonly Readonly<PhotoRasterExportJournalMemberV1>[];
	readonly output?: PhotoRasterExportBatchV1['output'];
	readonly sidecarEnabled?: true;
	readonly graphicWatermark?: PhotoRasterExportBatchV1['graphicWatermark'];
}
const MEMBER_FIELDS = ['jobId', 'index', 'photoId', 'versionId', 'expectedRevision', 'sourceFileName', 'fileName'] as const;
const JOURNAL_MEMBER_FIELDS = [...MEMBER_FIELDS, 'binding', 'state', 'delivery', 'sidecar'] as const;
const OPTIONAL_FIELDS = ['output', 'sidecarEnabled', 'graphicWatermark'] as const;
const PLAN_FIELDS = ['schemaVersion', 'batchId', 'format', 'members', ...OPTIONAL_FIELDS] as const;
const JOURNAL_FIELDS = ['schemaVersion', 'kind', 'catalogId', 'revision', 'batchId', 'format', 'filenameTemplate', 'members', ...OPTIONAL_FIELDS] as const;

export function photoRasterExportJournalKeyV1(catalogId: string): string {
	if (typeof catalogId !== 'string' || catalogId.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(catalogId)) throw new TypeError('Photo export journal requires a stable catalog identity.');
	return `photo-library:raster-export-journal:v1:${catalogId}`;
}
export function normalizePhotoRasterExportBindingV1(value: unknown): Readonly<PhotoRasterExportBindingV1> {
	const input = record(value, 'Photo export binding', ['originalSha256', 'recipeSha256', 'lutSha256', 'sidecarSha256'], ['originalSha256', 'recipeSha256', 'lutSha256']);
	const digest = (value: unknown): string => {
		if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) throw new TypeError('Photo export bindings require SHA-256 digests.');
		return value;
	};
	return Object.freeze({ originalSha256: digest(field(input, 'originalSha256', 'binding')), recipeSha256: digest(field(input, 'recipeSha256', 'binding')),
		lutSha256: Object.freeze(array(field(input, 'lutSha256', 'binding'), 'LUT digests', 0, 64).map(digest)), ...(Object.hasOwn(input, 'sidecarSha256') ? { sidecarSha256: digest(field(input, 'sidecarSha256', 'binding')) } : {}) });
}
export function normalizePhotoRasterExportDownloadAckV1(value: unknown, fileName: string): Readonly<PhotoRasterExportDownloadAckV1> {
	const input = record(value, 'Photo export download ACK', ['status', 'method', 'fileName', 'size']);
	if (field(input, 'status', 'ACK') !== 'download-started' || field(input, 'method', 'ACK') !== 'download' || field(input, 'fileName', 'ACK') !== fileName) throw new TypeError('Photo export ACK must attest the captured download name.');
	const size = integer(field(input, 'size', 'ACK'), 0, 268_435_456);
	return Object.freeze({ status: 'download-started', method: 'download', fileName, size });
}
/** Scalar custody fingerprints only. Fresh original/LUT borrowing and final
 * publication admission remain with the existing single-photo export owner. */
export function createPhotoRasterExportJournalForProfileV1(profile: PhotoRasterExportProfileV1, planValue: Readonly<PhotoRasterExportBatchCurrentV1>, options: Readonly<{
	catalogId: string; filenameTemplate: string; bindings: readonly Readonly<PhotoRasterExportBindingV1>[];
}>): Readonly<PhotoRasterExportJournalCurrentV1> {
	if (profile !== 'legacy2' && profile !== 'current3') throw new TypeError('Unsupported fixed photo export journal profile.');
	const plan = record(planValue, 'Photo export plan', PLAN_FIELDS, PLAN_FIELDS.filter(key => !OPTIONAL_FIELDS.some(optional => optional === key)));
	const input = record(options, 'Photo export journal creation', ['catalogId', 'filenameTemplate', 'bindings']);
	const members = array(field(plan, 'members', 'plan'), 'Photo export members', 1, 256), bindings = array(field(input, 'bindings', 'creation'), 'Photo export bindings', members.length, members.length);
	return normalizePhotoRasterExportJournalForProfileV1(profile, { schemaVersion: field(plan, 'schemaVersion', 'plan'), kind: 'photo-raster-export-journal',
		catalogId: field(input, 'catalogId', 'creation'), revision: 1, batchId: field(plan, 'batchId', 'plan'), format: field(plan, 'format', 'plan'),
		filenameTemplate: field(input, 'filenameTemplate', 'creation'), members: members.map((value, index) => {
			const member = record(value, 'Photo export member', MEMBER_FIELDS);
			return Object.fromEntries([...MEMBER_FIELDS.map(key => [key, field(member, key, 'member')]), ['binding', bindings[index]], ['state', 'pending'], ['delivery', null], ...(Object.hasOwn(plan, 'sidecarEnabled') && field(plan, 'sidecarEnabled', 'plan') === true ? [['sidecar', { state: 'pending', delivery: null }]] : [])]);
		}), ...(Object.hasOwn(plan, 'output') ? { output: field(plan, 'output', 'plan') } : {}), ...(Object.hasOwn(plan, 'sidecarEnabled') ? { sidecarEnabled: field(plan, 'sidecarEnabled', 'plan') } : {}),
		...(Object.hasOwn(plan, 'graphicWatermark') ? { graphicWatermark: field(plan, 'graphicWatermark', 'plan') } : {}) });
}
export function normalizePhotoRasterExportJournalForProfileV1(profile: PhotoRasterExportProfileV1, value: unknown): Readonly<PhotoRasterExportJournalCurrentV1> {
	if (profile !== 'legacy2' && profile !== 'current3') throw new TypeError('Unsupported fixed photo export journal profile.');
	const input = record(value, 'Photo export journal', JOURNAL_FIELDS, JOURNAL_FIELDS.filter(key => !OPTIONAL_FIELDS.some(optional => optional === key)));
	const read = (key: string): unknown => field(input, key, 'Photo export journal');
	if (read('schemaVersion') !== 1 || read('kind') !== 'photo-raster-export-journal') throw new RangeError('Unsupported photo export journal version.');
	const catalogId = read('catalogId'); if (typeof catalogId !== 'string') throw new TypeError('Photo export journal requires a catalog.');
	photoRasterExportJournalKeyV1(catalogId);
	const filenameTemplate = read('filenameTemplate'); if (typeof filenameTemplate !== 'string') throw new TypeError('Photo export journal requires a filename template.');
	const revision = integer(read('revision'), 1, Number.MAX_SAFE_INTEGER), rawMembers = array(read('members'), 'Photo export journal members', 1, 256)
		.map(value => record(value, 'Photo export journal member', JOURNAL_MEMBER_FIELDS, JOURNAL_MEMBER_FIELDS.filter(key => key !== 'sidecar')));
	const plan = capturePhotoRasterExportBatchForProfileV1(profile, { schemaVersion: 1, batchId: read('batchId'), format: read('format'), filenameTemplate,
		members: rawMembers.map(member => ({ photoId: field(member, 'photoId', 'member'), versionId: field(member, 'versionId', 'member'),
			expectedRevision: integer(field(member, 'expectedRevision', 'member'), 0, Number.MAX_SAFE_INTEGER), sourceFileName: field(member, 'sourceFileName', 'member') })),
		...(Object.hasOwn(input, 'output') ? { output: read('output') } : {}), ...(Object.hasOwn(input, 'sidecarEnabled') ? { sidecarEnabled: read('sidecarEnabled') } : {}),
		...(Object.hasOwn(input, 'graphicWatermark') ? { graphicWatermark: read('graphicWatermark') } : {}) });
	const members = plan.members.map((member, index) => {
		const raw = rawMembers[index]!;
		for (const key of MEMBER_FIELDS) if (field(raw, key, 'member') !== member[key]) throw new TypeError('Photo export journal differs from its ordered filename plan.');
		const state = field(raw, 'state', 'member'), delivery = field(raw, 'delivery', 'member');
		if (state !== 'pending' && state !== 'started' && state !== 'committed') throw new TypeError('Unsupported photo export journal member state.');
		if ((state === 'committed') !== (delivery !== null)) throw new TypeError('Photo export state and native ACK disagree.');
		const binding = normalizePhotoRasterExportBindingV1(field(raw, 'binding', 'member'));
		if (Boolean(plan.sidecarEnabled) !== Object.hasOwn(raw, 'sidecar') || Boolean(plan.sidecarEnabled) !== Object.hasOwn(binding, 'sidecarSha256')) throw new TypeError('Photo export companion and complete saved-fact binding disagree.');
		const sidecar = plan.sidecarEnabled ? normalizeSidecar(field(raw, 'sidecar', 'member'), state, member.fileName) : undefined;
		return Object.freeze({ ...member, binding, state,
			delivery: delivery === null ? null : normalizePhotoRasterExportDownloadAckV1(delivery, member.fileName), ...(sidecar ? { sidecar } : {}) });
	});
	const result: Readonly<PhotoRasterExportJournalCurrentV1> = Object.freeze({ schemaVersion: 1, kind: 'photo-raster-export-journal', catalogId, revision,
		batchId: plan.batchId, format: plan.format, filenameTemplate, members: Object.freeze(members), ...(plan.output ? { output: plan.output } : {}), ...(plan.sidecarEnabled ? { sidecarEnabled: true } : {}),
		...(plan.graphicWatermark ? { graphicWatermark: plan.graphicWatermark } : {}) });
	if (new TextEncoder().encode(JSON.stringify(result)).byteLength > PHOTO_RASTER_EXPORT_JOURNAL_MAXIMUM_BYTES_V1) throw new RangeError('Photo export journal exceeds its scalar byte bound.');
	return result;
}
function integer(value: unknown, minimum: number, maximum: number): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || Object.is(value, -0) || value < minimum || value > maximum) throw new RangeError('Photo export journal requires a bounded canonical integer.');
	return value;
}

/** Both native acknowledgements are required only when explicitly requested. */
export function isPhotoRasterExportMemberCompleteV1(member: Readonly<PhotoRasterExportJournalMemberV1>): boolean {
	return member.state === 'committed' && (!member.sidecar || member.sidecar.state === 'committed');
}
export function normalizePhotoRasterExportSidecarAckV1(value: unknown, rasterFileName: string): Readonly<PhotoRasterExportSidecarAckV1> {
	const input = record(value, 'Photo export JSON ACK', ['status', 'method', 'fileName', 'size', 'mediaType']);
	const fileName = rasterFileName + '.lightscaper.json';
	if (fileName.length > 512 || field(input, 'mediaType', 'JSON ACK') !== 'application/json' || field(input, 'status', 'JSON ACK') !== 'download-started'
		|| field(input, 'method', 'JSON ACK') !== 'download' || field(input, 'fileName', 'JSON ACK') !== fileName) throw new TypeError('Photo export JSON ACK must attest the complete image name and JSON type.');
	return Object.freeze({ status: 'download-started', method: 'download', fileName, size: integer(field(input, 'size', 'JSON ACK'), 1, PHOTO_RASTER_EXPORT_SIDECAR_MAXIMUM_BYTES_V1), mediaType: 'application/json' });
}
function normalizeSidecar(value: unknown, rasterState: string, fileName: string): NonNullable<PhotoRasterExportJournalMemberV1['sidecar']> {
	const input = record(value, 'Photo export companion', ['state', 'delivery']), state = field(input, 'state', 'companion'), delivery = field(input, 'delivery', 'companion');
	if (state !== 'pending' && state !== 'started' && state !== 'committed') throw new TypeError('Unsupported photo export companion state.');
	if ((state === 'committed') !== (delivery !== null) || (state !== 'pending' && rasterState !== 'committed')) throw new TypeError('Photo companion requires acknowledged image delivery and a matching JSON ACK.');
	return Object.freeze({ state, delivery: delivery === null ? null : normalizePhotoRasterExportSidecarAckV1(delivery, fileName) });
}
