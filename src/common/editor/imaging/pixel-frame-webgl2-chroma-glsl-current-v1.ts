/* SPDX-License-Identifier: AGPL-3.0-only */

/** Native continuous encoded coordinates only. The surrounding fragment owns
 * odd transfer and unchanged-channel restoration; this helper never clips RGB
 * or quantizes an intermediate to bytes. Uniform controls retain authored units. */
export const PIXEL_FRAME_WEBGL2_CHROMA_FUNCTIONS_CURRENT_V1 = `
const float COLOR_CENTERS_CURRENT_V1[9] = float[9](0.0, 0.5, 1.0, 2.0, 3.0, 4.0, 4.5, 5.0, 6.0);

float colorLumaCurrentV1(vec3 rgb) {
	return (54.0 * rgb.r + 183.0 * rgb.g + 19.0 * rgb.b) / 256.0;
}

float colorHueCurrentV1(vec3 rgb, float maximum, float chroma) {
	float position = maximum == rgb.r ? (rgb.g - rgb.b) / chroma
		: maximum == rgb.g ? (rgb.b - rgb.r) / chroma + 2.0 : (rgb.r - rgb.g) / chroma + 4.0;
	return position < 0.0 ? position + 6.0 : position;
}

vec3 colorBandsCurrentV1(float position) {
	int left = 0;
	for (int index = 0; index < 7; index++) {
		if (position < COLOR_CENTERS_CURRENT_V1[left + 1]) break;
		left++;
	}
	vec3 a = uBands[left].xyz, b = uBands[(left + 1) % 8].xyz;
	return a + (b - a) * ((position - COLOR_CENTERS_CURRENT_V1[left])
		/ (COLOR_CENTERS_CURRENT_V1[left + 1] - COLOR_CENTERS_CURRENT_V1[left]));
}

vec3 chromaColorCurrentV1(vec3 rgb) {
	if (uKind == 3) {
		float saturation = 1.0 + uParams0.x / 100.0, firstY = colorLumaCurrentV1(rgb);
		if (saturation != 1.0) rgb = vec3(firstY) + (rgb - vec3(firstY)) * saturation;
		float range = max(max(rgb.r, rgb.g), rgb.b) - min(min(rgb.r, rgb.g), rgb.b);
		float factor = 1.0 + uParams0.y / 100.0 * (1.0 - clamp(range, 0.0, 1.0));
		if (factor != 1.0) { float y = colorLumaCurrentV1(rgb); rgb = vec3(y) + (rgb - vec3(y)) * factor; }
		return rgb;
	}
	float maximum = max(max(rgb.r, rgb.g), rgb.b), minimum = min(min(rgb.r, rgb.g), rgb.b);
	float chroma = maximum - minimum;
	if (chroma == 0.0) return rgb;
	float position = colorHueCurrentV1(rgb, maximum, chroma);
	vec3 controls = colorBandsCurrentV1(position);
	if (uKind == 4) return vec3(colorLumaCurrentV1(rgb) + chroma * controls.x / 100.0);
	float hueControl = controls.x, saturationControl = controls.y, luminance = controls.z / 100.0;
	if (hueControl == 0.0 && saturationControl == 0.0 && luminance == 0.0) return rgb;
	// Preserve the affine cube's signed offset and HDR span. The incoming hue
	// selects every control before any of saturation, luminance or hue changes.
	float offset = min(0.0, minimum), span = max(1.0, maximum - offset);
	float low = (minimum - offset) / span, high = (maximum - offset) / span;
	float lightness = (high + low) / 2.0, domain = 1.0 - abs(2.0 * lightness - 1.0);
	float saturation = clamp((chroma / span) / domain * (1.0 + saturationControl / 100.0), 0.0, 1.0);
	float nextLightness = lightness + (luminance >= 0.0 ? 1.0 - lightness : lightness) * luminance;
	float nextChroma = (1.0 - abs(2.0 * nextLightness - 1.0)) * saturation;
	float turn = hueControl / 60.0;
	if (turn == 0.0) {
		float base = nextLightness - nextChroma / 2.0;
		return vec3(offset) + span * (vec3(base) + nextChroma * (rgb - vec3(minimum)) / chroma);
	}
	float phase = mod(mod(position + turn, 6.0) + 6.0, 6.0);
	int sector = int(floor(phase));
	float x = nextChroma * (1.0 - abs(mod(phase, 2.0) - 1.0)), base = nextLightness - nextChroma / 2.0;
	float r = sector == 0 || sector == 5 ? nextChroma : sector == 1 || sector == 4 ? x : 0.0;
	float g = sector == 1 || sector == 2 ? nextChroma : sector == 0 || sector == 3 ? x : 0.0;
	float b = sector == 3 || sector == 4 ? nextChroma : sector == 2 || sector == 5 ? x : 0.0;
	return vec3(offset) + span * (vec3(base) + vec3(r, g, b));
}
`;
