/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	readClosedDomainArray,
	readClosedDomainField,
	readClosedDomainRecord,
	type ClosedDomainRecord,
} from './closed-domain-value.ts';
import {
	normalizeVideoColorGradeV1,
	type VideoColorGradeV1,
} from './video-color-management-v27.ts';

export interface VideoVisualPresentationOwnerV1 {
	readonly kind: 'source' | 'clip' | 'adjustment-layer' | 'generator' | 'mask-matte';
	readonly id: string;
}

export interface VideoVisualPresentationV1 {
	readonly schemaVersion: 1;
	readonly id: string;
	readonly owner: VideoVisualPresentationOwnerV1;
	readonly enabled: boolean;
	readonly opacity: number;
	readonly blendMode: 'normal' | 'multiply' | 'screen' | 'overlay' | 'add';
	readonly grade: VideoColorGradeV1 | null;
	readonly processorStackId: string | null;
	readonly maskMatteIds: readonly string[];
}

export interface VideoFinishingPresetTemplateV1 {
	readonly enabled: boolean;
	readonly opacity: number;
	readonly blendMode: VideoVisualPresentationV1['blendMode'];
	readonly grade: VideoColorGradeV1 | null;
}

export interface VideoFinishingPresetV1 {
	readonly schemaVersion: 1;
	readonly kind: 'video-finishing-preset';
	readonly id: string;
	readonly name: string;
	readonly template: VideoFinishingPresetTemplateV1;
}

const PRESENTATION_FIELDS = Object.freeze([
	'schemaVersion', 'id', 'owner', 'enabled', 'opacity', 'blendMode', 'grade',
	'processorStackId', 'maskMatteIds',
]);
const OWNER_FIELDS = Object.freeze(['kind', 'id']);
const PRESET_FIELDS = Object.freeze(['schemaVersion', 'kind', 'id', 'name', 'template']);
const TEMPLATE_FIELDS = Object.freeze(['enabled', 'opacity', 'blendMode', 'grade']);
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const UNSAFE_TEXT = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

export function normalizeVideoVisualPresentationV1(value: unknown): VideoVisualPresentationV1 {
	const name = 'video visual presentation';
	const record = readClosedDomainRecord(value, name, PRESENTATION_FIELDS);
	exact(field(record, 'schemaVersion', name), 1, `${name} schema`);
	const masks = readClosedDomainArray(
		field(record, 'maskMatteIds', name), 'presentation mask/matte IDs', 0, 256,
	).map((item) => stableId(item, 'presentation mask/matte ID'));
	assertUnique(masks, 'presentation mask/matte');
	return Object.freeze({
		schemaVersion: 1 as const,
		id: stableId(field(record, 'id', name), 'visual presentation ID'),
		owner: normalizeOwner(field(record, 'owner', name)),
		enabled: boolean(field(record, 'enabled', name), 'visual presentation enabled'),
		opacity: bounded(field(record, 'opacity', name), 0, 1, 'visual presentation opacity'),
		blendMode: blendMode(field(record, 'blendMode', name)),
		grade: optionalGrade(field(record, 'grade', name)),
		processorStackId: optionalId(field(record, 'processorStackId', name), 'visual presentation processor stack ID'),
		maskMatteIds: Object.freeze(masks),
	});
}

export function normalizeVideoFinishingPresetV1(value: unknown): VideoFinishingPresetV1 {
	const name = 'video finishing preset';
	const record = readClosedDomainRecord(value, name, PRESET_FIELDS);
	exact(field(record, 'schemaVersion', name), 1, `${name} schema`);
	exact(field(record, 'kind', name), 'video-finishing-preset', `${name} kind`);
	return Object.freeze({
		schemaVersion: 1 as const,
		kind: 'video-finishing-preset' as const,
		id: stableId(field(record, 'id', name), 'video finishing preset ID'),
		name: safeName(field(record, 'name', name)),
		template: normalizeTemplate(field(record, 'template', name)),
	});
}

