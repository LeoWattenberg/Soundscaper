/* SPDX-License-Identifier: AGPL-3.0-only */
import { readClosedDomainArray as array, readClosedDomainField as field, readClosedDomainRecord as record } from '../../common/editor/closed-domain-value.ts';
import { capturePhotoRasterExportBatchV1, type PhotoRasterExportBatchMemberV1, type PhotoRasterExportBatchV1 } from '../controller/photo-raster-export-batch-v1.ts';

export const PHOTO_RASTER_EXPORT_JOURNAL_MAXIMUM_BYTES_V1 = 1_048_576;
export interface PhotoRasterExportBindingV1 {
	readonly originalSha256: string;
	readonly recipeSha256: string;
	readonly lutSha256: readonly string[];
}
/** Native download initiation, never a physical-file Saved assertion. */
export interface PhotoRasterExportDownloadAckV1 {
	readonly status: 'download-started';
	readonly method: 'download';
	readonly fileName: string;
	readonly size: number;
}
export interface PhotoRasterExportJournalMemberV1 extends PhotoRasterExportBatchMemberV1 {
	readonly binding: Readonly<PhotoRasterExportBindingV1>;
	readonly state: 'pending' | 'started' | 'committed';
	readonly delivery: Readonly<PhotoRasterExportDownloadAckV1> | null;
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
}
const MEMBER_FIELDS = ['jobId', 'index', 'photoId', 'versionId', 'expectedRevision', 'sourceFileName', 'fileName'] as const;
const JOURNAL_MEMBER_FIELDS = [...MEMBER_FIELDS, 'binding', 'state', 'delivery'] as const;
const PLAN_FIELDS = ['schemaVersion', 'batchId', 'format', 'members', 'output'] as const;
const JOURNAL_FIELDS = ['schemaVersion', 'kind', 'catalogId', 'revision', 'batchId', 'format', 'filenameTemplate', 'members', 'output'] as const;

export function photoRasterExportJournalKeyV1(catalogId: string): string {
	if (typeof catalogId !== 'string' || catalogId.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(catalogId)) throw new TypeError('Photo export journal requires a stable catalog identity.');
	return `photo-library:raster-export-journal:v1:${catalogId}`;
}
export function normalizePhotoRasterExportBindingV1(value: unknown): Readonly<PhotoRasterExportBindingV1> {
	const input = record(value, 'Photo export binding', ['originalSha256', 'recipeSha256', 'lutSha256']);
	const digest = (value: unknown): string => {
		if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) throw new TypeError('Photo export bindings require SHA-256 digests.');
		return value;
	};
	return Object.freeze({ originalSha256: digest(field(input, 'originalSha256', 'binding')), recipeSha256: digest(field(input, 'recipeSha256', 'binding')),
		lutSha256: Object.freeze(array(field(input, 'lutSha256', 'binding'), 'LUT digests', 0, 64).map(digest)) });
}
export function normalizePhotoRasterExportDownloadAckV1(value: unknown, fileName: string): Readonly<PhotoRasterExportDownloadAckV1> {
	const input = record(value, 'Photo export download ACK', ['status', 'method', 'fileName', 'size']);
	if (field(input, 'status', 'ACK') !== 'download-started' || field(input, 'method', 'ACK') !== 'download' || field(input, 'fileName', 'ACK') !== fileName) throw new TypeError('Photo export ACK must attest the captured download name.');
	const size = integer(field(input, 'size', 'ACK'), 0, 268_435_456);
	return Object.freeze({ status: 'download-started', method: 'download', fileName, size });
}
/** Scalar custody fingerprints only. Fresh original/LUT borrowing and final
 * publication admission remain with the existing single-photo export owner. */
