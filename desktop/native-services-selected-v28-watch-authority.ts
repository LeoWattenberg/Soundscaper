/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';

import {
	FRAMESCAPER_SELECTED_V28_WATCH_BIN_ID,
} from '../src/common/editor/native-watch-target.ts';

const SHA256 = /^[a-f0-9]{64}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

interface SelectedV28WatchProjectPort {
	projectRecord(projectId: string): unknown;
	readProjectBundle(projectId: string): Promise<unknown>;
}

export interface FramescaperSelectedV28WatchProjectWitness {
	readonly schemaVersion: 28 | 31;
	readonly projectId: string;
	readonly projectRevision: number;
	readonly open: boolean;
	readonly writable: boolean;
	readonly binId: typeof FRAMESCAPER_SELECTED_V28_WATCH_BIN_ID;
}

export interface FramescaperSelectedV28WatchImportWitness {
	readonly projectId: string;
	readonly projectRevision: number;
	readonly binId: typeof FRAMESCAPER_SELECTED_V28_WATCH_BIN_ID;
	readonly sourceId: string;
	readonly contentSha256: string;
	readonly proxyAttached: boolean;
}

export function framescaperSelectedV28WatchProject(
	project: SelectedV28WatchProjectPort,
	state: Readonly<{ open: boolean; writable: boolean }>,
	projectId: string,
	schemaVersion: 28 | 31 = 28,
): FramescaperSelectedV28WatchProjectWitness | null {
	const record = projectIdentity(project.projectRecord(projectId));
	if (record === null || record.projectId !== projectId
		|| !Number.isSafeInteger(record.projectRevision) || record.projectRevision < 0
		|| !SHA256.test(record.projectSha256)) return null;
	return Object.freeze({
		schemaVersion, projectId, projectRevision: record.projectRevision,
		open: state.open === true, writable: state.writable === true,
		binId: FRAMESCAPER_SELECTED_V28_WATCH_BIN_ID,
	});
}

export async function inspectFramescaperSelectedV28WatchImport(
	project: SelectedV28WatchProjectPort,
	projectId: string,
	binId: string | null,
	contentSha256: string,
	schemaVersion: 28 | 31 = 28,
): Promise<FramescaperSelectedV28WatchImportWitness | null> {
	if (binId !== FRAMESCAPER_SELECTED_V28_WATCH_BIN_ID || !SHA256.test(contentSha256)) {
		throw new TypeError('Selected V28 watch recovery requires its exact bin and content digest.');
	}
	const record = projectIdentity(project.projectRecord(projectId));
	if (record === null || record.projectId !== projectId) return null;
	const bundle = bundleRecord(await project.readProjectBundle(projectId));
	if (bundle.projectRevision !== record.projectRevision || bundle.sha256 !== record.projectSha256
		|| digest(bundle.document) !== record.projectSha256) {
		throw new Error('Selected V28 watch recovery project identity changed during inspection.');
	}
	let parsed: unknown;
	try { parsed = JSON.parse(bundle.document) as unknown; }
	catch { throw new Error('Selected V28 watch recovery project is not canonical JSON.'); }
	const projectValue = domainRecord(parsed, 'project');
	if (data(projectValue, 'schemaVersion') !== schemaVersion || data(projectValue, 'id') !== projectId
		|| data(projectValue, 'revision') !== record.projectRevision) {
		throw new Error('Selected V28 watch recovery project has the wrong document identity.');
	}
	const sources = records(data(projectValue, 'sources'), 'sources');
	const projectBin = domainRecord(data(projectValue, 'projectBin'), 'project bin');
	const clips = records(data(projectBin, 'clips'), 'project-bin clips');
	const sourceIds = new Set(clips.map((clip) => identifier(data(clip, 'sourceId'), 'bin source id')));
	const matches = sources.filter((source) => data(source, 'kind') === 'video'
		&& data(source, 'contentSha256') === contentSha256
		&& sourceIds.has(identifier(data(source, 'id'), 'source id')));
	if (matches.length === 0) return null;
	if (matches.length !== 1) throw new Error('Selected V28 watch recovery digest is ambiguous in its target bin.');
	const source = matches[0]!;
	const sourceId = identifier(data(source, 'id'), 'source id');
	const attachment = data(source, 'proxyAttachment');
	let proxyAttached = false;
	if (attachment !== null) {
		const proxy = domainRecord(attachment, 'proxy attachment');
		if (data(proxy, 'originalSha256') !== contentSha256
			|| !SHA256.test(String(data(proxy, 'sha256')))) {
			throw new Error('Selected V28 watch recovery found a mismatched proxy attachment.');
		}
		proxyAttached = true;
	}
	return Object.freeze({
		projectId, projectRevision: record.projectRevision,
		binId: FRAMESCAPER_SELECTED_V28_WATCH_BIN_ID,
		sourceId, contentSha256, proxyAttached,
	});
}

function projectIdentity(value: unknown): Readonly<{
	readonly projectId: string; readonly projectRevision: number; readonly projectSha256: string;
}> | null {
	if (value === null) return null;
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const row = value as Readonly<Record<string, unknown>>;
	if (typeof row.projectId !== 'string' || !Number.isSafeInteger(row.projectRevision)
		|| Number(row.projectRevision) < 0 || typeof row.projectSha256 !== 'string') return null;
	return Object.freeze({
		projectId: row.projectId, projectRevision: Number(row.projectRevision),
		projectSha256: row.projectSha256,
	});
}

function bundleRecord(value: unknown): Readonly<{
	document: string; projectRevision: number; sha256: string;
}> {
	const row = domainRecord(value, 'project bundle');
	const project = domainRecord(data(row, 'project'), 'project row');
	const document = data(row, 'document');
	const projectRevision = data(project, 'projectRevision');
	const sha256 = data(project, 'sha256');
	if (typeof document !== 'string' || !Number.isSafeInteger(projectRevision)
		|| Number(projectRevision) < 0 || typeof sha256 !== 'string' || !SHA256.test(sha256)) {
		throw new TypeError('Selected V28 watch recovery project bundle is malformed.');
	}
	return Object.freeze({ document, projectRevision: Number(projectRevision), sha256 });
}

function domainRecord(value: unknown, label: string): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`Selected V28 watch ${label} must be a plain record.`);
	}
	return value as Readonly<Record<string, unknown>>;
}

function records(value: unknown, label: string): readonly Readonly<Record<string, unknown>>[] {
	if (!Array.isArray(value) || value.length > 100_000
		|| Reflect.ownKeys(value).length !== value.length + 1) {
		throw new TypeError(`Selected V28 watch ${label} must be a bounded dense array.`);
	}
	return value.map((entry) => domainRecord(entry, label));
}

function data(record: Readonly<Record<string, unknown>>, key: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(record, key);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`Selected V28 watch ${key} must be an own data property.`);
	}
	return descriptor.value;
}

function identifier(value: unknown, label: string): string {
	if (typeof value !== 'string' || !IDENTIFIER.test(value)) {
		throw new TypeError(`Selected V28 watch ${label} is invalid.`);
	}
	return value;
}

function digest(value: string): string { return createHash('sha256').update(value).digest('hex'); }
