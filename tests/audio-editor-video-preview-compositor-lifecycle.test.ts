/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';

import VideoPreviewPanel from '../src/common/editor/ui/workspace/VideoPreviewPanel.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, ReactTestElement } from './helpers/react-test-dom.ts';

interface CompositorCounters {
	contexts: number;
	createProgram: number;
	deleteProgram: number;
}

test('the preview compositor survives a project revision instead of being rebuilt', async () => {
	const counters: CompositorCounters = { contexts: 0, createProgram: 0, deleteProgram: 0 };
	const dom = installReactTestDom();
	const restoreCanvas = installCanvasContext(counters);
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const controller = {
		actions: {},
		engine: { sampleRate: 48_000 },
		getTelemetrySnapshot: () => TELEMETRY,
		subscribeTelemetry: () => () => undefined,
	};
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const renderPanel = (revision: number) => React.createElement(VideoPreviewPanel, {
		controller,
		snapshot: { project: project(revision), missingSourceIds: [] },
		copy: ENGLISH_COPY,
		run: () => undefined,
	});
	try {
		await act(async () => root.render(renderPanel(1)));
		assert.equal(counters.contexts, 1, 'the panel composites through one WebGL context');
		assert.ok(counters.createProgram > 0, 'the compositor compiles its programs on mount');
		const compiled = counters.createProgram;

		await act(async () => root.render(renderPanel(2)));
		assert.equal(counters.deleteProgram, 0, 'a project revision must not dispose the compositor');
		assert.equal(counters.contexts, 1, 'a project revision must not rebuild the compositor');
		assert.equal(counters.createProgram, compiled, 'a project revision must not recompile programs');

		await act(async () => root.unmount());
		assert.equal(counters.deleteProgram, compiled, 'unmounting releases every compiled program');
	} finally {
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
		else Reflect.deleteProperty(globalThis, 'React');
		restoreCanvas();
		dom.restore();
	}
});

const TELEMETRY = Object.freeze({
	positionFrame: 0,
	transportState: 'stopped',
	playbackRate: 1,
});

function project(revision: number) {
	return {
		id: 'video-preview-project',
		revision,
		sampleRate: 48_000,
		tracks: [],
		clips: [],
		sources: [],
	};
}

function installCanvasContext(counters: CompositorCounters): () => void {
	const prototype = ReactTestElement.prototype as unknown as Record<string, unknown>;
	const prior = Object.getOwnPropertyDescriptor(prototype, 'getContext');
	Object.defineProperty(prototype, 'getContext', {
		configurable: true,
		writable: true,
		value(this: ReactTestElement, kind: string): unknown {
			if (this.tagName !== 'CANVAS' || kind !== 'webgl2') return null;
			counters.contexts += 1;
			return webgl2Stub(counters);
		},
	});
	return () => {
		if (prior) Object.defineProperty(prototype, 'getContext', prior);
		else Reflect.deleteProperty(prototype, 'getContext');
	};
}

// Every WebGL2 entry point the compositor reaches answers with a fresh truthy
// handle, which is all its allocation guards inspect. Only the program calls are
// counted, because those are what a rebuilt compositor pays for again.
function webgl2Stub(counters: CompositorCounters): unknown {
	const members = new Map<string, unknown>();
	return new Proxy({}, {
		get(target: object, key: string | symbol): unknown {
			if (typeof key !== 'string') return Reflect.get(target, key);
			const cached = members.get(key);
			if (cached !== undefined) return cached;
			const member = (): unknown => {
				if (key === 'createProgram') counters.createProgram += 1;
				if (key === 'deleteProgram') counters.deleteProgram += 1;
				// Shader and program status are the only readings the compositor
				// compares by value; everything else is an opaque handle.
				return key === 'getShaderParameter' || key === 'getProgramParameter' ? true : {};
			};
			members.set(key, member);
			return member;
		},
	});
}
