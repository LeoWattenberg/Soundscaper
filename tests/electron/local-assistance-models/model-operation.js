/* SPDX-License-Identifier: AGPL-3.0-only */

const OUTPUTS = Object.freeze({
	'voice-activity-detection': [['voice-activity', 'application/json']],
	'speech-recognition': [['transcript', 'application/json']],
	'speaker-diarization': [['speaker-turns', 'application/json']],
	'speech-enhancement': [['enhanced-audio', 'audio/wav']],
	dereverberation: [['enhanced-audio', 'audio/wav']],
	'source-separation': Array.from({ length: 3 }, () => ['separated-audio', 'audio/wav']),
	'word-alignment': [['word-alignment', 'application/vnd.soundscaper.word-alignment+json']],
	'audio-tagging': [['audio-tags', 'application/vnd.soundscaper.audio-tags+json']],
	'beat-tracking': [['beat-grid', 'application/vnd.soundscaper.beat-grid+json']],
	'shot-detection': [['shot-boundaries', 'application/vnd.soundscaper.shot-boundaries+json']],
	'editorial-generation': [['editorial-proposal', 'application/vnd.soundscaper.editorial-proposal+json']],
	'subject-detection': [['subject-tracks', 'application/vnd.soundscaper.subject-tracks+json']],
	'saliency-detection': [['saliency-map', 'application/vnd.soundscaper.saliency-map+json']],
	'optical-character-recognition': [['recognized-text', 'application/vnd.soundscaper.recognized-text+json']],
	'text-embedding': [['embeddings', 'application/vnd.soundscaper.embedding-matrix-v1']],
	'image-text-embedding': [['embeddings', 'application/vnd.soundscaper.embedding-matrix-v1']],
});

export function modelOutputReservations(operation) {
	if (!Object.hasOwn(OUTPUTS, operation)) throw new TypeError(`Unknown model operation: ${operation}`);
	return OUTPUTS[operation].map(([role, mediaType]) => ({ role, mediaType, maximumByteLength: 32 * 1024 * 1024 }));
}

export async function executeModelOperation(page, request) {
	return page.evaluate(async (value) => {
		const bridge = globalThis.soundscaperDesktop.v1.localAssistance;
		const installed = await bridge.models();
		const models = value.expectedModels.map((expected) => {
			const model = installed.find((entry) => entry.modelId === expected.modelId);
			if (!model) throw new Error(`Installed model unavailable for inference: ${expected.modelId}`);
			if (model.version !== expected.version || JSON.stringify([...model.artifactSha256s].sort()) !== JSON.stringify(expected.artifactSha256s)) {
				throw new Error(`Installed model differs from the test catalog: ${expected.modelId}`);
			}
			return { modelId: model.modelId, version: model.version, artifactSha256s: model.artifactSha256s };
		});
		const { jobId } = await bridge.createJob();
		const progress = [];
		const unsubscribe = bridge.onProgress((event) => {
			if (event.jobId === jobId && progress.length < 4096) progress.push(event);
		});
		try {
			const inputs = [];
			for (const input of value.inputs) {
				const bytes = Uint8Array.from(atob(input.base64), (character) => character.charCodeAt(0));
				inputs.push(await bridge.stageInput({ jobId, role: input.role, mediaType: input.mediaType,
					sha256: input.sha256, bytes: new Blob([bytes], { type: input.mediaType }) }));
			}
			const outputs = [];
			for (const output of value.outputs) outputs.push(await bridge.reserveOutput({ jobId, ...output }));
			const started = performance.now();
			const outcome = await bridge.run({ contractVersion: 1, jobId, operation: value.operation,
				selectionFence: value.selectionFence, models, inputs, outputs });
			const elapsedMs = performance.now() - started;
			if (outcome.outcome !== 'completed') return { outcome, elapsedMs, progress, outputs: [] };
			if (outcome.result.outputs.length !== outputs.length) throw new Error('Model output count differs from its reservations.');
			const results = [];
			for (const reservation of outputs) {
				const claims = outcome.result.outputs.filter(({ claimId }) => claimId === reservation.claimId);
				if (claims.length !== 1 || claims[0].role !== reservation.role || claims[0].mediaType !== reservation.mediaType) {
					throw new Error('Model output lost its authenticated reservation identity.');
				}
				const blob = await bridge.readOutput({ jobId, claim: claims[0] });
				results.push({ claim: claims[0], bytes: Array.from(new Uint8Array(await blob.arrayBuffer())) });
			}
			return { outcome, elapsedMs, progress, outputs: results };
		} finally {
			unsubscribe();
			await bridge.release(jobId);
		}
	}, request);
}
