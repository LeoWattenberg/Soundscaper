/* SPDX-License-Identifier: AGPL-3.0-only */

export const TAKE_COMP_MAXIMUM_ID_CHARACTERS = 160;
export const TAKE_COMP_MAXIMUM_ENTITIES = 4_096;

declare const takeCompGroupIdBrand: unique symbol;
declare const takeLaneIdBrand: unique symbol;
declare const takeIdBrand: unique symbol;
declare const compRegionIdBrand: unique symbol;

export type TakeCompGroupId = string & { readonly [takeCompGroupIdBrand]: true };
export type TakeLaneId = string & { readonly [takeLaneIdBrand]: true };
export type TakeId = string & { readonly [takeIdBrand]: true };
export type CompRegionId = string & { readonly [compRegionIdBrand]: true };

export interface TakeCompLane {
	readonly id: TakeLaneId;
}

export interface TakeCompTake {
	readonly id: TakeId;
	readonly laneId: TakeLaneId;
}

export interface TakeCompRegion {
	readonly id: CompRegionId;
	readonly takeId: TakeId;
	readonly startSample: number;
	readonly endSample: number;
}

export interface TakeCompGroup {
	readonly id: TakeCompGroupId;
	readonly startSample: number;
	readonly endSample: number;
	readonly laneOrder: readonly TakeLaneId[];
	readonly lanes: readonly TakeCompLane[];
	readonly takes: readonly TakeCompTake[];
	readonly compRegions: readonly TakeCompRegion[];
}

export interface TakeAuditionPlan {
	readonly kind: 'audition-take';
	readonly groupId: TakeCompGroupId;
	readonly takeId: TakeId;
	readonly laneId: TakeLaneId;
	readonly startSample: number;
	readonly endSample: number;
}

export interface TakePromotionRequest {
	readonly takeId: string;
	readonly regionId: string;
	readonly startSample?: number;
	readonly endSample?: number;
	readonly rightRemainderRegionId?: string;
}

export interface TakePromotionPlan {
	readonly kind: 'promote-take';
	readonly groupId: TakeCompGroupId;
	readonly takeId: TakeId;
	readonly laneId: TakeLaneId;
	readonly promotedRegion: TakeCompRegion;
	readonly nextGroup: TakeCompGroup;
}

export type CompRegionBoundaryEdge = 'start' | 'end';

export interface CompRegionBoundaryEditRequest {
	readonly regionId: string;
	readonly edge: CompRegionBoundaryEdge;
	readonly boundarySample: number;
}

export interface CompRegionBoundaryEditPlan {
	readonly kind: 'edit-comp-region-boundary';
	readonly groupId: TakeCompGroupId;
	readonly regionId: CompRegionId;
	readonly edge: CompRegionBoundaryEdge;
	readonly previousBoundarySample: number;
	readonly boundarySample: number;
	readonly nextGroup: TakeCompGroup;
}

export interface SharedCompBoundaryEditRequest {
	readonly leftRegionId: string;
	readonly rightRegionId: string;
	readonly boundarySample: number;
}

export interface SharedCompBoundaryEditPlan {
	readonly kind: 'edit-shared-comp-boundary';
	readonly groupId: TakeCompGroupId;
	readonly leftRegionId: CompRegionId;
	readonly rightRegionId: CompRegionId;
	readonly previousBoundarySample: number;
	readonly boundarySample: number;
	readonly nextGroup: TakeCompGroup;
}

export interface TakeCompFlattenRequest {
	readonly operationId: string;
	readonly outputId: string;
}

export interface TakeCompFlattenTakeSegment {
	readonly kind: 'take';
	readonly compRegionId: CompRegionId;
	readonly takeId: TakeId;
	readonly laneId: TakeLaneId;
	readonly startSample: number;
	readonly endSample: number;
}

export interface TakeCompFlattenSilenceSegment {
	readonly kind: 'silence';
	readonly startSample: number;
	readonly endSample: number;
}

export type TakeCompFlattenSegment = TakeCompFlattenTakeSegment | TakeCompFlattenSilenceSegment;

export interface TakeCompFlattenPlan {
	readonly kind: 'flatten-take-comp';
	readonly operationId: string;
	readonly outputId: string;
	readonly groupId: TakeCompGroupId;
	readonly startSample: number;
	readonly endSample: number;
	readonly segments: readonly TakeCompFlattenSegment[];
	readonly preFlattenSnapshot: TakeCompGroup;
}

type DataRecord = Readonly<Record<string, unknown>>;

export function normalizeTakeCompGroupId(value: unknown): TakeCompGroupId {
	return stableId(value, 'take group ID') as TakeCompGroupId;
}