export function createPhotoRasterExportJournalV1(planValue: Readonly<PhotoRasterExportBatchV1>, options: Readonly<{
	catalogId: string; filenameTemplate: string; bindings: readonly Readonly<PhotoRasterExportBindingV1>[];
}>): Readonly<PhotoRasterExportJournalV1> {
	const plan = record(planValue, 'Photo export plan', PLAN_FIELDS, PLAN_FIELDS.filter(key => key !== 'output'));
	const input = record(options, 'Photo export journal creation', ['catalogId', 'filenameTemplate', 'bindings']);
	const members = array(field(plan, 'members', 'plan'), 'Photo export members', 1, 256), bindings = array(field(input, 'bindings', 'creation'), 'Photo export bindings', members.length, members.length);
	return normalizePhotoRasterExportJournalV1({ schemaVersion: field(plan, 'schemaVersion', 'plan'), kind: 'photo-raster-export-journal',
		catalogId: field(input, 'catalogId', 'creation'), revision: 1, batchId: field(plan, 'batchId', 'plan'), format: field(plan, 'format', 'plan'),
		filenameTemplate: field(input, 'filenameTemplate', 'creation'), members: members.map((value, index) => {
			const member = record(value, 'Photo export member', MEMBER_FIELDS);
			return Object.fromEntries([...MEMBER_FIELDS.map(key => [key, field(member, key, 'member')]), ['binding', bindings[index]], ['state', 'pending'], ['delivery', null]]);
		}), ...(Object.hasOwn(plan, 'output') ? { output: field(plan, 'output', 'plan') } : {}) });
}
export function normalizePhotoRasterExportJournalV1(value: unknown): Readonly<PhotoRasterExportJournalV1> {
	const input = record(value, 'Photo export journal', JOURNAL_FIELDS, JOURNAL_FIELDS.filter(key => key !== 'output'));
	const read = (key: string): unknown => field(input, key, 'Photo export journal');
	if (read('schemaVersion') !== 1 || read('kind') !== 'photo-raster-export-journal') throw new RangeError('Unsupported photo export journal version.');
	const catalogId = read('catalogId'); if (typeof catalogId !== 'string') throw new TypeError('Photo export journal requires a catalog.');
	photoRasterExportJournalKeyV1(catalogId);
	const filenameTemplate = read('filenameTemplate'); if (typeof filenameTemplate !== 'string') throw new TypeError('Photo export journal requires a filename template.');
	const revision = integer(read('revision'), 1, Number.MAX_SAFE_INTEGER), rawMembers = array(read('members'), 'Photo export journal members', 1, 256)
		.map(value => record(value, 'Photo export journal member', JOURNAL_MEMBER_FIELDS));
	const plan = capturePhotoRasterExportBatchV1({ schemaVersion: 1, batchId: read('batchId'), format: read('format'), filenameTemplate,
		members: rawMembers.map(member => ({ photoId: field(member, 'photoId', 'member'), versionId: field(member, 'versionId', 'member'),
			expectedRevision: integer(field(member, 'expectedRevision', 'member'), 0, Number.MAX_SAFE_INTEGER), sourceFileName: field(member, 'sourceFileName', 'member') })),
		...(Object.hasOwn(input, 'output') ? { output: read('output') } : {}) });
	const members = plan.members.map((member, index) => {
		const raw = rawMembers[index]!;
		for (const key of MEMBER_FIELDS) if (field(raw, key, 'member') !== member[key]) throw new TypeError('Photo export journal differs from its ordered filename plan.');
		const state = field(raw, 'state', 'member'), delivery = field(raw, 'delivery', 'member');
		if (state !== 'pending' && state !== 'started' && state !== 'committed') throw new TypeError('Unsupported photo export journal member state.');
		if ((state === 'committed') !== (delivery !== null)) throw new TypeError('Photo export state and native ACK disagree.');
		return Object.freeze({ ...member, binding: normalizePhotoRasterExportBindingV1(field(raw, 'binding', 'member')), state,
			delivery: delivery === null ? null : normalizePhotoRasterExportDownloadAckV1(delivery, member.fileName) });
	});
	const result: Readonly<PhotoRasterExportJournalV1> = Object.freeze({ schemaVersion: 1, kind: 'photo-raster-export-journal', catalogId, revision,
		batchId: plan.batchId, format: plan.format, filenameTemplate, members: Object.freeze(members), ...(plan.output ? { output: plan.output } : {}) });
	if (new TextEncoder().encode(JSON.stringify(result)).byteLength > PHOTO_RASTER_EXPORT_JOURNAL_MAXIMUM_BYTES_V1) throw new RangeError('Photo export journal exceeds its scalar byte bound.');
	return result;
}
function integer(value: unknown, minimum: number, maximum: number): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || Object.is(value, -0) || value < minimum || value > maximum) throw new RangeError('Photo export journal requires a bounded canonical integer.');
	return value;
}