/** Presets never donate identities or project-specific processor/mask references. */
export function instantiateVideoFinishingPresetV1(
	presetValue: unknown,
	request: Readonly<{
		readonly presentationId: string;
		readonly owner: VideoVisualPresentationOwnerV1;
	}>,
): VideoVisualPresentationV1 {
	const preset = normalizeVideoFinishingPresetV1(presetValue);
	const presentationId = stableId(request?.presentationId, 'instantiated visual presentation ID');
	if (presentationId === preset.id) {
		throw new RangeError('A finishing preset must be instantiated under a caller-owned fresh identity.');
	}
	return normalizeVideoVisualPresentationV1({
		schemaVersion: 1,
		id: presentationId,
		owner: request?.owner,
		enabled: preset.template.enabled,
		opacity: preset.template.opacity,
		blendMode: preset.template.blendMode,
		grade: preset.template.grade === null ? null : structuredClone(preset.template.grade),
		processorStackId: null,
		maskMatteIds: [],
	});
}

function normalizeTemplate(value: unknown): VideoFinishingPresetTemplateV1 {
	const name = 'video finishing preset template';
	const record = readClosedDomainRecord(value, name, TEMPLATE_FIELDS);
	return Object.freeze({
		enabled: boolean(field(record, 'enabled', name), 'finishing preset enabled'),
		opacity: bounded(field(record, 'opacity', name), 0, 1, 'finishing preset opacity'),
		blendMode: blendMode(field(record, 'blendMode', name)),
		grade: optionalGrade(field(record, 'grade', name)),
	});
}

function normalizeOwner(value: unknown): VideoVisualPresentationOwnerV1 {
	const name = 'video visual presentation owner';
	const record = readClosedDomainRecord(value, name, OWNER_FIELDS);
	return Object.freeze({
		kind: oneOf(field(record, 'kind', name), [
			'source', 'clip', 'adjustment-layer', 'generator', 'mask-matte',
		] as const, 'visual presentation owner kind'),
		id: stableId(field(record, 'id', name), 'visual presentation owner ID'),
	});
}

function optionalGrade(value: unknown): VideoColorGradeV1 | null {
	return value === null ? null : normalizeVideoColorGradeV1(value);
}

function blendMode(value: unknown): VideoVisualPresentationV1['blendMode'] {
	return oneOf(value, ['normal', 'multiply', 'screen', 'overlay', 'add'] as const, 'visual presentation blend mode');
}

function assertUnique(values: readonly string[], name: string): void {
	const seen = new Set<string>();
	for (const value of values) {
		if (seen.has(value)) throw new RangeError(`${name} identity ${value} is duplicated.`);
		seen.add(value);
	}
}

function field(record: ClosedDomainRecord, key: string, name: string): unknown {
	return readClosedDomainField(record, key, name);
}

function exact<const Value extends string | number>(value: unknown, expected: Value, name: string): Value {
	if (value !== expected) throw new RangeError(`${name} is unsupported.`);
	return expected;
}

function oneOf<const Values extends readonly string[]>(value: unknown, values: Values, name: string): Values[number] {
	if (typeof value !== 'string' || !values.includes(value)) throw new RangeError(`${name} is unsupported.`);
	return value as Values[number];
}

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !ID.test(value)) throw new TypeError(`${name} must be a stable ID.`);
	return value;
}

function optionalId(value: unknown, name: string): string | null {
	return value === null ? null : stableId(value, name);
}

function boolean(value: unknown, name: string): boolean {
	if (typeof value !== 'boolean') throw new TypeError(`${name} must be boolean.`);
	return value;
}

function bounded(value: unknown, minimum: number, maximum: number, name: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
		throw new RangeError(`${name} is outside its finite bound.`);
	}
	return Object.is(value, -0) ? 0 : value;
}

function safeName(value: unknown): string {
	if (typeof value !== 'string' || value.length < 1 || value.length > 512
		|| value.normalize('NFC') !== value || UNSAFE_TEXT.test(value) || /[\r\n]/u.test(value)) {
		throw new TypeError('A video finishing preset name must be canonical safe text.');
	}
	return value;
}