export function normalizeTakeLaneId(value: unknown): TakeLaneId {
	return stableId(value, 'take lane ID') as TakeLaneId;
}

export function normalizeTakeId(value: unknown): TakeId {
	return stableId(value, 'take ID') as TakeId;
}

export function normalizeCompRegionId(value: unknown): CompRegionId {
	return stableId(value, 'comp region ID') as CompRegionId;
}

/** Capture and validate a schema-independent take/comp identity graph. */
export function normalizeTakeCompGroup(value: unknown): TakeCompGroup {
	const input = closedRecord(value, 'take comp group', [
		'id', 'startSample', 'endSample', 'laneOrder', 'lanes', 'takes', 'compRegions',
	]);
	const id = normalizeTakeCompGroupId(input.id);
	const startSample = nonNegativeSafeInteger(input.startSample, 'take group startSample');
	const endSample = nonNegativeSafeInteger(input.endSample, 'take group endSample');
	if (endSample <= startSample) throw new RangeError('Take group extent must be positive.');

	const laneValues = denseArray(input.lanes, 'take comp group lanes');
	if (laneValues.length === 0) throw new RangeError('A take comp group requires at least one take lane.');
	const laneIds = new Set<string>();
	const lanes = laneValues.map((laneValue, index): TakeCompLane => {
		const lane = closedRecord(laneValue, `take comp group lanes[${String(index)}]`, ['id']);
		const laneId = normalizeTakeLaneId(lane.id);
		if (laneIds.has(laneId)) throw new RangeError(`Duplicate take lane ID ${laneId}.`);
		laneIds.add(laneId);
		return Object.freeze({ id: laneId });
	});

	const orderValues = denseArray(input.laneOrder, 'take comp group laneOrder');
	const orderedIds = new Set<string>();
	const laneOrder = orderValues.map((laneIdValue): TakeLaneId => {
		const laneId = normalizeTakeLaneId(laneIdValue);
		if (orderedIds.has(laneId)) {
			throw new RangeError(`Take comp group laneOrder cannot contain duplicate lane ID ${laneId}.`);
		}
		orderedIds.add(laneId);
		if (!laneIds.has(laneId)) {
			throw new ReferenceError(`Take comp group laneOrder references missing take lane ${laneId}.`);
		}
		return laneId;
	});
	if (laneOrder.length !== lanes.length) {
		throw new RangeError('Take comp group laneOrder must contain every take lane exactly once.');
	}
	const laneIndex = new Map(laneOrder.map((laneId, index) => [laneId, index]));
	const orderedLanes = laneOrder.map((laneId) => lanes.find((lane) => lane.id === laneId)!);

	const takeValues = denseArray(input.takes, 'take comp group takes');
	if (takeValues.length === 0) throw new RangeError('A take comp group requires at least one take.');
	const takeIds = new Set<string>();
	const takes = takeValues.map((takeValue, index): TakeCompTake => {
		const take = closedRecord(takeValue, `take comp group takes[${String(index)}]`, ['id', 'laneId']);
		const takeId = normalizeTakeId(take.id);
		if (takeIds.has(takeId)) throw new RangeError(`Duplicate take ID ${takeId}.`);
		takeIds.add(takeId);
		const laneId = normalizeTakeLaneId(take.laneId);
		if (!laneIds.has(laneId)) throw new ReferenceError(`Take ${takeId} references missing lane ${laneId}.`);
		return Object.freeze({ id: takeId, laneId });
	}).sort((left, right) => (
		(laneIndex.get(left.laneId)! - laneIndex.get(right.laneId)!) || compareIds(left.id, right.id)
	));

	const regionValues = denseArray(input.compRegions, 'take comp group compRegions');
	const regionIds = new Set<string>();
	let previousStart = -1;
	let previousEnd = -1;
	const compRegions = regionValues.map((regionValue, index): TakeCompRegion => {
		const region = closedRecord(regionValue, `take comp group compRegions[${String(index)}]`, [
			'id', 'takeId', 'startSample', 'endSample',
		]);
		const regionId = normalizeCompRegionId(region.id);
		if (regionIds.has(regionId)) throw new RangeError(`Duplicate comp region ID ${regionId}.`);
		regionIds.add(regionId);
		const takeId = normalizeTakeId(region.takeId);
		if (!takeIds.has(takeId)) {
			throw new ReferenceError(`Comp region ${regionId} references missing take ${takeId}.`);
		}
		const regionStart = nonNegativeSafeInteger(region.startSample, `comp region ${regionId} startSample`);
		const regionEnd = nonNegativeSafeInteger(region.endSample, `comp region ${regionId} endSample`);
		if (regionEnd <= regionStart) throw new RangeError(`Comp region ${regionId} must have positive extent.`);
		if (regionStart < startSample || regionEnd > endSample) {
			throw new RangeError(`Comp region ${regionId} must remain within take group ${id}.`);
		}
		if (regionStart < previousStart) throw new RangeError('Comp regions must be ordered by startSample.');
		if (regionStart < previousEnd) throw new RangeError('Comp regions must not overlap.');
		previousStart = regionStart;
		previousEnd = regionEnd;
		return Object.freeze({ id: regionId, takeId, startSample: regionStart, endSample: regionEnd });
	});

	const identities = [id, ...laneIds, ...takeIds, ...regionIds];
	if (identities.length > TAKE_COMP_MAXIMUM_ENTITIES) {
		throw new RangeError(`Take comp domain exceeds ${String(TAKE_COMP_MAXIMUM_ENTITIES)} identities.`);
	}
	const allIds = new Set<string>();
	for (const identity of identities) {
		if (allIds.has(identity)) throw new RangeError(`Duplicate domain identity ${identity}.`);
		allIds.add(identity);
	}

	return Object.freeze({
		id, startSample, endSample,
		laneOrder: Object.freeze(laneOrder),
		lanes: Object.freeze(orderedLanes),
		takes: Object.freeze(takes),
		compRegions: Object.freeze(compRegions),
	});
}

