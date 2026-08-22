/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField, readClosedDomainRecord } from '../common/editor/closed-domain-value.ts';
import {
	normalizeFramescaperProfessionalVideoSourceV25,
	type FramescaperProfessionalVideoSourceV25,
} from './editor-project-v25-validation.ts';

export interface FramescaperProfessionalSourceAddCommandV25 {
	readonly type: 'video-source/professional-add';
	readonly source: FramescaperProfessionalVideoSourceV25;
}

export interface FramescaperProfessionalSourceRemoveCommandV25 {
	readonly type: 'video-source/professional-remove';
	readonly sourceId: string;
	readonly expectedSource: FramescaperProfessionalVideoSourceV25;
}

export type FramescaperProfessionalSourceCollectionCommandV25 =
	| FramescaperProfessionalSourceAddCommandV25
	| FramescaperProfessionalSourceRemoveCommandV25;

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

export function isFramescaperProfessionalSourceCollectionCommandTypeV25(type: string): boolean {
	return type === 'video-source/professional-add' || type === 'video-source/professional-remove';
}

export function createFramescaperProfessionalSourceAdmissionCommandV25(
	sourceValue: unknown,
): FramescaperProfessionalSourceAddCommandV25 {
	return snapshotFramescaperProfessionalSourceCollectionCommandV25({
		type: 'video-source/professional-add', source: sourceValue,
	}) as FramescaperProfessionalSourceAddCommandV25;
}

export function createFramescaperImageSequenceSourceAdmissionCommandV25(
	sourceValue: unknown,
): FramescaperProfessionalSourceAddCommandV25 {
	const command = createFramescaperProfessionalSourceAdmissionCommandV25(sourceValue);
	if (command.source.imageSequence === null) {
		throw new RangeError('A V25 image-sequence admission requires an exact compact sequence descriptor.');
	}
	return command;
}

export function snapshotFramescaperProfessionalSourceCollectionCommandV25(
	value: unknown,
): FramescaperProfessionalSourceCollectionCommandV25 {
	const type = commandType(value);
	if (type === 'video-source/professional-add') {
		const record = readClosedDomainRecord(value, 'Framescaper V25 professional source add', ['type', 'source']);
		return deepFreeze({
			type,
			source: normalizeFramescaperProfessionalVideoSourceV25(field(record, 'source')),
		});
	}
	if (type === 'video-source/professional-remove') {
		const record = readClosedDomainRecord(
			value, 'Framescaper V25 professional source remove', ['type', 'sourceId', 'expectedSource'],
		);
		const sourceId = stableId(field(record, 'sourceId'));
		const expectedSource = normalizeFramescaperProfessionalVideoSourceV25(field(record, 'expectedSource'));
		if (expectedSource.id !== sourceId) {
			throw new RangeError('A V25 professional source removal cannot change source identity.');
		}
		return deepFreeze({ type, sourceId, expectedSource });
	}
	throw new RangeError('Framescaper V25 professional source collection command is unsupported.');
}

export function applyFramescaperProfessionalSourceCollectionCommandV25(
	project: Record<string, unknown>,
	command: FramescaperProfessionalSourceCollectionCommandV25,
): void {
	const sources = records(project.sources, 'sources');
	if (command.type === 'video-source/professional-add') {
		if (sources.some(({ id }) => id === command.source.id)) {
			throw new Error(`The V25 professional source ${command.source.id} already exists or is stale.`);
		}
		sources.push(structuredClone(command.source) as unknown as Record<string, unknown>);
	} else {
		const index = sources.findIndex(({ id, kind }) => id === command.sourceId && kind === 'video');
		const current = index < 0 ? null : sources[index]!;
		if (JSON.stringify(current) !== JSON.stringify(command.expectedSource)) {
			throw new Error('The expected V25 professional source is stale.');
		}
		sources.splice(index, 1);
	}
	project.sources = sources;
}

function commandType(value: unknown): string {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Framescaper V25 professional source command must be an object.');
	}
	const type = field(value as Readonly<Record<string, unknown>>, 'type');
	if (typeof type !== 'string') throw new TypeError('Framescaper V25 professional source command.type is invalid.');
	return type;
}

function field(record: Readonly<Record<string, unknown>>, name: string): unknown {
	return readClosedDomainField(record, name, 'Framescaper V25 professional source command');
}

function stableId(value: unknown): string {
	if (typeof value !== 'string' || !ID.test(value)) throw new TypeError('Framescaper V25 sourceId must be a stable ID.');
	return value;
}

function records(value: unknown, name: string): Record<string, unknown>[] {
	if (!Array.isArray(value)) throw new TypeError(`Framescaper V25 ${name} must be an array.`);
	return value.map((item) => {
		if (!item || typeof item !== 'object' || Array.isArray(item)) {
			throw new TypeError(`Framescaper V25 ${name} item must be an object.`);
		}
		return item as Record<string, unknown>;
	});
}

function deepFreeze<T>(value: T): T {
	if (value && typeof value === 'object' && !Object.isFrozen(value)) {
		for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
		Object.freeze(value);
	}
	return value;
}
