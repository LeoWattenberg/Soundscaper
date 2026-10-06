/* SPDX-License-Identifier: AGPL-3.0-only */

type Bounds = Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>;
interface Point { readonly x: number; readonly y: number }

/** The bounded paths directly connecting a help trigger and its explanation. */
export function withinHelpTooltipPointerPath(
	point: Readonly<{ clientX: number; clientY: number }>,
	trigger: Bounds,
	explanation: Bounds,
): boolean {
	const points = [trigger, explanation].flatMap((bounds) => [
		{ x: bounds.left, y: bounds.top }, { x: bounds.right, y: bounds.top },
		{ x: bounds.left, y: bounds.bottom }, { x: bounds.right, y: bounds.bottom },
	]).sort((a, b) => a.x - b.x || a.y - b.y);
	const half = (ordered: readonly Point[]): Point[] => {
		const result: Point[] = [];
		for (const next of ordered) {
			while (result.length >= 2 && cross(result[result.length - 2]!, result[result.length - 1]!, next) <= 0) result.pop();
			result.push(next);
		}
		return result.slice(0, -1);
	};
	const hull = [...half(points), ...half([...points].reverse())];
	if (hull.length < 3) return false;
	const pointer = { x: point.clientX, y: point.clientY };
	return hull.every((start, index) => cross(start, hull[(index + 1) % hull.length]!, pointer) >= 0);
}

function cross(start: Point, end: Point, point: Point): number {
	return (end.x - start.x) * (point.y - start.y) - (end.y - start.y) * (point.x - start.x);
}
