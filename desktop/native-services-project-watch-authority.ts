/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';

import {
	FRAMESCAPER_PROJECT_WATCH_BIN_ID,
} from '../src/common/editor/native-watch-target.ts';
import { readProjectSchemaIdentity } from '../src/common/editor/project-schema-identity.ts';

const SHA256 = /^[a-f0-9]{64}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

interface FramescaperWatchProjectPort {
	readonly schemaFamily: 'framescaper';
	readonly schemaVersion: 1;
	projectRecord(projectId: string): unknown;
	readProjectBundle(projectId: string): Promise<unknown>;
}

export interface FramescaperNativeWatchProjectWitness {
	readonly schemaFamily: 'framescaper';
	readonly schemaVersion: 1;
	readonly projectId: string;
	readonly projectRevision: number;
	readonly open: boolean;
	readonly writable: boolean;
	readonly binId: typeof FRAMESCAPER_PROJECT_WATCH_BIN_ID;
}

export interface FramescaperNativeWatchImportWitness {
	readonly schemaFamily: 'framescaper';
	readonly schemaVersion: 1;
	readonly projectId: string;
	readonly projectRevision: number;
	readonly binId: typeof FRAMESCAPER_PROJECT_WATCH_BIN_ID;
	readonly sourceId: string;
	readonly contentSha256: string;
	readonly proxyAttached: boolean;
}

export function framescaperNativeWatchProject(
	project: FramescaperWatchProjectPort,
	state: Readonly<{
		readonly schemaFamily: 'framescaper'; readonly schemaVersion: 1;
		readonly open: boolean; readonly writable: boolean;
		readonly binId: typeof FRAMESCAPER_PROJECT_WATCH_BIN_ID;
	}>,
	projectId: string,
	): FramescaperNativeWatchProjectWitness | null {
	assertProjectPortIdentity(project);
	const stateIdentity = readProjectSchemaIdentity(state);
	if (stateIdentity.schemaFamily !== 'framescaper' || stateIdentity.schemaVersion !== 1
		|| state.binId !== FRAMESCAPER_PROJECT_WATCH_BIN_ID
		|| typeof state.open !== 'boolean' || typeof state.writable !== 'boolean') {
		throw new TypeError('Native watch authority requires exact Framescaper v1 project state.');
	}
	const record = projectIdentity(project.projectRecord(projectId));
	if (record === null || record.projectId !== projectId
		|| !Number.isSafeInteger(record.projectRevision) || record.projectRevision < 0
		|| !SHA256.test(record.projectSha256)) return null;
	return Object.freeze({
		schemaFamily: 'framescaper', schemaVersion: 1,
		projectId, projectRevision: record.projectRevision,
		open: state.open === true, writable: state.writable === true,
		binId: FRAMESCAPER_PROJECT_WATCH_BIN_ID,
	});
}

export async function inspectFramescaperNativeWatchImport(
	project: FramescaperWatchProjectPort,
	projectId: string,
	binId: string | null,
	contentSha256: string,
	): Promise<FramescaperNativeWatchImportWitness | null> {
	assertProjectPortIdentity(project);
	if (binId !== FRAMESCAPER_PROJECT_WATCH_BIN_ID || !SHA256.test(contentSha256)) {
		throw new TypeError('Baseline watch recovery requires its exact bin and content digest.');
	}
	const record = projectIdentity(project.projectRecord(projectId));
	if (record === null || record.projectId !== projectId) return null;
	const bundle = bundleRecord(await project.readProjectBundle(projectId));
	if (bundle.projectRevision !== record.projectRevision || bundle.sha256 !== record.projectSha256
		|| digest(bundle.document) !== record.projectSha256) {
		throw new Error('Baseline watch recovery project identity changed during inspection.');
	}
	let parsed: unknown;
	try { parsed = JSON.parse(bundle.document) as unknown; }
	catch { throw new Error('Baseline watch recovery project is not canonical JSON.'); }
	const projectValue = domainRecord(parsed, 'project');
	const schemaFamily = data(projectValue, 'schemaFamily');
	const schemaVersion = data(projectValue, 'schemaVersion');
	if (schemaFamily !== 'framescaper' || schemaVersion !== 1 || data(projectValue, 'id') !== projectId
		|| data(projectValue, 'revision') !== record.projectRevision) {
		throw new Error('Baseline watch recovery project has the wrong document identity.');
	}
	const sources = records(data(projectValue, 'sources'), 'sources');
	const projectBin = domainRecord(data(projectValue, 'projectBin'), 'project bin');
	const clips = records(data(projectBin, 'clips'), 'project-bin clips');
	const sourceIds = new Set(clips.map((clip) => identifier(data(clip, 'sourceId'), 'bin source id')));
	const matches = sources.filter((source) => data(source, 'kind') === 'video'
		&& data(source, 'contentSha256') === contentSha256
		&& sourceIds.has(identifier(data(source, 'id'), 'source id')));
	if (matches.length === 0) return null;
	if (matches.length !== 1) throw new Error('Baseline watch recovery digest is ambiguous in its target bin.');
	const source = matches[0]!;
	const sourceId = identifier(data(source, 'id'), 'source id');
	const attachment = data(source, 'proxyAttachment');
	let proxyAttached = false;
	if (attachment !== null) {
		const proxy = domainRecord(attachment, 'proxy attachment');
		if (data(proxy, 'originalSha256') !== contentSha256
			|| !SHA256.test(String(data(proxy, 'sha256')))) {
			throw new Error('Baseline watch recovery found a mismatched proxy attachment.');
		}
		proxyAttached = true;
	}
	return Object.freeze({
		schemaFamily: 'framescaper', schemaVersion: 1,
		projectId, projectRevision: record.projectRevision,
		binId: FRAMESCAPER_PROJECT_WATCH_BIN_ID,
		sourceId, contentSha256, proxyAttached,
	});
}

function assertProjectPortIdentity(project: FramescaperWatchProjectPort): void {
	for (const [field, expected] of [
		['schemaFamily', 'framescaper'], ['schemaVersion', 1],
	] as const) {
		const descriptor = Object.getOwnPropertyDescriptor(project, field);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')
			|| descriptor.value !== expected) {
			throw new TypeError('Native watch authority requires the exact Framescaper v1 project identity.');
		}
	}
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
		throw new TypeError('Baseline watch recovery project bundle is malformed.');
	}
	return Object.freeze({ document, projectRevision: Number(projectRevision), sha256 });
}

function domainRecord(value: unknown, label: string): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`Baseline watch ${label} must be a plain record.`);
	}
	return value as Readonly<Record<string, unknown>>;
}

function records(value: unknown, label: string): readonly Readonly<Record<string, unknown>>[] {
	if (!Array.isArray(value) || value.length > 100_000
		|| Reflect.ownKeys(value).length !== value.length + 1) {
		throw new TypeError(`Baseline watch ${label} must be a bounded dense array.`);
	}
	return value.map((entry) => domainRecord(entry, label));
}

function data(record: Readonly<Record<string, unknown>>, key: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(record, key);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`Baseline watch ${key} must be an own data property.`);
	}
	return descriptor.value;
}

function identifier(value: unknown, label: string): string {
	if (typeof value !== 'string' || !IDENTIFIER.test(value)) {
		throw new TypeError(`Baseline watch ${label} is invalid.`);
	}
	return value;
}

function digest(value: string): string { return createHash('sha256').update(value).digest('hex'); }
