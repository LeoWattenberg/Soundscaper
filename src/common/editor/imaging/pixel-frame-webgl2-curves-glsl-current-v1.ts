/* SPDX-License-Identifier: AGPL-3.0-only */

/** Four authored/derived point lists, rather than sampled byte transfer tables.
 * Master and channel compose within one pass; endpoint segments extrapolate.
 * Preparation refuses distinct knots collapsed by Float32 uniform conversion. */
export const PIXEL_FRAME_WEBGL2_CURVES_FUNCTIONS_CURRENT_V1 = `
float sampleColorCurveCurrentV1(int channel, float value) {
	if (uParams0[channel] != 0.0) return value;
	int base = channel * 32, count = uCurveCounts[channel], right = 1;
	for (int index = 0; index < 32; index++) {
		if (right >= count - 1 || !(value > uCurvePoints[base + right].x)) break;
		right++;
	}
	// A derived region center may equal an endpoint. Skip zero-width segments
	// in the same directions as the native scalar before computing a slope.
	for (int index = 0; index < 32; index++) {
		if (right >= count - 1 || !(uCurvePoints[base + right].x == uCurvePoints[base + right - 1].x)) break;
		right++;
	}
	for (int index = 0; index < 32; index++) {
		if (right <= 1 || !(uCurvePoints[base + right].x == uCurvePoints[base + right - 1].x)) break;
		right--;
	}
	vec2 a = uCurvePoints[base + right - 1], b = uCurvePoints[base + right];
	if (b.x == a.x) return value;
	float slope = (b.y - a.y) / (b.x - a.x);
	return slope == 1.0 && a.x == a.y ? value : a.y + (value - a.x) * slope;
}

vec3 curvesColorCurrentV1(vec3 rgb) {
	return vec3(sampleColorCurveCurrentV1(1, sampleColorCurveCurrentV1(0, rgb.r)),
		sampleColorCurveCurrentV1(2, sampleColorCurveCurrentV1(0, rgb.g)),
		sampleColorCurveCurrentV1(3, sampleColorCurveCurrentV1(0, rgb.b)));
}
`;