/** Resolve one take audition without mutating project or playback state. */
export function planTakeAudition(groupValue: unknown, takeIdValue: unknown): TakeAuditionPlan {
	const group = normalizeTakeCompGroup(groupValue);
	const takeId = normalizeTakeId(takeIdValue);
	const take = group.takes.find(({ id }) => id === takeId);
	if (!take) throw new ReferenceError(`Take ${takeId} does not belong to take group ${group.id}.`);
	return Object.freeze({
		kind: 'audition-take', groupId: group.id, takeId: take.id, laneId: take.laneId,
		startSample: group.startSample, endSample: group.endSample,
	});
}

/** Replace one comp interval with a promoted take. Split identities are always caller-supplied. */
export function planTakePromotion(
	groupValue: unknown,
	requestValue: TakePromotionRequest,
): TakePromotionPlan {
	const group = normalizeTakeCompGroup(groupValue);
	const request = closedRecord(requestValue, 'take promotion request', ['takeId', 'regionId'], [
		'startSample', 'endSample', 'rightRemainderRegionId',
	]);
	const takeId = normalizeTakeId(request.takeId);
	const take = group.takes.find(({ id }) => id === takeId);
	if (!take) throw new ReferenceError(`Take ${takeId} does not belong to take group ${group.id}.`);
	const regionId = normalizeCompRegionId(request.regionId);
	assertFreshIdentity(group, regionId);
	const startSample = Object.hasOwn(request, 'startSample')
		? nonNegativeSafeInteger(request.startSample, 'take promotion startSample') : group.startSample;
	const endSample = Object.hasOwn(request, 'endSample')
		? nonNegativeSafeInteger(request.endSample, 'take promotion endSample') : group.endSample;
	assertExtent(group, startSample, endSample, 'Take promotion');
	const rightRemainderId = Object.hasOwn(request, 'rightRemainderRegionId')
		? normalizeCompRegionId(request.rightRemainderRegionId) : null;
	if (rightRemainderId) assertFreshIdentity(group, rightRemainderId, regionId);

	let usedRightRemainderId = false;
	const nextRegions: TakeCompRegion[] = [];
	for (const region of group.compRegions) {
		if (region.endSample <= startSample || region.startSample >= endSample) {
			nextRegions.push(region);
			continue;
		}
		const retainsLeft = region.startSample < startSample;
		const retainsRight = region.endSample > endSample;
		if (retainsLeft) {
			nextRegions.push(Object.freeze({ ...region, endSample: startSample }));
		}
		if (retainsRight) {
			if (retainsLeft && !rightRemainderId) {
				throw new RangeError('take promotion rightRemainderRegionId is required when one region is split.');
			}
			const id = retainsLeft ? rightRemainderId! : region.id;
			usedRightRemainderId ||= retainsLeft;
			nextRegions.push(Object.freeze({ ...region, id, startSample: endSample }));
		}
	}
	if (rightRemainderId && !usedRightRemainderId) {
		throw new RangeError('take promotion rightRemainderRegionId is only valid when one region is split.');
	}
	const promotedRegion = Object.freeze({ id: regionId, takeId, startSample, endSample });
	nextRegions.push(promotedRegion);
	nextRegions.sort(compareRegions);
	const nextGroup = groupWithRegions(group, nextRegions);
	return Object.freeze({
		kind: 'promote-take', groupId: group.id, takeId, laneId: take.laneId,
		promotedRegion: nextGroup.compRegions.find(({ id }) => id === regionId)!, nextGroup,
	});
}

