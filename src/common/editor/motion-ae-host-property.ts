/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MotionAeEase, MotionAeExpression, MotionAeKey, MotionAeProperty, MotionAeReportEntry, MotionAeShape, MotionAeText } from './motion-ae-exchange-types.ts';
export interface MotionAePropertyHost {
	readonly name: string; readonly matchName: string; readonly numProperties?: number; readonly numKeys?: number;
	readonly isSpatial?: boolean; readonly expressionEnabled?: boolean; readonly expression?: string;
	readonly propertyValueType: unknown; readonly propertyType: unknown;
	property(index: number): MotionAePropertyHost;
	valueAtTime(time: number, preExpression: boolean): unknown;
	keyTime(index: number): number; keyValue(index: number): unknown;
	keyInInterpolationType(index: number): unknown; keyOutInterpolationType(index: number): unknown;
	keyInTemporalEase(index: number): readonly MotionAeEase[]; keyOutTemporalEase(index: number): readonly MotionAeEase[];
	keyInSpatialTangent(index: number): readonly number[]; keyOutSpatialTangent(index: number): readonly number[]; keyRoving(index: number): boolean;
}
export interface MotionAePropertyReadHost {
	kind(property: MotionAePropertyHost): 'group' | 'numeric' | 'shape' | 'text' | 'unsupported';
	interpolation(value: unknown): 'hold' | 'linear' | 'bezier';
	text(value: unknown): MotionAeText;
	checkCancelled(): void;
}
export interface MotionAeHostPropertyBudget { properties: number; keys: number }
/** Reads authored values only. Enabled expressions remain inert, unsupported custody until an explicit sampling operation. */
export function readMotionAeHostProperty(
	property: MotionAePropertyHost, host: MotionAePropertyReadHost, layerId: string, path: string,
	report: MotionAeReportEntry[], budget: MotionAeHostPropertyBudget, depth = 0,
): MotionAeProperty {
	host.checkCancelled(); if (++budget.properties > 65_536 || depth > 16) throw new Error('AE bridge property budget exceeded.');
	const name = property.name, matchName = property.matchName, kind = host.kind(property);
	if (kind === 'group') {
		const count = property.numProperties ?? 0; if (count > 65_536) throw new Error('AE bridge property budget exceeded.');
		const children: MotionAeProperty[] = [];
		for (let index = 1; index <= count; index++) {
			const child = property.property(index);
			children.push(readMotionAeHostProperty(child, host, layerId, path + '/' + String(index - 1) + ':' + child.matchName, report, budget, depth + 1));
		}
		return { kind, name, matchName, children };
	}
	function unsupported(reason: string): MotionAeProperty {
		report.push({ scopeId: layerId, propertyPath: path, status: 'unsupported', code: 'property', message: reason });
		return { kind: 'unsupported', name, matchName, reason };
	}
	if (kind === 'unsupported') return unsupported('This AE property value needs an explicit mapping or an AE-rendered composition.');
	const count = property.numKeys ?? 0; budget.keys += count;
	if (count > 4096 || budget.keys > 262_144) throw new Error('AE bridge key budget exceeded.');
	let expression: MotionAeExpression | null = null;
	if (property.expression) {
		expression = { source: property.expression, enabled: property.expressionEnabled === true, disposition: 'unsupported' };
		if (expression.enabled) report.push({ scopeId: layerId, propertyPath: path, status: 'unsupported', code: 'expression', message: 'Expression source is preserved without execution. Sample it explicitly or render the composition in After Effects.' });
	}
	const spatial = property.isSpatial === true;
	function readKeys<Value>(read: (value: unknown) => Value): readonly MotionAeKey<Value>[] {
		const keys: MotionAeKey<Value>[] = [];
		for (let index = 1; index <= count; index++) {
			host.checkCancelled();
			keys.push({ time: property.keyTime(index), value: read(property.keyValue(index)), inInterpolation: host.interpolation(property.keyInInterpolationType(index)),
				outInterpolation: host.interpolation(property.keyOutInterpolationType(index)), inEase: copyEase(property.keyInTemporalEase(index)), outEase: copyEase(property.keyOutTemporalEase(index)),
				inSpatialTangent: spatial ? copyNumbers(property.keyInSpatialTangent(index)) : null, outSpatialTangent: spatial ? copyNumbers(property.keyOutSpatialTangent(index)) : null,
				roving: spatial && property.keyRoving(index) });
		}
		return keys;
	}
	const base = property.valueAtTime(0, true);
	if (kind === 'numeric') return { kind, name, matchName, value: copyNumbers(base), spatial, keys: readKeys(copyNumbers), expression };
	if (kind === 'shape') return { kind, name, matchName, value: copyShape(base), keys: readKeys(copyShape), expression };
	return { kind, name, matchName, value: host.text(base), keys: readKeys(host.text), expression };
}
function copyNumbers(value: unknown): readonly number[] {
	if (typeof value === 'number') return [value];
	if (Object.prototype.toString.call(value) !== '[object Array]') throw new Error('AE numeric property did not return a numeric value.');
	const source = value as readonly number[], result: number[] = [];
	if (source.length < 1 || source.length > 4) throw new Error('AE numeric dimension is unsupported.');
	for (let index = 0; index < source.length; index++) { if (typeof source[index] !== 'number' || !isFinite(source[index]!)) throw new Error('AE numeric property is not finite.'); result.push(source[index]!); }
	return result;
}
function copyEase(source: readonly MotionAeEase[]): readonly MotionAeEase[] {
	const result: MotionAeEase[] = [];
	for (let index = 0; index < source.length; index++) result.push({ speed: source[index]!.speed, influence: source[index]!.influence }); return result;
}
function copyShape(input: unknown): MotionAeShape {
	const source = input as MotionAeShape;
	if (!source || !source.vertices || source.vertices.length > 4096) throw new Error('AE shape vertex budget exceeded.');
	function points(values: readonly (readonly [number, number])[]): readonly (readonly [number, number])[] {
		const result: (readonly [number, number])[] = [];
		for (let index = 0; index < values.length; index++) result.push([values[index]![0], values[index]![1]]); return result;
	}
	return { closed: source.closed, vertices: points(source.vertices), inTangents: points(source.inTangents), outTangents: points(source.outTangents) };
}
