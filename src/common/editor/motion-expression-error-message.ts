/* SPDX-License-Identifier: AGPL-3.0-only */
import { MotionExpressionError } from './motion-expression-ast.ts';
import { MotionExpressionPropertyError } from './motion-expression-runtime.ts';
import type { MotionscaperProject } from './motion-project-types.ts';

function expressionMessage(failure: MotionExpressionError, project: MotionscaperProject, sourcePositionLabel?: string): string {
	let address = '';
	if (failure instanceof MotionExpressionPropertyError) {
		const composition = project.compositions.find(({ id }) => id === failure.compositionId);
		const owner = composition?.layers.find(({ id }) => id === failure.layerId);
		address = `${owner?.name ?? failure.layerId} ${failure.propertyPath}: `;
	}
	const span = `${failure.diagnostic.start + 1}–${failure.diagnostic.end + 1}`;
	return `${address}${sourcePositionLabel ? `${sourcePositionLabel} ` : ''}${span}: ${failure.message}`;
}

/** Describe only expression failures; preserve aggregate cleanup messages and never mutate error capabilities. */
export function motionExpressionErrorMessage(failure: unknown, project: MotionscaperProject, sourcePositionLabel?: string): string | null {
	const pending = [failure], visited = new Set<unknown>(), messages: string[] = []; let found = false;
	while (pending.length && visited.size < 32) {
		const value = pending.pop(); if (visited.has(value)) continue; visited.add(value);
		if (value instanceof MotionExpressionError) { found = true; messages.push(expressionMessage(value, project, sourcePositionLabel)); }
		else if (value instanceof Error) messages.push(value.message);
		if (value instanceof AggregateError) {
			const errors: unknown = Object.getOwnPropertyDescriptor(value, 'errors')?.value;
			if (Array.isArray(errors)) {
				const count = Math.min(errors.length, 32 - visited.size - pending.length);
				for (let index = count - 1; index >= 0; index--) pending.push(Object.getOwnPropertyDescriptor(errors, String(index))?.value as unknown);
			}
		}
	}
	return found ? messages.join(' ') : null;
}