/** Move one region edge, allowing a deliberate gap but never an overlap. */
export function planCompRegionBoundaryEdit(
	groupValue: unknown,
	requestValue: CompRegionBoundaryEditRequest,
): CompRegionBoundaryEditPlan {
	const group = normalizeTakeCompGroup(groupValue);
	const request = closedRecord(requestValue, 'comp boundary edit request', [
		'regionId', 'edge', 'boundarySample',
	]);
	const regionId = normalizeCompRegionId(request.regionId);
	if (request.edge !== 'start' && request.edge !== 'end') {
		throw new RangeError('Comp boundary edit edge must be start or end.');
	}
	const boundarySample = nonNegativeSafeInteger(request.boundarySample, 'comp boundary edit sample');
	const regionIndex = group.compRegions.findIndex(({ id }) => id === regionId);
	if (regionIndex < 0) throw new ReferenceError(`Comp region ${regionId} does not belong to take group ${group.id}.`);
	const region = group.compRegions[regionIndex]!;
	const previousBoundarySample = request.edge === 'start' ? region.startSample : region.endSample;
	const nextRegions = group.compRegions.map((candidate, index) => index === regionIndex
		? Object.freeze({
			...candidate,
			...(request.edge === 'start' ? { startSample: boundarySample } : { endSample: boundarySample }),
		})
		: candidate);
	const nextGroup = groupWithRegions(group, nextRegions);
	return Object.freeze({
		kind: 'edit-comp-region-boundary', groupId: group.id, regionId,
		edge: request.edge, previousBoundarySample, boundarySample, nextGroup,
	});
}

/** Move a contiguous handoff while preserving both adjacent comp regions. */
export function planSharedCompBoundaryEdit(
	groupValue: unknown,
	requestValue: SharedCompBoundaryEditRequest,
): SharedCompBoundaryEditPlan {
	const group = normalizeTakeCompGroup(groupValue);
	const request = closedRecord(requestValue, 'shared comp boundary edit request', [
		'leftRegionId', 'rightRegionId', 'boundarySample',
	]);
	const leftRegionId = normalizeCompRegionId(request.leftRegionId);
	const rightRegionId = normalizeCompRegionId(request.rightRegionId);
	const leftIndex = group.compRegions.findIndex(({ id }) => id === leftRegionId);
	const rightIndex = group.compRegions.findIndex(({ id }) => id === rightRegionId);
	if (leftIndex < 0 || rightIndex < 0) {
		throw new ReferenceError('Shared comp boundary regions must belong to the same take group.');
	}
	const left = group.compRegions[leftIndex]!;
	const right = group.compRegions[rightIndex]!;
	if (rightIndex !== leftIndex + 1 || left.endSample !== right.startSample) {
		throw new RangeError('Shared comp boundary regions must be adjacent and must share one boundary.');
	}
	const boundarySample = nonNegativeSafeInteger(request.boundarySample, 'shared comp boundary edit sample');
	const nextRegions = group.compRegions.map((region, index) => {
		if (index === leftIndex) return Object.freeze({ ...region, endSample: boundarySample });
		if (index === rightIndex) return Object.freeze({ ...region, startSample: boundarySample });
		return region;
	});
	const nextGroup = groupWithRegions(group, nextRegions);
	return Object.freeze({
		kind: 'edit-shared-comp-boundary', groupId: group.id, leftRegionId, rightRegionId,
		previousBoundarySample: left.endSample, boundarySample, nextGroup,
	});
}

/** Produce an exact render partition and retain the immutable domain state needed to undo flattening. */
export function planTakeCompFlatten(
	groupValue: unknown,
	requestValue: TakeCompFlattenRequest,
): TakeCompFlattenPlan {
	const group = normalizeTakeCompGroup(groupValue);
	const request = closedRecord(requestValue, 'take comp flatten request', ['operationId', 'outputId']);
	const operationId = stableId(request.operationId, 'take comp flatten operationId');
	const outputId = stableId(request.outputId, 'take comp flatten outputId');
	if (operationId === outputId) throw new RangeError('Flatten operationId and outputId must be distinct.');
	assertFreshIdentity(group, operationId);
	assertFreshIdentity(group, outputId, operationId);
	const takeById = new Map(group.takes.map((take) => [take.id, take]));
	const segments: TakeCompFlattenSegment[] = [];
	let cursor = group.startSample;
	for (const region of group.compRegions) {
		if (cursor < region.startSample) {
			segments.push(Object.freeze({ kind: 'silence', startSample: cursor, endSample: region.startSample }));
		}
		const take = takeById.get(region.takeId)!;
		segments.push(Object.freeze({
			kind: 'take', compRegionId: region.id, takeId: region.takeId, laneId: take.laneId,
			startSample: region.startSample, endSample: region.endSample,
		}));
		cursor = region.endSample;
	}
	if (cursor < group.endSample) {
		segments.push(Object.freeze({ kind: 'silence', startSample: cursor, endSample: group.endSample }));
	}
	return Object.freeze({
		kind: 'flatten-take-comp', operationId, outputId, groupId: group.id,
		startSample: group.startSample, endSample: group.endSample,
		segments: Object.freeze(segments), preFlattenSnapshot: group,
	});
}

