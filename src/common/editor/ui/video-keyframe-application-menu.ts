/* SPDX-License-Identifier: AGPL-3.0-only */

export interface VideoKeyframeApplicationMenuInput {
	readonly productId: string;
	readonly capability: boolean;
	readonly project: unknown;
	readonly selectedClipId: string | null;
	readonly editingBlocked: boolean;
	readonly copy: Readonly<Record<string, string>>;
	open(): unknown;
}

const MAXIMUM_VIDEO_KEYFRAME_MENU_ITEMS = 200_000;
interface MenuBudget { remaining: number }

/** A V20-only menu entry; false capability and every V19 document receive no item. */
export function createVideoKeyframeApplicationMenuItems(input: VideoKeyframeApplicationMenuInput) {
	if (input.productId !== 'framescaper' || !input.capability) return Object.freeze([]);
	const selected = lightweightSelection(input.project, input.selectedClipId);
	if (selected === 'unsupported') return Object.freeze([]);
	return Object.freeze([Object.freeze({
		id: 'video-keyframes-editor',
		label: input.copy.videoKeyframesMenu || 'Video keyframes…',
		disabled: !selected || selected.locked || input.editingBlocked,
		onClick: input.open,
	})]);
}

/** Deliberately does not traverse videoKeyframes; the lazy dialog owns full normalization. */
function lightweightSelection(
	value: unknown,
	focusedId: string | null,
): Readonly<{ readonly locked: boolean }> | 'unsupported' | null {
	const project = dataRecord(value);
	if (!project || data(project, 'schemaVersion') !== 20) return 'unsupported';
	const budget = { remaining: MAXIMUM_VIDEO_KEYFRAME_MENU_ITEMS };
	const clips = dataRecords(data(project, 'clips'), budget);
	const tracks = dataRecords(data(project, 'tracks'), budget);
	if (!clips || !tracks) return null;
	const clipById = new Map<string, Readonly<Record<string, unknown>>>();
	for (const clip of clips) {
		const id = data(clip, 'id');
		if (typeof id !== 'string' || clipById.has(id)) return null;
		clipById.set(id, clip);
	}
	const selection = dataRecord(data(project, 'selection'));
	const selectedIds = stringList(selection ? data(selection, 'clipIds') : undefined, budget) ?? [];
	let targetIds: readonly string[] = selectedIds.length > 0 ? selectedIds : focusedId ? [focusedId] : [];
	if (focusedId && selectedIds.includes(focusedId)) {
		const focused = clipById.get(focusedId);
		const selectedVideoCount = selectedIds.filter((id) => data(clipById.get(id) ?? {}, 'kind') === 'video').length;
		if (data(focused ?? {}, 'kind') === 'video' && selectedVideoCount === 1) targetIds = [focusedId];
	}
	if (targetIds.length !== 1) return null;
	const clip = clipById.get(targetIds[0]!);
	if (data(clip ?? {}, 'kind') !== 'video') return null;
	const keyframes = clip ? Object.getOwnPropertyDescriptor(clip, 'videoKeyframes') : null;
	if (!keyframes?.enumerable || !Object.hasOwn(keyframes, 'value')) return null;
	let owner: Readonly<Record<string, unknown>> | null = null;
	for (const track of tracks) {
		if (data(track, 'type') !== 'video') continue;
		const clipIds = stringList(data(track, 'clipIds'), budget);
		if (!clipIds) return null;
		if (!clipIds.includes(targetIds[0]!)) continue;
		if (owner) return null;
		owner = track;
	}
	return owner ? Object.freeze({ locked: data(owner, 'locked') === true }) : null;
}

function dataRecords(value: unknown, budget: MenuBudget): readonly Readonly<Record<string, unknown>>[] | null {
	if (!ordinaryArray(value) || !charge(budget, value.length)) return null;
	const result: Readonly<Record<string, unknown>>[] = [];
	for (let index = 0; index < value.length; index += 1) {
		const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
		const record = descriptor?.enumerable && Object.hasOwn(descriptor, 'value')
			? dataRecord(descriptor.value) : null;
		if (!record) return null;
		result.push(record);
	}
	return result;
}

function stringList(value: unknown, budget: MenuBudget): readonly string[] | null {
	if (!ordinaryArray(value) || !charge(budget, value.length)) return null;
	const result: string[] = [];
	for (let index = 0; index < value.length; index += 1) {
		const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'string') return null;
		result.push(descriptor.value);
	}
	return result;
}

function dataRecord(value: unknown): Readonly<Record<string, unknown>> | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null
		? value as Readonly<Record<string, unknown>> : null;
}

function ordinaryArray(value: unknown): value is unknown[] {
	return Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype;
}

function charge(budget: MenuBudget, amount: number): boolean {
	if (!Number.isSafeInteger(amount) || amount < 0 || amount > budget.remaining) return false;
	budget.remaining -= amount;
	return true;
}

function data(value: Readonly<Record<string, unknown>>, key: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	return descriptor?.enumerable && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
}
