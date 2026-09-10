/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { RecordingRoutingServiceRuntime } from '../src/common/editor/controller/recording/internal/recording-routing-service.ts';
import type { SampleEditServiceRuntime } from '../src/common/editor/controller/clip-video/internal/sample-edit-service.ts';
import type { SelectionViewServiceRuntime } from '../src/common/editor/controller/track-audio/internal/selection-view-service.ts';
import type { SourceLifecycleServiceRuntime } from '../src/common/editor/controller/source/source-lifecycle-service.ts';
import type { SourceRuntimeCompositionDependencies } from '../src/common/editor/controller/source/source-runtime-composition-types.ts';
import type {
	createPencilSampleEdits,
	createSmoothSampleRange,
	persistImmutableSampleEdit,
} from '../src/common/editor/sample-edit.js';

type IsAny<Value> = 0 extends (1 & Value) ? true : false;
type FunctionContainsAny<Value> = Value extends (...args: infer Arguments) => infer Result
	? IsAny<Arguments[number]> extends true
		? true
		: IsAny<Result>
	: IsAny<Value>;
type AnyPortKeys<Runtime> = {
	[Key in keyof Runtime]-?: FunctionContainsAny<Runtime[Key]> extends true ? Key : never;
}[keyof Runtime];
type AssertNever<Value extends never> = Value;
type AssertFalse<Value extends false> = Value;
type AssertTrue<Value extends true> = Value;
type IsEqual<Left, Right> = (<Value>() => Value extends Left ? 1 : 2) extends
	(<Value>() => Value extends Right ? 1 : 2)
	? (<Value>() => Value extends Right ? 1 : 2) extends
		(<Value>() => Value extends Left ? 1 : 2)
		? true
		: false
	: false;

type SourceBufferEntry = SourceRuntimeCompositionDependencies['sourceBuffers'] extends Iterable<infer Entry>
	? Entry
	: never;
type SourceBufferKey = SourceBufferEntry extends readonly [infer Key, unknown] ? Key : never;
type SourceBufferValue = SourceBufferEntry extends readonly [unknown, infer Value] ? Value : never;

interface SampleEditDomainHelpers {
	readonly createPencilSampleEdits: typeof createPencilSampleEdits;
	readonly createSmoothSampleRange: typeof createSmoothSampleRange;
	readonly persistImmutableSampleEdit: typeof persistImmutableSampleEdit;
}

type SampleEditHelperMismatches = {
	[Key in keyof SampleEditDomainHelpers]: SampleEditDomainHelpers[Key] extends SampleEditServiceRuntime[Key]
		? never
		: Key;
}[keyof SampleEditDomainHelpers];

export type RecordingRoutingPortsAreClosed = AssertFalse<string extends keyof RecordingRoutingServiceRuntime ? true : false>;
export type SampleEditPortsAreClosed = AssertFalse<string extends keyof SampleEditServiceRuntime ? true : false>;
export type SelectionViewPortsAreClosed = AssertFalse<string extends keyof SelectionViewServiceRuntime ? true : false>;
export type SourceLifecyclePortsAreClosed = AssertFalse<string extends keyof SourceLifecycleServiceRuntime ? true : false>;

export type RecordingRoutingPortsContainNoAny = AssertNever<AnyPortKeys<RecordingRoutingServiceRuntime>>;
export type SampleEditPortsContainNoAny = AssertNever<AnyPortKeys<SampleEditServiceRuntime>>;
export type SampleEditHelpersContainNoAny = AssertNever<AnyPortKeys<SampleEditDomainHelpers>>;
export type SampleEditHelpersMatchPorts = AssertNever<SampleEditHelperMismatches>;
export type SelectionViewPortsContainNoAny = AssertNever<AnyPortKeys<SelectionViewServiceRuntime>>;
export type SourceLifecyclePortsContainNoAny = AssertNever<AnyPortKeys<SourceLifecycleServiceRuntime>>;
export type SourceBufferKeyContainsNoAny = AssertFalse<IsAny<SourceBufferKey>>;
export type SourceBufferValueContainsNoAny = AssertFalse<IsAny<SourceBufferValue>>;
export type SourceBufferKeyIsString = AssertTrue<IsEqual<SourceBufferKey, string>>;
export type SourceBufferValueIsAudioBuffer = AssertTrue<IsEqual<SourceBufferValue, AudioBuffer>>;

test('controller service boundaries are checked by the TypeScript project', () => {
	assert.ok(true);
});
