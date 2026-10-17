/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import PhotoDevelopWorkspaceCurrentV1 from '../src/common/editor/ui/lightscaper/PhotoDevelopWorkspaceCurrentV1.tsx';
import VideoEffectRack from '../src/common/editor/ui/inspector/VideoEffectRack.jsx';
import { photoDevelopCopy } from '../src/common/i18n/lightscaper-develop-copy.ts';
import { VIDEO_EFFECT_COPY_BY_LOCALE } from '../src/common/i18n/video-effect-copy.js';
import { VIDEO_EFFECT_TYPES, createVideoEffect, normalizeVideoEffect, serializeVideoEffectsToFfmpegOperations } from '../src/common/editor/video-effects.js';
import { normalizeChromaticAberrationParamsV1, prepareChromaticAberrationEffectV1 } from '../src/common/editor/video-chromatic-aberration-v1.ts';
import { videoEffectPasses, EFFECT_CODES, EFFECT_PROGRAM_COUNT } from '../src/common/editor/ui/video-preview-effects.js';
import { appendVideoEffectOperation } from '../src/common/editor/video-effect-ffmpeg.ts';
import { createVideoEffectService, type VideoEffectProject } from '../src/common/editor/controller/clip-video/video-effect-service.ts';
import { EditorProjectGeneration } from '../src/common/editor/controller/shared/lifecycle.ts';
import { FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-domain-runtime-profile.ts';
import { createFramescaperProjectFinishing, cloneFramescaperProjectFinishing } from '../src/framescaper/editor-project-finishing.ts';
import { applyFramescaperProjectCommandFinishing } from '../src/framescaper/editor-project-finishing-commands.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';
import { repairSettingsFixture } from './helpers/lightscaper-repair-settings-current-fixture.ts';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { reactProps, type ReactTestElement } from './helpers/react-test-dom.ts';
import { settle } from './helpers/async-test-control.ts';

const TYPE = 'chromatic-aberration-v1';
async function numeric(input: ReactTestElement, value: string, key = 'Enter') {
	await act(async () => { reactProps(input).onFocus?.({}); reactProps(input).onChange?.({ currentTarget: { value, valueAsNumber: Number(value) } }); });
	await act(async () => { reactProps(input).onKeyDown?.({ key, preventDefault() {}, stopPropagation() {} }); });
}

test('Shared chromatic aberration owns closed bounded red/blue controls and detached prepared coefficients', () => {
	assert.deepEqual(createVideoEffect(TYPE, { id: 'ca' }), { id: 'ca', type: TYPE, enabled: true, params: { red: 0, blue: 0 } });
	for (const name of ['red', 'blue']) for (const value of [-101, 101, Number.NaN, Number.POSITIVE_INFINITY, '50', null]) {
		assert.throws(() => normalizeVideoEffect({ id: 'ca', type: TYPE, enabled: false, params: { [name]: value } }));
	}
	assert.deepEqual(normalizeChromaticAberrationParamsV1({ red: -0, blue: -0 }), { red: 0, blue: 0 });
	assert.deepEqual(normalizeChromaticAberrationParamsV1({ blue: 37.125 }), { red: 0, blue: 37.125 });
	assert.throws(() => normalizeChromaticAberrationParamsV1({ red: 0, green: 0 }));
	let getters = 0; const hostile = Object.defineProperty({}, 'blue', { enumerable: true, get() { getters++; return 50; } });
	assert.throws(() => normalizeChromaticAberrationParamsV1(hostile)); assert.equal(getters, 0);
	const source = { id: 'ca', type: TYPE, enabled: true, params: { red: 25, blue: -100 } }, prepared = prepareChromaticAberrationEffectV1(source);
	source.params.red = 0; source.params.blue = 0; source.enabled = false;
	assert.deepEqual(prepared, { id: 'ca', type: TYPE, enabled: true, neutral: false, red: 25, blue: -100, redCoefficient: .0025, blueCoefficient: -.01 });
	assert.ok(Object.isFrozen(prepared)); assert.equal(prepareChromaticAberrationEffectV1(createVideoEffect(TYPE)).neutral, true);
});

test('Actual CA GPU pass and FFmpeg graph preserve independent red/blue controls and require admitted metadata before bypass', () => {
	const neutral = createVideoEffect(TYPE, { id: 'neutral' }), active = createVideoEffect(TYPE, { id: 'ca', params: { red: 100, blue: -100 } });
	for (const effect of [neutral, { ...active, enabled: false }]) {
		assert.deepEqual(videoEffectPasses(effect), []); assert.deepEqual(serializeVideoEffectsToFfmpegOperations([effect]), []);
	}
	assert.throws(() => videoEffectPasses({ ...active, enabled: false, params: { red: 0, blue: Number.NaN } }));
	const passes = videoEffectPasses(active); assert.equal(passes.length, 1); assert.equal(passes[0]?.code, EFFECT_CODES[TYPE]);
	assert.ok(EFFECT_CODES[TYPE] < EFFECT_PROGRAM_COUNT); assert.deepEqual(passes[0]?.params0, [.01, -.01, 1, 1]);
	assert.deepEqual(videoEffectPasses(createVideoEffect(TYPE, { params: { red: Number.MIN_VALUE } }))[0]?.params0, [0, 0, 1, 0],
		'An underflowed coefficient must retain the nonzero authored control.');
	const operations = serializeVideoEffectsToFfmpegOperations([active]); assert.deepEqual(operations, [{ kind: TYPE, effect: active }]);
	const filters: string[] = []; appendVideoEffectOperation({ filters, inputLabel: 'input', outputLabel: 'output', operation: operations[0]!, width: 9, height: 7 });
	assert.ok(filters[0]!.startsWith('[input]format=pix_fmts=rgba,split=')); assert.ok(filters.at(-1)!.endsWith('[output]'));
	assert.ok(filters.some(filter => filter.includes('alphaextract,split=2')), 'Final alpha stays separate from channel reconstruction.');
	assert.throws(() => appendVideoEffectOperation({ filters: [], inputLabel: 'input', outputLabel: 'output',
		operation: { kind: TYPE, effect: { ...active, params: { red: 'injected-expression', blue: 0 } } }, width: 9, height: 7 }));
});

for (const locale of ['en', 'de'] as const) {
	const title = locale === 'de' ? 'Chromatische Aberration' : 'Chromatic aberration', red = locale === 'de' ? 'Rot' : 'Red', blue = locale === 'de' ? 'Blau' : 'Blue';
	test(`${locale}: opted-in Current Photo Develop authors independent red/blue correction and preserves repaired Original custody`, async () => {
		const f = await repairSettingsFixture(1), before = await f.read(), custody = (await f.inspect())[0]!;
		const words = photoDevelopCopy(locale), unexpected = async (): Promise<never> => { throw new Error('This authoring test acquires no display or Original decoder.'); };
		const mounted = await mountPhotoImportUi(() => <PhotoDevelopWorkspaceCurrentV1 locale={locale} photoId={before.photoId} label={custody.photo.metadata.fileName}
			generation={f.session} execute={f.execute} readPreview={async () => ({ outcome: 'missing' })} loadProxy={unexpected}
			beforePresent={Promise.resolve()} registerRetirement={() => () => undefined} onClose={() => undefined} />);
		const click = async (label: string) => {
			const button = mounted.dom.container.querySelectorAll('button').find(node => node.textContent === label); assert.ok(button, label);
			await act(async () => { reactProps(button).onClick?.({}); await settle(); });
		};
		const control = (label: string) => { const input = mounted.dom.container.querySelectorAll('input').find(node => node.getAttribute('aria-label') === `${words.shared.videoEffectExactValue}: ${label}`); assert.ok(input); return input; };
		try {
			await act(async () => { await settle(); }); const picker = mounted.dom.one('[data-photo-develop-effects]').querySelector('select'); assert.ok(picker);
			const choice = picker.querySelectorAll('option').find(node => node.getAttribute('value') === TYPE);
			assert.ok(choice, 'The actual Photo chooser must expose chromatic aberration.'); assert.equal(choice.textContent, title);
			await act(async () => { reactProps(picker).onChange?.({ currentTarget: { value: TYPE } }); }); await click(words.add);
			assert.equal(control(red).value, '0'); assert.equal(control(blue).value, '0');
			await numeric(control(red), '45', 'Escape'); assert.equal(control(red).value, '0'); assert.equal(control(blue).value, '0');
			await numeric(control(red), '-100'); await numeric(control(blue), '100');
			assert.equal((await f.read()).revision, before.revision, 'Correction stays local until Save.'); await click(words.save);
			const saved = await f.read(); assert.equal(saved.revision, before.revision + 1); assert.equal(saved.history.entries.length, before.history.entries.length + 1);
			assert.deepEqual(saved.develop.effects.map(({ type, enabled, params }) => ({ type, enabled, params })), [{ type: TYPE, enabled: true, params: { red: -100, blue: 100 } }]);
			assert.deepEqual({ ...saved.develop, effects: before.develop.effects }, before.develop);
			const after = (await f.inspect())[0]!; assert.deepEqual(after.photo.original, custody.photo.original); assert.deepEqual(after.photo.metadata, custody.photo.metadata); assert.deepEqual(after.bytes, custody.bytes);
		} finally { await mounted.dispose(); await f.close(); }
	});

	test(`${locale}: opted-in Frame effect rack authors and persists independent red/blue correction`, async context => {
		const previous = Object.getOwnPropertyDescriptor(globalThis, 'React'); Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
		context.after(() => { if (previous) Object.defineProperty(globalThis, 'React', previous); else Reflect.deleteProperty(globalThis, 'React'); });
		let project = createFramescaperProjectFinishing(PROFILE, framescaperV20Options()), error = '';
		const view = (value: unknown) => value as VideoEffectProject, generation = new EditorProjectGeneration(); generation.activate(view(project).id);
		const service = createVideoEffectService({ state: { selectedClipId: 'video-clip', readOnly: false, videoEffectGestures: new Map() }, copy: { projectReadOnly: 'Read only' },
			getProject: () => view(project), captureProject: () => generation.capture(view(project).id), assertProject: token => { generation.assertCurrent(token); }, editingBlocked: () => false,
			commit: command => { project = applyFramescaperProjectCommandFinishing(PROFILE, project, command); return view(project); }, publishDocumentSnapshot() {} });
		const actions = { add: service.addVideoClipEffect, beginGesture: service.beginVideoEffectGesture, preview: service.previewVideoEffectGesture,
			commit: service.commitVideoEffectGesture, cancel: service.cancelVideoEffectGesture, toggle: service.toggleVideoClipEffect,
			reorder: service.reorderVideoClipEffect, remove: service.removeVideoClipEffect, update: service.updateVideoClipEffect }, copy = VIDEO_EFFECT_COPY_BY_LOCALE[locale];
		const mounted = await mountPhotoImportUi(() => <VideoEffectRack clip={view(project).clips.find(clip => clip.id === 'video-clip')}
			controller={{ actions: { video: { effects: actions } } }} copy={{ ...copy, chooseEffect: 'Choose effect', addEffect: 'Add effect' }} disabled={false} onError={(value: string) => { error = value; }} />);
		const control = (label: string) => { const input = mounted.dom.container.querySelectorAll('input').find(node => node.getAttribute('aria-label') === `${copy.videoEffectExactValue}: ${label}`); assert.ok(input); return input; };
		try {
			const position = VIDEO_EFFECT_TYPES.indexOf(TYPE); assert.ok(position >= 0, 'The shared Frame rack must expose chromatic aberration.');
			const picker = mounted.dom.one('.dropdown'); await act(async () => { reactProps(picker).onKeyDown?.({ key: 'Enter', preventDefault() {} }); });
			for (let index = 0; index < position; index++) await act(async () => { reactProps(picker).onKeyDown?.({ key: 'ArrowDown', preventDefault() {} }); });
			await act(async () => { reactProps(picker).onKeyDown?.({ key: 'Enter', preventDefault() {} }); });
			const add = mounted.dom.container.querySelectorAll('button').find(node => node.textContent === 'Add effect'); assert.ok(add);
			await act(async () => { reactProps(add).onClick?.({}); await settle(); }); await mounted.render();
			assert.equal(mounted.dom.one('[data-video-effect-type="chromatic-aberration-v1"]').querySelector('[role="checkbox"]')?.getAttribute('aria-label'), title);
			assert.equal(control(red).value, '0'); assert.equal(control(blue).value, '0'); await numeric(control(red), '45', 'Escape'); await mounted.render();
			assert.equal(control(red).value, '0'); await numeric(control(red), '-100'); await mounted.render(); await numeric(control(blue), '100'); await mounted.render(); assert.equal(error, '');
			const saved = view(cloneFramescaperProjectFinishing(PROFILE, project)).clips.find(clip => clip.id === 'video-clip'); assert.ok(saved);
			assert.deepEqual(saved.videoEffects?.map(({ type, enabled, params }) => ({ type, enabled, params })), [{ type: TYPE, enabled: true, params: { red: -100, blue: 100 } }]);
		} finally { await mounted.dispose(); }
	});
}