function groupWithRegions(group: TakeCompGroup, compRegions: readonly TakeCompRegion[]): TakeCompGroup {
	return normalizeTakeCompGroup({ ...group, compRegions });
}

function assertFreshIdentity(group: TakeCompGroup, value: string, additionallyReserved?: string): void {
	if (value === additionallyReserved || domainIdentitySet(group).has(value)) {
		throw new RangeError(`Identity ${value} collides with domain identity ${value}.`);
	}
}

function domainIdentitySet(group: TakeCompGroup): ReadonlySet<string> {
	return new Set([
		group.id,
		...group.lanes.map(({ id }) => id),
		...group.takes.map(({ id }) => id),
		...group.compRegions.map(({ id }) => id),
	]);
}

function assertExtent(group: TakeCompGroup, startSample: number, endSample: number, name: string): void {
	if (endSample <= startSample) throw new RangeError(`${name} must have positive extent.`);
	if (startSample < group.startSample || endSample > group.endSample) {
		throw new RangeError(`${name} must remain within take group ${group.id}.`);
	}
}

function compareIds(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function compareRegions(left: TakeCompRegion, right: TakeCompRegion): number {
	return left.startSample - right.startSample
		|| left.endSample - right.endSample
		|| compareIds(left.id, right.id);
}

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !value.length || value !== value.trim()
		|| value !== value.normalize('NFC') || /[\u0000-\u001f\u007f]/u.test(value)) {
		throw new TypeError(`${name} must be a canonical non-empty string.`);
	}
	if (value.length > TAKE_COMP_MAXIMUM_ID_CHARACTERS) {
		throw new RangeError(`${name} cannot exceed ${String(TAKE_COMP_MAXIMUM_ID_CHARACTERS)} characters.`);
	}
	return value;
}

function nonNegativeSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) {
		throw new RangeError(`${name} must be a non-negative safe integer.`);
	}
	return Number(value);
}

function closedRecord(
	value: unknown,
	name: string,
	requiredKeys: readonly string[],
	optionalKeys: readonly string[] = [],
): DataRecord {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`${name} must be a closed data record.`);
	}
	const record = value as Record<PropertyKey, unknown>;
	const keys = Reflect.ownKeys(record);
	const allowed = new Set([...requiredKeys, ...optionalKeys]);
	if (keys.some((key) => typeof key !== 'string' || !allowed.has(key))
		|| requiredKeys.some((key) => !keys.includes(key))) {
		throw new TypeError(`${name} has an invalid closed shape.`);
	}
	const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
	for (const key of keys) {
		const descriptor = Object.getOwnPropertyDescriptor(record, key);
		if (typeof key !== 'string' || !descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name}.${String(key)} must be an enumerable data property.`);
		}
		result[key] = descriptor.value;
	}
	return Object.freeze(result);
}

function denseArray(value: unknown, name: string): readonly unknown[] {
	if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
		throw new TypeError(`${name} must be a standard dense data array.`);
	}
	const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
	const length = lengthDescriptor && Object.hasOwn(lengthDescriptor, 'value')
		? lengthDescriptor.value : null;
	if (!Number.isSafeInteger(length) || Number(length) < 0
		|| Number(length) > TAKE_COMP_MAXIMUM_ENTITIES) {
		throw new RangeError(`${name} must be an array with at most ${String(TAKE_COMP_MAXIMUM_ENTITIES)} items.`);
	}
	if (Reflect.ownKeys(value).length !== Number(length) + 1) {
		throw new TypeError(`${name} must be dense and carry no extra keys.`);
	}
	const result: unknown[] = [];
	for (let index = 0; index < Number(length); index += 1) {
		const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name} must contain only enumerable data items.`);
		}
		result.push(descriptor.value);
	}
	return Object.freeze(result);
}
