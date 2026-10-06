/* SPDX-License-Identifier: AGPL-3.0-only */

import { clippingReport, spectrumReport } from './specialized-audio-analysis.ts';
import { measureBextLoudness } from './broadcast-loudness.ts';
import { createLoudnessMeasurementReport, loudnessMeasurementScope } from './loudness-measurement-report.ts';

interface Range { readonly startFrame: number; readonly endFrame: number }
export interface AudioAnalysisReportRequest {
	readonly kind: 'spectrum' | 'clipping' | 'loudness';
	readonly channels: Float32Array[];
	readonly sampleRate: number;
	readonly scope: string;
	readonly range: Range;
	readonly options: Readonly<Record<string, unknown>>;
	readonly channelWeights?: readonly number[];
}

export function calculateAudioAnalysisReport(request: AudioAnalysisReportRequest) {
	if (request.kind === 'spectrum') return spectrumReport(request.scope, request.range, request.channels, request.sampleRate, request.options);
	if (request.kind === 'clipping') return clippingReport(request.scope, request.range, request.channels, request.options);
	return createLoudnessMeasurementReport({
		measurement: measureBextLoudness(request.channels, request.sampleRate, {
			...(request.channelWeights ? { channelWeights: request.channelWeights } : {}),
		}), sampleRate: request.sampleRate, channelCount: request.channels.length,
		range: request.range, scope: loudnessMeasurementScope(request.range),
	});
}

export function executeAudioAnalysisReportRequest(value: unknown) {
	let requestId: string | null = null;
	try {
		if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Analysis request must be an object.');
		const request = value as Record<string, unknown>;
		if (typeof request.requestId !== 'string' || !request.requestId || request.requestId.length > 160) throw new TypeError('Analysis request id is required.');
		requestId = request.requestId;
		if (!['spectrum', 'clipping', 'loudness'].includes(String(request.kind))) throw new RangeError('Unknown analysis report kind.');
		if (!Array.isArray(request.channels) || !request.channels.length
			|| request.channels.some(channel => !(channel instanceof Float32Array))) throw new TypeError('Analysis PCM channels must be Float32Arrays.');
		return { type: 'result' as const, requestId,
			result: calculateAudioAnalysisReport(request as unknown as AudioAnalysisReportRequest) };
	} catch (error) {
		return { type: 'error' as const, requestId, error: {
			name: error instanceof Error ? error.name : 'Error', message: error instanceof Error ? error.message : String(error),
		} };
	}
}
