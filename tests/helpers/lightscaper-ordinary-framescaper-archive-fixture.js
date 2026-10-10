/* SPDX-License-Identifier: AGPL-3.0-only */

import { createFramescaperAudioEditorController } from '../../src/framescaper/editor-controller.ts';
import { createFramescaperEditorProjectEnvironment } from '../../src/framescaper/editor-project-environment.ts';
import { createFramescaperScapeNativeRuntime } from '../../src/framescaper/editor-scape-native.ts';
import { framescaperSelectedImageImportResultTimelineImageFor } from '../../src/framescaper/editor-selected-timeline-image-image-authoring-controller.ts';
import { framescaperCandidateAuthoringActionRuntimeFor } from '../../src/common/editor/ui/framescaper-candidate-authoring-actions.ts';

/** Compose actual Frame owners inside the Light browser's fresh context.
 * The caller supplies a genuine 2x2 PNG through the native File chooser and
 * must settle that chooser and join this action before retiring the page.
 * Controller disposal is not authority to cancel an outstanding picker.
 * This is not the separate-origin Framescaper application UI workflow. */
export async function createOrdinaryFramescaperStillArchiveFixtureV1() {
	const assertNativeWorker = globalThis.__assertNativeOpfsWorkerExecution;
	if (typeof assertNativeWorker !== 'function') {
		throw new TypeError('The actual native OPFS worker assertion must be installed.');
	}
	let environment, controller, closeEnvironment, disposeController, result;
	const failures = [];
	try {
		environment = await createFramescaperEditorProjectEnvironment();
		closeEnvironment = environment.close.bind(environment);
		controller = createFramescaperAudioEditorController(environment);
		disposeController = controller.dispose.bind(controller);
		await controller.ready;
		await controller.actions.project.create({ title: 'Ordinary Frame still', sampleRate: 48_000 });
		const authoring = framescaperCandidateAuthoringActionRuntimeFor(controller);
		if (!authoring) throw new Error('The actual Framescaper still authoring runtime is unavailable.');
		await authoring.run('video-still');
		const imported = framescaperSelectedImageImportResultTimelineImageFor(controller);
		const file = imported?.files[0];
		if (imported?.files.length !== 1 || file?.status !== 'imported'
			|| typeof file.sourceId !== 'string' || typeof file.clipId !== 'string') {
			throw new Error('Exactly one genuine still must be imported through the native picker.');
		}
		const importedProject = controller.project;
		const source = importedProject?.sources.find(item => item.id === file.sourceId);
		const clip = importedProject?.clips.find(item => item.id === file.clipId);
		const sequence = importedProject?.sequences.find(item => item.id === clip?.sequenceId);
		if (!source || source.kind !== 'image' || source.schemaVersion !== 1
			|| source.original.recognizedFormat !== 'png'
			|| source.canonical.width !== 2 || source.canonical.height !== 2
			|| source.canonical.frameCount !== 1 || source.canonical.hasAlpha !== false
			|| !clip || clip.kind !== 'image' || clip.sourceId !== source.id || !sequence) {
			throw new Error('The real importer must publish one opaque 2x2 Source1 with an existing timeline placement.');
		}
		const beforeIds = new Set(importedProject.clips.map(item => item.id));
		controller.actions.timeline.selectClip(clip.id);
		controller.actions.edit.duplicate();
		const copies = controller.project.clips.filter(item => item.kind === 'image' && !beforeIds.has(item.id));
		if (copies.length !== 1 || copies[0].sourceId !== source.id
			|| copies[0].sequenceId !== sequence.id
			|| copies[0].sequenceStartFrame !== clip.sequenceStartFrame
			|| copies[0].sequenceFrameCount !== clip.sequenceFrameCount
			|| copies[0].sourceStartTicks !== clip.sourceStartTicks) {
			throw new Error('Public Duplicate must create exactly one matching real still placement.');
		}
		const copy = copies[0];
		controller.actions.timeline.selectClip(copy.id);
		const moved = controller.actions.projectBin.moveFromTimeline(copy.id);
		if (!Array.isArray(moved) || moved.length !== 1 || moved[0] !== copy.id) {
			throw new Error('The public Project Bin action must move only the duplicated still.');
		}
		await controller.actions.project.save();
		const project = controller.project;
		const timeline = project.clips.filter(item => item.kind === 'image' && item.sourceId === source.id);
		const bin = project.projectBin.clips.filter(item => item.kind === 'image' && item.sourceId === source.id);
		const savedSource = project.sources.find(item => item.id === source.id);
		const savedSequence = project.sequences.find(item => item.id === sequence.id);
		if (timeline.length !== 1 || timeline[0].id !== clip.id
			|| bin.length !== 1 || bin[0].id !== copy.id
			|| timeline[0].sequenceId !== sequence.id || bin[0].sequenceId !== sequence.id
			|| !savedSource || savedSource.kind !== 'image' || savedSource.schemaVersion !== 1
			|| !savedSequence || !Number.isSafeInteger(project.revision) || project.revision < 0) {
			throw new Error('The saved project must retain exactly the authentic timeline and bin still placements.');
		}
		const nativeArchive = createFramescaperScapeNativeRuntime(environment.runtime.profile);
		const exported = await nativeArchive.exportScapeProject(project, environment.controllerStore, {
			maximumBlobBytes: 256 * 1024 * 1024,
		});
		if (!(exported.blob instanceof Blob) || exported.blob.size === 0
			|| exported.blob.size > 256 * 1024 * 1024) {
			throw new Error('The actual Scape writer must finish a bounded immutable archive Blob.');
		}
		result = Object.freeze({
			archive: exported.blob,
			projectId: project.id,
			projectRevision: project.revision,
			sourceId: savedSource.id,
			originalName: savedSource.original.fileName,
			storedMimeHint: savedSource.original.mimeType,
			originalSha256: savedSource.original.sha256,
			timelineClipId: timeline[0].id,
			binClipId: bin[0].id,
			sequenceId: savedSequence.id,
			sequenceName: savedSequence.name,
		});
	} catch (error) {
		failures.push(error);
	} finally {
		// Join native probes on success and failure while the worker is alive.
		if (closeEnvironment) {
			try { await assertNativeWorker.call(globalThis); } catch (error) { failures.push(error); }
		}
		// Disposal and storage closure are independently attempted, even when
		// either throws an opaque value. No foreign failure is reflected on.
		if (disposeController) {
			try { await disposeController(); } catch (error) { failures.push(error); }
		}
		if (closeEnvironment) {
			try { await closeEnvironment(); } catch (error) { failures.push(error); }
		}
	}
	if (failures.length === 1) throw failures[0];
	if (failures.length > 1) {
		throw new AggregateError(failures, 'Still archive composition and cleanup failed.', { cause: failures[0] });
	}
	return result;
}

