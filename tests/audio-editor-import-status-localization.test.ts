/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createNativeProjectService } from '../src/common/editor/controller/document/native-project-service.ts';
import { publishAup4OpenStatus } from '../src/common/editor/controller/document/internal/native-project/native-project-status.ts';
import { createEditorTaskProgressCoordinator } from '../src/common/editor/controller/shared/task-progress.ts';
import { formatPresentationMessage, type LocalizedPresentationMessage } from '../src/common/i18n/presentation-message.ts';
import { createFixture } from './helpers/native-project-service-fixture.ts';
import { publishImportCompletionStatus } from '../src/common/editor/controller/import/internal/import-status-localization.ts';
import { createImportResultWithWarnings } from '../src/common/editor/controller/import/internal/import-result-warnings.ts';
import { createPresentationLocalization } from '../src/common/editor/controller/shared/presentation-localization.ts';
import { createControllerPresentationState } from '../src/common/editor/controller/composition/presentation-state.ts';

test('native progress captures canonical prefix identity and retains its percentage through preview', () => {
	const statuses: Array<{ text: string; descriptor?: LocalizedPresentationMessage }> = [];
	let copy = { importing: 'Importing', 'ui.nativeProjectStatus.progress': '{operation} {percent}%' };
	const taskProgress = createEditorTaskProgressCoordinator({ formatMessage: (message) => formatPresentationMessage(copy, message) });
	taskProgress.begin('import', 'Importing');
	const fixture = createFixture({ taskProgress, setStatus: (text, _state, descriptor) => { statuses.push({ text, descriptor }); } });
	createNativeProjectService(fixture.runtime).updateNativeProjectProgress({ value: .5 }, 'Importing', undefined, undefined, undefined, { key: 'importing' });
	assert.equal(statuses.at(-1)?.text, 'Importing 50%');
	copy = { importing: 'Importieren', 'ui.nativeProjectStatus.progress': '{operation} {percent}%' };
	assert.equal(formatPresentationMessage(copy, statuses.at(-1)!.descriptor!), 'Importieren 50%');
	taskProgress.refreshLocalization();
	assert.equal(taskProgress.getSnapshot()?.label, 'Importieren');
});

test('later async native progress stays in the current preview language with a captured prefix', async () => {
	const english = { ready: 'Ready', genericError: 'Error: {message}', unknownError: 'Unknown',
		importing: 'Importing', 'ui.nativeProjectStatus.progress': '{operation} {percent}%' };
	const session = createPresentationLocalization({ locale: 'en', englishCopy: english, publishedCopy: english });
	const state = { status: { message: english.ready, state: 'info' }, exportProgress: 0,
		analysisResult: null as unknown, analysisVisuals: null as unknown, analysisReport: null as unknown,
		localDiagnostics: { record: () => {} } };
	const presentation = createControllerPresentationState({ state, copy: session.copy, formatMessage: session.formatMessage,
		publishDocument: () => {}, publishTelemetry: () => {}, updateTaskProgress: () => {} });
	const taskProgress = createEditorTaskProgressCoordinator({ formatMessage: session.formatMessage });
	const task = taskProgress.begin('import', english.importing, 0, { key: 'importing' });
	const fixture = createFixture({ taskProgress, setStatus: presentation.setStatus });
	const service = createNativeProjectService(fixture.runtime);
	const capturedPrefix = session.copy.importing;
	const unsubscribe = session.port.subscribe(() => {
		presentation.refreshLocalization(session.formatMessage); taskProgress.refreshLocalization();
	});
	try {
		service.updateNativeProjectProgress({ value: .3 }, capturedPrefix, undefined, undefined, undefined, { key: 'importing' });
		await Promise.resolve();
		session.port.applyPreview('de', { importing: 'Importieren' });
		assert.equal(state.status.message, 'Importieren 30%');
		service.updateNativeProjectProgress({ value: .4 }, capturedPrefix, undefined, undefined, undefined, { key: 'importing' });
		assert.equal(state.status.message, 'Importieren 40%');
		assert.equal(taskProgress.getSnapshot()?.label, 'Importieren');
		assert.equal(taskProgress.getSnapshot()?.value, .4);
		session.port.resetPreview();
		assert.equal(state.status.message, 'Importing 40%');
	} finally {
		unsubscribe(); task.finish(); session.dispose();
	}
});

test('native open statuses retain warning text alongside translated canonical copy', () => {
	let descriptor: LocalizedPresentationMessage | undefined;
	let text = '';
	const fixture = createFixture({ setStatus: (message, _state, localization) => { text = message; descriptor = localization; } });
	publishAup4OpenStatus(fixture.runtime, false, undefined, ['External detail.']);
	assert.equal(text, 'Opened. External detail.');
	assert.equal(formatPresentationMessage({ aup4Opened: 'Projekt geöffnet.' }, descriptor!), 'Projekt geöffnet. External detail.');
	publishAup4OpenStatus(fixture.runtime, true, { code: 'EDITABLE_LIMIT_EXCEEDED', message: 'External detail.' }, []);
	assert.equal(descriptor?.key, 'oversizedAup4ReadOnly');
});

test('import completion keeps canonical notices and external warning parameters', () => {
	let text = '';
	let descriptor: LocalizedPresentationMessage | undefined;
	publishImportCompletionStatus((message, _state, localization) => { text = message; descriptor = localization; }, { done: 'Done.' }, [
		{ text: 'Imported. Detail.', localization: { key: 'aupImported', suffix: ' Detail.' } },
		{ text: 'External codec detail.' },
	]);
	assert.equal(text, 'Imported. Detail. External codec detail.');
	assert.equal(formatPresentationMessage({ aupImported: 'Importiert.' }, descriptor!), 'Importiert. Detail. External codec detail.');
});

test('BEXT warning notices retain canonical keys while codec details remain parameters', () => {
	const result = createImportResultWithWarnings({ bextMetadataImportWarning: 'Metadata normalized.' })({}, [
		{ code: 'invalid-ascii', message: 'External codec detail.' },
		{ code: 'bext-spot-out-of-range', message: 'Placed at zero.' },
	]);
	assert.equal(result.notice, 'Metadata normalized. Placed at zero.');
	assert.equal(formatPresentationMessage({ bextMetadataImportWarning: 'Metadaten normalisiert.', bextSpotOutOfRangeWarning: 'Bei null platziert.' },
		result.noticeLocalization as LocalizedPresentationMessage), 'Metadaten normalisiert. Bei null platziert.');
});
