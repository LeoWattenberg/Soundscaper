/* SPDX-License-Identifier: AGPL-3.0-only */

export const SOUNDSCAPER_PROJECT_SCHEMA_FAMILY = 'soundscaper' as const;
export const FRAMESCAPER_PROJECT_SCHEMA_FAMILY = 'framescaper' as const;
export const PROJECT_SCHEMA_VERSION = 1 as const;

export const PROJECT_SCHEMA_FAMILIES = Object.freeze([
	SOUNDSCAPER_PROJECT_SCHEMA_FAMILY,
	FRAMESCAPER_PROJECT_SCHEMA_FAMILY,
] as const);

export type ProjectSchemaFamily = (typeof PROJECT_SCHEMA_FAMILIES)[number];

export interface ProjectSchemaIdentity {
	readonly schemaFamily: ProjectSchemaFamily;
	readonly schemaVersion: number;
}

export type ProjectSchemaDisposition = 'current' | 'foreign' | 'future';

export interface ClassifiedProjectSchemaIdentity {
	readonly identity: Readonly<ProjectSchemaIdentity>;
	readonly disposition: ProjectSchemaDisposition;
}

/**
 * A numeric-only project belongs to a pre-release namespace whose numbers were
 * shared by both products. It cannot be identified safely in the 1.0 baseline.
 */
export class ProjectReimportRequiredError extends RangeError {
	readonly code = 'REIMPORT_REQUIRED' as const;
	readonly schemaVersion: number;
	readonly currentSchemaVersion = PROJECT_SCHEMA_VERSION;

	constructor(schemaVersion: number) {
		super(
			`Project schema ${String(schemaVersion)} predates the family-qualified 1.0 baseline; re-import the source media.`,
		);
		this.name = 'ProjectReimportRequiredError';
		this.schemaVersion = schemaVersion;
	}
}

/** Read only the closed identity tuple; no product-owned field is traversed. */
export function readProjectSchemaIdentity(value: unknown): Readonly<ProjectSchemaIdentity> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('A project schema identity requires an object.');
	}
	const schemaFamilyDescriptor = Object.getOwnPropertyDescriptor(value, 'schemaFamily');
	const schemaVersionDescriptor = Object.getOwnPropertyDescriptor(value, 'schemaVersion');
	if (!schemaFamilyDescriptor) {
		const numericVersion = enumerableDataValue(schemaVersionDescriptor);
		if (typeof numericVersion === 'number'
			&& Number.isSafeInteger(numericVersion) && numericVersion > 0) {
			throw new ProjectReimportRequiredError(numericVersion);
		}
		if (schemaVersionDescriptor && (!schemaVersionDescriptor.enumerable
			|| !Object.hasOwn(schemaVersionDescriptor, 'value'))) {
			throw new TypeError('Project schemaVersion must be an own enumerable data property.');
		}
		throw new TypeError('The project schema identity is incomplete.');
	}
	const schemaFamily = requiredEnumerableDataValue(schemaFamilyDescriptor, 'schemaFamily');
	const schemaVersion = requiredEnumerableDataValue(schemaVersionDescriptor, 'schemaVersion');
	if (!isProjectSchemaFamily(schemaFamily)) {
		throw new RangeError(`Unsupported project schema family: ${String(schemaFamily)}.`);
	}
	if (typeof schemaVersion !== 'number'
		|| !Number.isSafeInteger(schemaVersion) || schemaVersion < 1) {
		throw new RangeError('Project schemaVersion must be a positive safe integer.');
	}
	return Object.freeze({ schemaFamily, schemaVersion });
}

export function classifyProjectSchemaIdentity(
	value: unknown,
	currentFamily: ProjectSchemaFamily,
): Readonly<ClassifiedProjectSchemaIdentity> {
	if (!isProjectSchemaFamily(currentFamily)) {
		throw new TypeError(`Unsupported current project schema family: ${String(currentFamily)}.`);
	}
	const identity = readProjectSchemaIdentity(value);
	const disposition: ProjectSchemaDisposition = identity.schemaFamily !== currentFamily
		? 'foreign'
		: identity.schemaVersion === PROJECT_SCHEMA_VERSION ? 'current' : 'future';
	return Object.freeze({ identity, disposition });
}

export function isCurrentProjectSchemaIdentity(
	value: unknown,
	currentFamily: ProjectSchemaFamily,
): boolean {
	try {
		return classifyProjectSchemaIdentity(value, currentFamily).disposition === 'current';
	} catch {
		return false;
	}
}

export function isProjectSchemaFamily(value: unknown): value is ProjectSchemaFamily {
	return value === SOUNDSCAPER_PROJECT_SCHEMA_FAMILY
		|| value === FRAMESCAPER_PROJECT_SCHEMA_FAMILY;
}

function requiredEnumerableDataValue(
	descriptor: PropertyDescriptor | undefined,
	field: 'schemaFamily' | 'schemaVersion',
): unknown {
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`Project ${field} must be an own enumerable data property.`);
	}
	return descriptor.value;
}

function enumerableDataValue(descriptor: PropertyDescriptor | undefined): unknown {
	return descriptor?.enumerable && Object.hasOwn(descriptor, 'value')
		? descriptor.value
		: undefined;
}