/** Read the genuine saved Frame document without controller publication or
 * database reconstruction. Only its admitted detached snapshot survives. */
export async function readOrdinaryFramescaperStillProjectFixtureV1(projectId) {
	if (typeof projectId !== 'string' || projectId.length === 0) {
		throw new TypeError('An actual saved Frame project identity is required.');
	}
	const assertNativeWorker = globalThis.__assertNativeOpfsWorkerExecution;
	if (typeof assertNativeWorker !== 'function') {
		throw new TypeError('The actual native OPFS worker assertion must be installed.');
	}
	let closeEnvironment, result;
	const failures = [];
	try {
		const environment = await createFramescaperEditorProjectEnvironment();
		closeEnvironment = environment.close.bind(environment);
		const stored = await environment.store.loadProject(projectId);
		if (!stored) throw new ReferenceError('The authentic saved Frame project is missing.');
		const admitted = environment.runtime.loadProject(stored);
		if (admitted.readOnly || admitted.intrinsicReadOnly || admitted.project.id !== projectId) {
			throw new Error('The saved Frame project must admit as its exact current editable document.');
		}
		result = Object.freeze(environment.runtime.cloneProject(admitted.project));
	} catch (error) {
		failures.push(error);
	} finally {
		if (closeEnvironment) {
			try { await assertNativeWorker.call(globalThis); } catch (error) { failures.push(error); }
			try { await closeEnvironment(); } catch (error) { failures.push(error); }
		}
	}
	if (failures.length === 1) throw failures[0];
	if (failures.length > 1) {
		throw new AggregateError(failures, 'Saved Frame project read and cleanup failed.', { cause: failures[0] });
	}
	return result;
}
