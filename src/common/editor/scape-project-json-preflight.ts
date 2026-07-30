/* SPDX-License-Identifier: AGPL-3.0-only */

export interface ScapeProjectJsonStructureLimits {
	readonly maximumTraversalNodes: number;
	readonly maximumTraversalDepth: number;
}

type ArrayState = 'value-or-end' | 'value' | 'comma-or-end';
type ObjectState = 'key-or-end' | 'key' | 'colon' | 'value' | 'comma-or-end';

interface ArrayFrame {
	readonly kind: 'array';
	state: ArrayState;
}

interface ObjectFrame {
	readonly kind: 'object';
	state: ObjectState;
}

type JsonFrame = ArrayFrame | ObjectFrame;

interface ValueStart {
	readonly nextIndex: number;
	readonly frame?: JsonFrame;
}

/**
 * Count JSON values and nesting before JSON.parse allocates the object graph.
 *
 * This is deliberately a structural admission pass rather than a second JSON
 * parser. Valid JSON is counted exactly (duplicate object members are counted
 * conservatively); malformed input may stop the pass and remains JSON.parse's
 * responsibility unless it has already exhausted a structural budget.
 */
export function preflightScapeProjectJsonStructure(
	text: string,
	limits: Readonly<ScapeProjectJsonStructureLimits>,
): void {
	const frames: JsonFrame[] = [];
	let index = 0;
	let nodes = 0;
	let rootPending = true;
	while (true) {
		index = skipWhitespace(text, index);
		if (index >= text.length) return;
		const frame = frames[frames.length - 1];
		if (!frame) {
			if (!rootPending) return;
			const started = startValue(text, index, 0, limits, () => { nodes += 1; });
			if (!started) return;
			rootPending = false;
			index = started.nextIndex;
			if (started.frame) frames.push(started.frame);
			continue;
		}
		if (frame.kind === 'array') {
			const result = scanArray(text, index, frame, frames.length, limits, () => { nodes += 1; });
			if (!result) return;
			index = result.nextIndex;
			if (result.close) frames.pop();
			else if (result.frame) frames.push(result.frame);
		} else {
			const result = scanObject(text, index, frame, frames.length, limits, () => { nodes += 1; });
			if (!result) return;
			index = result.nextIndex;
			if (result.close) frames.pop();
			else if (result.frame) frames.push(result.frame);
		}
		if (nodes > limits.maximumTraversalNodes) {
			throw new RangeError('The Scape project JSON exceeds the structural traversal node limit.');
		}
	}
}

interface ScanResult extends ValueStart {
	readonly close?: true;
}

function scanArray(
	text: string,
	index: number,
	frame: ArrayFrame,
	depth: number,
	limits: Readonly<ScapeProjectJsonStructureLimits>,
	admitNode: () => void,
): ScanResult | null {
	const code = text.charCodeAt(index);
	if (frame.state === 'comma-or-end') {
		if (code === 0x2c) {
			frame.state = 'value';
			return { nextIndex: index + 1 };
		}
		return code === 0x5d ? { nextIndex: index + 1, close: true } : null;
	}
	if (frame.state === 'value-or-end' && code === 0x5d) {
		return { nextIndex: index + 1, close: true };
	}
	const started = startValue(text, index, depth, limits, admitNode);
	if (!started) return null;
	frame.state = 'comma-or-end';
	return started;
}

function scanObject(
	text: string,
	index: number,
	frame: ObjectFrame,
	depth: number,
	limits: Readonly<ScapeProjectJsonStructureLimits>,
	admitNode: () => void,
): ScanResult | null {
	const code = text.charCodeAt(index);
	if (frame.state === 'comma-or-end') {
		if (code === 0x2c) {
			frame.state = 'key';
			return { nextIndex: index + 1 };
		}
		return code === 0x7d ? { nextIndex: index + 1, close: true } : null;
	}
	if ((frame.state === 'key-or-end' || frame.state === 'key')) {
		if (frame.state === 'key-or-end' && code === 0x7d) {
			return { nextIndex: index + 1, close: true };
		}
		if (code !== 0x22) return null;
		const nextIndex = quotedStringEnd(text, index);
		if (nextIndex === null) return null;
		frame.state = 'colon';
		return { nextIndex };
	}
	if (frame.state === 'colon') {
		if (code !== 0x3a) return null;
		frame.state = 'value';
		return { nextIndex: index + 1 };
	}
	const started = startValue(text, index, depth, limits, admitNode);
	if (!started) return null;
	frame.state = 'comma-or-end';
	return started;
}

function startValue(
	text: string,
	index: number,
	depth: number,
	limits: Readonly<ScapeProjectJsonStructureLimits>,
	admitNode: () => void,
): ValueStart | null {
	if (depth > limits.maximumTraversalDepth) {
		throw new RangeError('The Scape project JSON exceeds the structural traversal depth limit.');
	}
	const code = text.charCodeAt(index);
	let result: ValueStart | null;
	if (code === 0x7b) {
		result = { nextIndex: index + 1, frame: { kind: 'object', state: 'key-or-end' } };
	} else if (code === 0x5b) {
		result = { nextIndex: index + 1, frame: { kind: 'array', state: 'value-or-end' } };
	} else if (code === 0x22) {
		const nextIndex = quotedStringEnd(text, index);
		result = nextIndex === null ? null : { nextIndex };
	} else if (isPrimitiveStart(code)) {
		result = { nextIndex: primitiveEnd(text, index + 1) };
	} else {
		result = null;
	}
	if (!result) return null;
	admitNode();
	return result;
}

function quotedStringEnd(text: string, start: number): number | null {
	for (let index = start + 1; index < text.length; index += 1) {
		const code = text.charCodeAt(index);
		if (code === 0x22) return index + 1;
		if (code === 0x5c) index += 1;
	}
	return null;
}

function primitiveEnd(text: string, start: number): number {
	let index = start;
	while (index < text.length) {
		const code = text.charCodeAt(index);
		if (isWhitespace(code) || code === 0x2c || code === 0x5d || code === 0x7d) break;
		index += 1;
	}
	return index;
}

function skipWhitespace(text: string, start: number): number {
	let index = start;
	while (index < text.length && isWhitespace(text.charCodeAt(index))) index += 1;
	return index;
}

function isWhitespace(code: number): boolean {
	return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;
}

function isPrimitiveStart(code: number): boolean {
	return code === 0x2d || (code >= 0x30 && code <= 0x39)
		|| code === 0x74 || code === 0x66 || code === 0x6e;
}
