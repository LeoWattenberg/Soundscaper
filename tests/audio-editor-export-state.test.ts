/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createDeliveryReportStateAccess,
	createEditorExportStateAccess,
	type EditorExportState,
} from '../src/common/editor/controller/export/export-state.ts';

type IsAny<Value> = 0 extends (1 & Value) ? true : false;
type AssertFalse<Value extends false> = Value;
type AssertTrue<Value extends true> = Value;
type IsEqual<Left, Right> = (<Value>() => Value extends Left ? 1 : 2) extends
	(<Value>() => Value extends Right ? 1 : 2)
	? (<Value>() => Value extends Right ? 1 : 2) extends
		(<Value>() => Value extends Left ? 1 : 2)
		? true
		: false
	: false;

type ExportStateKeys =
	| 'deliveryReport'
	| 'disposed'
	| 'exportAbort'
	| 'exportGeneration'
	| 'exportOutput'
	| 'mobile'
	| 'outputCleanup'
	| 'outputUrl';
type ExportStateAnyKeys = {
	[Key in keyof EditorExportState]-?: IsAny<EditorExportState[Key]> extends true ? Key : never;
}[keyof EditorExportState];

export type ExportStateHasExactKeys = AssertTrue<IsEqual<keyof EditorExportState, ExportStateKeys>>;
export type ExportStateHasNoOpenIndex = AssertFalse<string extends keyof EditorExportState ? true : false>;
export type ExportStateHasNoAny = AssertTrue<IsEqual<ExportStateAnyKeys, never>>;
export type ExportStateExcludesTransportOwner = AssertFalse<'transportState' extends keyof EditorExportState
	? true
	: false>;

function checkExportStateWrites(state: EditorExportState): void {
	state.exportGeneration += 1;
	state.exportAbort = null;
	state.deliveryReport = null;
	state.exportOutput = null;
	state.outputCleanup = null;
	state.outputUrl = null;
	// @ts-expect-error Export observes controller disposal but does not own it.
	state.disposed = true;
	// @ts-expect-error Export observes the platform class but does not own it.
	state.mobile = true;
	// @ts-expect-error The export state capability cannot write transport-owned state.
	state.transportState = 'playing';
}

test('export state access exposes only the export workspace capability', () => {
	const controllerState = {
		deliveryReport: null as unknown,
		disposed: false,
		exportAbort: null,
		exportGeneration: 0,
		exportOutput: null as unknown,
		mobile: false,
		outputCleanup: null,
		outputUrl: null,
		transportState: 'stopped',
	};
	const state = createEditorExportStateAccess(controllerState);
	assert.deepEqual(Object.keys(state).sort(), [
		'deliveryReport',
		'disposed',
		'exportAbort',
		'exportGeneration',
		'exportOutput',
		'mobile',
		'outputCleanup',
		'outputUrl',
	]);
	state.exportGeneration = 2;
	state.deliveryReport = { status: 'ready' };
	assert.equal(controllerState.exportGeneration, 2);
	assert.deepEqual(controllerState.deliveryReport, { status: 'ready' });
	assert.equal(Reflect.set(state, 'disposed', true), false);
	assert.equal(Reflect.set(state, 'mobile', true), false);
	assert.equal(Reflect.set(state, 'transportState', 'playing'), false);
	assert.equal(controllerState.disposed, false);
	assert.equal(controllerState.mobile, false);
	assert.equal(controllerState.transportState, 'stopped');
	assert.equal(typeof checkExportStateWrites, 'function');
});

test('delivery-report access exposes one live workspace field', () => {
	const controllerState = { deliveryReport: null as unknown, transportState: 'stopped' };
	const state = createDeliveryReportStateAccess(controllerState);
	state.deliveryReport = { status: 'ready' };
	assert.deepEqual(Object.keys(state), ['deliveryReport']);
	assert.deepEqual(controllerState.deliveryReport, { status: 'ready' });
	assert.equal(Reflect.set(state, 'transportState', 'playing'), false);
	assert.equal(controllerState.transportState, 'stopped');
});
