/* SPDX-License-Identifier: AGPL-3.0-only */

#include "openfx_abi.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstring>
#include <string>
#include <vector>

#ifdef _WIN32
#define FRAMESCAPER_EXPORT extern "C" __declspec(dllexport)
#else
#define FRAMESCAPER_EXPORT extern "C" __attribute__((visibility("default")))
#endif

namespace {

OfxHost* host = nullptr;
const OfxPropertySuiteV1* properties = nullptr;
const OfxImageEffectSuiteV1* images = nullptr;
const OfxParameterSuiteV1* parameters = nullptr;
const OfxMemorySuiteV1* memory = nullptr;
const OfxMultiThreadSuiteV1* threads = nullptr;
const OfxProgressSuiteV2* progress = nullptr;
const OfxTimeLineSuiteV1* timeline = nullptr;
const OfxParametricParameterSuiteV1* parametrics = nullptr;
const OfxInteractSuiteV1* interacts = nullptr;
const OfxDrawSuiteV1* draws = nullptr;
const OfxImageEffectOpenGLRenderSuiteV1* open_gl = nullptr;
const OfxOpenCLProgramSuiteV1* opencl_programs = nullptr;
bool suites_ok = false;
bool open_gl_attached = false;

template <typename Suite>
const Suite* suite(const char* name, int version = 1) {
	return static_cast<const Suite*>(host->fetchSuite(host->host, name, version));
}

void thread_function(unsigned int index, unsigned int count, void* argument) {
	if (index < count && argument != nullptr) ++*static_cast<unsigned int*>(argument);
}

void set_host(OfxHost* value) { host = value; }

bool load_suites() {
	if (host == nullptr || host->fetchSuite == nullptr) return false;
	properties = suite<OfxPropertySuiteV1>(kOfxPropertySuite);
	images = suite<OfxImageEffectSuiteV1>(kOfxImageEffectSuite);
	parameters = suite<OfxParameterSuiteV1>(kOfxParameterSuite);
	memory = suite<OfxMemorySuiteV1>(kOfxMemorySuite);
	threads = suite<OfxMultiThreadSuiteV1>(kOfxMultiThreadSuite);
	progress = suite<OfxProgressSuiteV2>(kOfxProgressSuite, 2);
	timeline = suite<OfxTimeLineSuiteV1>(kOfxTimeLineSuite);
	parametrics = suite<OfxParametricParameterSuiteV1>(kOfxParametricParameterSuite);
	interacts = suite<OfxInteractSuiteV1>(kOfxInteractSuite);
	draws = suite<OfxDrawSuiteV1>(kOfxDrawSuite);
	open_gl = suite<OfxImageEffectOpenGLRenderSuiteV1>(kOfxOpenGLRenderSuite);
	opencl_programs = suite<OfxOpenCLProgramSuiteV1>(kOfxOpenCLProgramSuite);
	const bool dispatched = properties != nullptr && images != nullptr && parameters != nullptr
		&& memory != nullptr && threads != nullptr && progress != nullptr
		&& suite<OfxMessageSuiteV2>(kOfxMessageSuite, 2) != nullptr
		&& timeline != nullptr
		&& interacts != nullptr && draws != nullptr
		&& suite<OfxDialogSuiteV1>(kOfxDialogSuite) != nullptr
		&& parametrics != nullptr && open_gl != nullptr && opencl_programs != nullptr
		&& host->fetchSuite(host->host, kOfxInteractSuite, 2) == nullptr
		&& host->fetchSuite(host->host, "OfxNetworkSuite", 1) == nullptr
		&& host->fetchSuite(host->host, "OfxCudaVendorSuite", 1) == nullptr;
	if (!dispatched) return false;
	void* bytes = nullptr;
	if (memory->memoryAlloc(nullptr, 32, &bytes) != kOfxStatOK || bytes == nullptr
		|| memory->memoryFree(bytes) != kOfxStatOK) return false;
	unsigned int calls = 0;
	if (threads->multiThread(thread_function, 2, &calls) != kOfxStatOK || calls == 0) return false;
	return true;
}

bool parameter_conformance(OfxParamSetHandle set) {
	OfxParamHandle integer = nullptr;
	OfxParamHandle integer2d = nullptr;
	OfxParamHandle scalar = nullptr;
	OfxParamHandle rgba = nullptr;
	OfxParamHandle copy = nullptr;
	OfxParamHandle string = nullptr;
	OfxParamHandle custom = nullptr;
	OfxParamHandle curve = nullptr;
	if (parameters->paramDefine(set, kOfxParamTypeDouble, "copyDouble", nullptr) != kOfxStatOK
		|| parameters->paramGetHandle(set, "parameter0", &integer, nullptr) != kOfxStatOK
		|| parameters->paramGetHandle(set, "parameter1", &integer2d, nullptr) != kOfxStatOK
		|| parameters->paramGetHandle(set, "parameter3", &scalar, nullptr) != kOfxStatOK
		|| parameters->paramGetHandle(set, "parameter7", &rgba, nullptr) != kOfxStatOK
		|| parameters->paramGetHandle(set, "copyDouble", &copy, nullptr) != kOfxStatOK
		|| parameters->paramGetHandle(set, "parameter10", &string, nullptr) != kOfxStatOK
		|| parameters->paramGetHandle(set, "parameter15", &custom, nullptr) != kOfxStatOK
		|| parameters->paramGetHandle(set, "parameter14", &curve, nullptr) != kOfxStatOK) return false;
	int integer_value = 0;
	int integer_x = 0;
	int integer_y = 0;
	char* string_value = nullptr;
	char* custom_value = nullptr;
	double value = 0;
	double red = 0;
	double green = 0;
	double blue = 0;
	double alpha = 0;
	double derivative = 0;
	double integral = 0;
	unsigned int keys = 0;
	OfxTime key_time = 0;
	if (parameters->paramSetValue(integer, 7) != kOfxStatOK
		|| parameters->paramGetValue(integer, &integer_value) != kOfxStatOK || integer_value != 7
		|| parameters->paramSetValue(integer2d, 2, 3) != kOfxStatOK
		|| parameters->paramGetValue(integer2d, &integer_x, &integer_y) != kOfxStatOK
		|| integer_x != 2 || integer_y != 3
		|| parameters->paramSetValue(rgba, 0.1, 0.2, 0.3, 0.4) != kOfxStatOK
		|| parameters->paramGetValue(rgba, &red, &green, &blue, &alpha) != kOfxStatOK
		|| red != 0.1 || green != 0.2 || blue != 0.3 || alpha != 0.4
		|| parameters->paramSetValue(string, "framescaper") != kOfxStatOK
		|| parameters->paramGetValue(string, &string_value) != kOfxStatOK
		|| string_value == nullptr || std::strcmp(string_value, "framescaper") != 0
		|| parameters->paramSetValue(custom, "opaque-state") != kOfxStatOK
		|| parameters->paramGetValue(custom, &custom_value) != kOfxStatOK
		|| custom_value == nullptr || std::strcmp(custom_value, "opaque-state") != 0
		|| parameters->paramSetValueAtTime(scalar, 0.0, 2.0) != kOfxStatOK
		|| parameters->paramSetValueAtTime(scalar, 10.0, 4.0) != kOfxStatOK
		|| parameters->paramGetValueAtTime(scalar, 5.0, &value) != kOfxStatOK
		|| std::abs(value - 3.0) > 1e-12
		|| parameters->paramGetDerivative(scalar, 5.0, &derivative) != kOfxStatOK
		|| std::abs(derivative - 0.2) > 1e-12
		|| parameters->paramGetIntegral(scalar, 0.0, 10.0, &integral) != kOfxStatOK
		|| std::abs(integral - 30.0) > 1e-12
		|| parameters->paramGetNumKeys(scalar, &keys) != kOfxStatOK || keys != 2
		|| parameters->paramGetKeyTime(scalar, 1, &key_time) != kOfxStatOK || key_time != 10.0
		|| parameters->paramGetKeyIndex(scalar, 5.0, 1, &integer_value) != kOfxStatOK
		|| integer_value != 1
		|| parameters->paramCopy(copy, scalar, 2.0, nullptr) != kOfxStatOK
		|| parameters->paramGetValueAtTime(copy, 7.0, &value) != kOfxStatOK
		|| std::abs(value - 3.0) > 1e-12) return false;
	if (parametrics->parametricParamAddControlPoint(curve, 0, 0, 0, 0, false) != kOfxStatOK
		|| parametrics->parametricParamAddControlPoint(curve, 0, 0, 10, 20, false) != kOfxStatOK
		|| parametrics->parametricParamGetValue(curve, 0, 0, 5, &value) != kOfxStatOK
		|| std::abs(value - 10.0) > 1e-12) return false;
	int control_points = 0;
	double point_key = 0;
	double point_value = 0;
	return parametrics->parametricParamGetNControlPoints(curve, 0, 0, &control_points) == kOfxStatOK
		&& control_points == 2
		&& parametrics->parametricParamGetNthControlPoint(
			curve, 0, 0, 1, &point_key, &point_value
		) == kOfxStatOK && point_key == 10 && point_value == 20
		&& parametrics->parametricParamSetNthControlPoint(
			curve, 0, 0, 1, 8, 16, false
		) == kOfxStatOK
		&& parametrics->parametricParamDeleteControlPoint(curve, 0, 1) == kOfxStatOK
		&& parametrics->parametricParamDeleteAllControlPoints(curve, 0) == kOfxStatOK
		&& parameters->paramDeleteKey(scalar, 10) == kOfxStatOK
		&& parameters->paramDeleteAllKeys(scalar) == kOfxStatOK;
}

bool declare_supported_pixel_depths(OfxPropertySetHandle effect_properties) {
#if defined(FRAMESCAPER_OPENFX_MISSING_PIXEL_DEPTH_FIXTURE)
	static_cast<void>(effect_properties);
	return true;
#elif defined(FRAMESCAPER_OPENFX_UNKNOWN_PIXEL_DEPTH_FIXTURE)
	const char* depths[]{kOfxBitDepthByte, "OfxBitDepthHalf"};
#elif defined(FRAMESCAPER_OPENFX_DUPLICATE_PIXEL_DEPTH_FIXTURE)
	const char* depths[]{kOfxBitDepthByte, kOfxBitDepthByte};
#elif defined(FRAMESCAPER_OPENFX_NO_BYTE_PIXEL_DEPTH_FIXTURE)
	const char* depths[]{kOfxBitDepthFloat, kOfxBitDepthShort};
#else
	// Deliberately non-canonical: the scanner owns deterministic projection order.
	const char* depths[]{kOfxBitDepthFloat, kOfxBitDepthByte, kOfxBitDepthShort};
#endif
#if !defined(FRAMESCAPER_OPENFX_MISSING_PIXEL_DEPTH_FIXTURE)
	return properties->propSetStringN(
		effect_properties, kOfxImageEffectPropSupportedPixelDepths,
		static_cast<int>(std::size(depths)), depths
	) == kOfxStatOK;
#endif
}

bool declare_supported_components(
	OfxPropertySetHandle clip_properties,
	const char* context,
	const char* clip
) {
	static_cast<void>(context);
	static_cast<void>(clip);
#if defined(FRAMESCAPER_OPENFX_MISSING_COMPONENT_FIXTURE)
	if (std::strcmp(context, kOfxImageEffectContextFilter) == 0
		&& std::strcmp(clip, "Source") == 0) return true;
#elif defined(FRAMESCAPER_OPENFX_UNKNOWN_COMPONENT_FIXTURE)
	const char* components[]{kOfxImageComponentRGBA, "OfxImageComponentXY"};
#elif defined(FRAMESCAPER_OPENFX_DUPLICATE_COMPONENT_FIXTURE)
	const char* components[]{kOfxImageComponentRGBA, kOfxImageComponentRGBA};
#elif defined(FRAMESCAPER_OPENFX_NO_RGBA_COMPONENT_FIXTURE)
	const char* components[]{kOfxImageComponentAlpha, kOfxImageComponentRGB};
#else
	const char* components[]{kOfxImageComponentAlpha, kOfxImageComponentRGBA, kOfxImageComponentRGB};
#endif
#if !defined(FRAMESCAPER_OPENFX_MISSING_COMPONENT_FIXTURE)
	if (
#if defined(FRAMESCAPER_OPENFX_INCONSISTENT_COMPONENT_FIXTURE)
		std::strcmp(context, kOfxImageEffectContextFilter) == 0
		&& std::strcmp(clip, "Output") == 0
#else
		false
#endif
	) {
		return properties->propSetString(
			clip_properties, kOfxImageEffectPropSupportedComponents, 0,
			kOfxImageComponentRGBA
		) == kOfxStatOK;
	}
	return properties->propSetStringN(
		clip_properties, kOfxImageEffectPropSupportedComponents,
		static_cast<int>(std::size(components)), components
	) == kOfxStatOK;
#else
	static_cast<void>(clip_properties);
	static_cast<void>(clip);
	return true;
#endif
}

#include "conformance_interact.inc"

OfxStatus describe(const void* handle) {
	OfxPropertySetHandle effect_properties = nullptr;
	if (images->getPropertySet(
		reinterpret_cast<OfxImageEffectHandle>(const_cast<void*>(handle)),
		&effect_properties
	) != kOfxStatOK) return kOfxStatFailed;
	const char* contexts[]{
		kOfxImageEffectContextGenerator, kOfxImageEffectContextFilter,
		kOfxImageEffectContextTransition, kOfxImageEffectContextPaint,
		kOfxImageEffectContextRetimer, kOfxImageEffectContextGeneral,
	};
	if (properties->propSetStringN(
		effect_properties, kOfxImageEffectPropSupportedContexts, 6, contexts
		) != kOfxStatOK || !declare_supported_pixel_depths(effect_properties)
		|| properties->propSetString(
		effect_properties, kOfxImageEffectPluginRenderThreadSafety, 0,
		kOfxImageEffectRenderFullySafe
	) != kOfxStatOK
		|| properties->propSetString(effect_properties, kOfxImageEffectPropCPURenderSupported, 0, "true") != kOfxStatOK
		|| properties->propSetString(effect_properties, kOfxImageEffectPropOpenGLRenderSupported, 0, "true") != kOfxStatOK
		|| properties->propSetString(effect_properties, kOfxImageEffectPropOpenCLRenderSupported, 0, "true") != kOfxStatOK
		|| properties->propSetString(effect_properties, kOfxImageEffectPropCudaRenderSupported, 0, "true") != kOfxStatOK
		|| properties->propSetString(effect_properties, kOfxImageEffectPropCudaStreamSupported, 0, "true") != kOfxStatOK
		|| properties->propSetString(effect_properties, kOfxImageEffectPropMetalRenderSupported, 0, "true") != kOfxStatOK
		|| properties->propSetPointer(
		effect_properties, kOfxImageEffectPluginPropOverlayInteractV2, 0,
		reinterpret_cast<void*>(overlay_interact)
	) != kOfxStatOK) return kOfxStatFailed;
	OfxParamSetHandle set = nullptr;
	if (images->getParamSet(reinterpret_cast<OfxImageEffectHandle>(const_cast<void*>(handle)), &set) != kOfxStatOK) return kOfxStatFailed;
	if (parameters->paramDefine(set, kOfxParamTypeDouble, "speed", nullptr) != kOfxStatOK
		|| parameters->paramDefine(set, kOfxParamTypeInteger, "cancelIterations", nullptr) != kOfxStatOK) {
		return kOfxStatFailed;
	}
	const std::array<const char*, 16> types{
		kOfxParamTypeInteger, kOfxParamTypeInteger2D, kOfxParamTypeInteger3D,
		kOfxParamTypeDouble, kOfxParamTypeDouble2D, kOfxParamTypeDouble3D,
		kOfxParamTypeRGB, kOfxParamTypeRGBA, kOfxParamTypeBoolean,
		kOfxParamTypeChoice, kOfxParamTypeString, kOfxParamTypeGroup,
		kOfxParamTypePage, kOfxParamTypePushButton, kOfxParamTypeParametric,
		kOfxParamTypeCustom,
	};
	for (std::size_t index = 0; index < types.size(); ++index) {
		const auto name = std::string{"parameter"} + std::to_string(index);
		OfxPropertySetHandle parameter_properties = nullptr;
		if (parameters->paramDefine(
			set, types[index], name.c_str(), index == 15 ? &parameter_properties : nullptr
		) != kOfxStatOK) return kOfxStatFailed;
		if (index == 15 && (parameter_properties == nullptr || properties->propSetPointer(
			parameter_properties, kOfxParamPropInteractV1, 0,
			reinterpret_cast<void*>(custom_parameter_interact)
		) != kOfxStatOK)) return kOfxStatFailed;
	}
	return parameter_conformance(set) ? kOfxStatOK : kOfxStatFailed;
}

OfxStatus describe_context(const void* handle, OfxPropertySetHandle input) {
	char* context = nullptr;
	if (properties->propGetString(input, kOfxImageEffectPropContext, 0, &context) != kOfxStatOK
		|| context == nullptr) return kOfxStatFailed;
#if defined(FRAMESCAPER_OPENFX_CONTEXT_MISMATCH_FIXTURE)
	if (std::strcmp(context, kOfxImageEffectContextFilter) == 0) {
		OfxParamSetHandle set = nullptr;
		if (images->getParamSet(
			reinterpret_cast<OfxImageEffectHandle>(const_cast<void*>(handle)), &set
		) != kOfxStatOK || parameters->paramDefine(
			set, kOfxParamTypeDouble, "filterOnly", nullptr
		) != kOfxStatOK) return kOfxStatFailed;
	}
#endif
	OfxParamSetHandle set = nullptr;
	if (images->getParamSet(
		reinterpret_cast<OfxImageEffectHandle>(const_cast<void*>(handle)), &set
	) != kOfxStatOK) return kOfxStatFailed;
#if defined(FRAMESCAPER_OPENFX_INCONSISTENT_PIXEL_DEPTH_FIXTURE)
	if (std::strcmp(context, kOfxImageEffectContextFilter) == 0) {
		OfxPropertySetHandle effect_properties = nullptr;
		const char* depths[]{kOfxBitDepthByte, kOfxBitDepthShort};
		if (images->getPropertySet(
			reinterpret_cast<OfxImageEffectHandle>(const_cast<void*>(handle)),
			&effect_properties
		) != kOfxStatOK || properties->propSetStringN(
			effect_properties, kOfxImageEffectPropSupportedPixelDepths,
			static_cast<int>(std::size(depths)), depths
		) != kOfxStatOK) return kOfxStatFailed;
	}
#endif
#if defined(FRAMESCAPER_OPENFX_STANDARD_PARAMETER_SPOOF_FIXTURE)
	const char* spoofed = std::strcmp(context, kOfxImageEffectContextRetimer) == 0
		? "SourceTime" : std::strcmp(context, kOfxImageEffectContextTransition) == 0
			? "Transition" : nullptr;
	if (spoofed != nullptr
		&& parameters->paramDefine(set, kOfxParamTypeDouble, spoofed, nullptr) != kOfxStatOK) {
		return kOfxStatFailed;
	}
#endif
	std::vector<const char*> clips;
	if (std::strcmp(context, kOfxImageEffectContextFilter) == 0
		|| std::strcmp(context, kOfxImageEffectContextRetimer) == 0) clips = {"Source"};
	else if (std::strcmp(context, kOfxImageEffectContextTransition) == 0) {
		clips = {"SourceFrom", "SourceTo"};
	} else if (std::strcmp(context, kOfxImageEffectContextPaint) == 0) {
		clips = {"Source", "Mask"};
	} else if (std::strcmp(context, kOfxImageEffectContextGeneral) == 0) {
		clips = {"InputA", "InputB"};
	} else if (std::strcmp(context, kOfxImageEffectContextGenerator) != 0) {
		return kOfxStatFailed;
	}
	clips.push_back("Output");
	OfxPropertySetHandle clip_properties = nullptr;
	for (const char* clip : clips) {
		if (images->clipDefine(
			reinterpret_cast<OfxImageEffectHandle>(const_cast<void*>(handle)), clip, &clip_properties
		) != kOfxStatOK || !declare_supported_components(clip_properties, context, clip)) {
			return kOfxStatFailed;
		}
	}
	return kOfxStatOK;
}

OfxStatus render(const void* handle, OfxPropertySetHandle input) {
	auto effect = reinterpret_cast<OfxImageEffectHandle>(const_cast<void*>(handle));
	if (images->abort(effect) != 0) return kOfxStatFailed;
	double render_time = 0;
	double timeline_time = 0;
	if (input == nullptr
		|| properties->propGetDouble(input, kOfxPropTime, 0, &render_time) != kOfxStatOK
		|| timeline->getTime(effect, &timeline_time) != kOfxStatOK
		|| render_time != timeline_time) return kOfxStatFailed;
	int open_gl_enabled = 0;
	int opencl_enabled = 0;
	int cuda_enabled = 0;
	int metal_enabled = 0;
	void* opencl_queue = nullptr;
	void* cuda_stream = nullptr;
	void* metal_queue = nullptr;
	if (properties->propGetInt(input, kOfxImageEffectPropOpenGLEnabled, 0, &open_gl_enabled) != kOfxStatOK
		|| properties->propGetInt(input, kOfxImageEffectPropOpenCLEnabled, 0, &opencl_enabled) != kOfxStatOK
		|| properties->propGetInt(input, kOfxImageEffectPropCudaEnabled, 0, &cuda_enabled) != kOfxStatOK
		|| properties->propGetInt(input, kOfxImageEffectPropMetalEnabled, 0, &metal_enabled) != kOfxStatOK
		|| open_gl_enabled + opencl_enabled + cuda_enabled + metal_enabled > 1
		|| (open_gl_enabled != 0 && !open_gl_attached)) return kOfxStatFailed;
	if (opencl_enabled != 0 && (properties->propGetPointer(input, kOfxImageEffectPropOpenCLCommandQueue, 0, &opencl_queue) != kOfxStatOK || opencl_queue == nullptr)) return kOfxStatFailed;
	if (cuda_enabled != 0 && (properties->propGetPointer(input, kOfxImageEffectPropCudaStream, 0, &cuda_stream) != kOfxStatOK || cuda_stream == nullptr)) return kOfxStatFailed;
	if (metal_enabled != 0 && (properties->propGetPointer(input, kOfxImageEffectPropMetalCommandQueue, 0, &metal_queue) != kOfxStatOK || metal_queue == nullptr)) return kOfxStatFailed;
	OfxParamSetHandle set = nullptr;
	OfxParamHandle speed = nullptr;
	OfxParamHandle cancellation_iterations = nullptr;
	double current_speed = 0;
	double keyed_speed = 0;
	int cancellation_polls = 0;
	if (images->getParamSet(effect, &set) != kOfxStatOK
		|| parameters->paramGetHandle(set, "speed", &speed, nullptr) != kOfxStatOK
		|| parameters->paramGetHandle(set, "cancelIterations", &cancellation_iterations, nullptr) != kOfxStatOK
		|| parameters->paramGetValue(speed, &current_speed) != kOfxStatOK
		|| parameters->paramGetValueAtTime(speed, render_time, &keyed_speed) != kOfxStatOK
		|| parameters->paramGetValue(cancellation_iterations, &cancellation_polls) != kOfxStatOK
		|| cancellation_polls < 0) return kOfxStatFailed;
	for (int poll = 0; poll < cancellation_polls; ++poll) {
		if (images->abort(effect) != 0) return kOfxStatFailed;
	}
	const auto clip_handle = [&](const char* name, OfxImageClipHandle& result) {
		return images->clipGetHandle(effect, name, &result, nullptr) == kOfxStatOK;
	};
	OfxImageClipHandle source = nullptr;
	OfxImageClipHandle second = nullptr;
	OfxImageClipHandle output = nullptr;
	const bool transition = clip_handle("SourceFrom", source);
	const bool paint = !transition && clip_handle("Mask", second);
	const bool general = !transition && !paint && clip_handle("InputA", source);
	const bool filtered = !transition && !paint && !general && clip_handle("Source", source);
	if (transition && !clip_handle("SourceTo", second)) return kOfxStatFailed;
	if (paint && !clip_handle("Source", source)) return kOfxStatFailed;
	if (general && !clip_handle("InputB", second)) return kOfxStatFailed;
	const bool generator = !transition && !paint && !general && !filtered;
	if (!clip_handle("Output", output)) return kOfxStatFailed;
	double standard_value = 0;
	OfxParamHandle standard = nullptr;
	const char* standard_name = transition ? "Transition" : filtered
		&& parameters->paramGetHandle(set, "SourceTime", &standard, nullptr) == kOfxStatOK
		? "SourceTime" : nullptr;
	if (standard_name != nullptr
		&& (parameters->paramGetHandle(set, standard_name, &standard, nullptr) != kOfxStatOK
			|| parameters->paramGetValueAtTime(standard, render_time, &standard_value) != kOfxStatOK
			|| !std::isfinite(standard_value)
			|| (transition && (standard_value < 0 || standard_value > 1))
			|| parameters->paramSetValue(standard, 0.25) != kOfxStatErrUnsupported
			|| parameters->paramSetValueAtTime(standard, render_time, 0.25) != kOfxStatErrUnsupported
			|| parameters->paramDeleteAllKeys(standard) != kOfxStatErrUnsupported)) {
		return kOfxStatFailed;
	}
	OfxPropertySetHandle source_image = nullptr;
	OfxPropertySetHandle second_image = nullptr;
	OfxPropertySetHandle image = nullptr;
	const OfxTime source_image_time = standard_name != nullptr
		&& std::strcmp(standard_name, "SourceTime") == 0 ? standard_value : render_time;
	if (source_image_time != render_time
		&& images->clipGetImage(source, render_time, nullptr, &source_image) != kOfxStatErrValue) {
		return kOfxStatFailed;
	}
	if ((!generator && images->clipGetImage(source, source_image_time, nullptr, &source_image) != kOfxStatOK)
		|| ((transition || paint || general)
			&& images->clipGetImage(second, render_time, nullptr, &second_image) != kOfxStatOK)
		|| images->clipGetImage(output, render_time, nullptr, &image) != kOfxStatOK) {
		return kOfxStatFailed;
	}
	OfxPropertySetHandle source_texture = nullptr;
	OfxPropertySetHandle output_texture = nullptr;
	if (open_gl_enabled != 0
		&& ((!generator && open_gl->clipLoadTexture(source, source_image_time, nullptr, nullptr, &source_texture) != kOfxStatOK)
			|| open_gl->clipLoadTexture(output, render_time, nullptr, nullptr, &output_texture) != kOfxStatOK)) return kOfxStatGPURenderFailed;
	void* source_data = nullptr;
	void* second_data = nullptr;
	void* data = nullptr;
	int source_row_bytes = 0;
	int second_row_bytes = 0;
	int output_row_bytes = 0;
	int source_bounds[4]{};
	int second_bounds[4]{};
	int output_bounds[4]{};
	const auto image_identity = [&](OfxPropertySetHandle value, void*& bytes, int& row, int* bounds) {
		return properties->propGetPointer(value, kOfxImagePropData, 0, &bytes) == kOfxStatOK
			&& properties->propGetInt(value, kOfxImagePropRowBytes, 0, &row) == kOfxStatOK
			&& properties->propGetIntN(value, kOfxImagePropBounds, 4, bounds) == kOfxStatOK
			&& bytes != nullptr && row >= 4;
	};
	if ((!generator && !image_identity(source_image, source_data, source_row_bytes, source_bounds))
		|| ((transition || paint || general)
			&& !image_identity(second_image, second_data, second_row_bytes, second_bounds))
		|| properties->propGetPointer(image, kOfxImagePropData, 0, &data) != kOfxStatOK
		|| properties->propGetInt(image, kOfxImagePropRowBytes, 0, &output_row_bytes) != kOfxStatOK
		|| properties->propGetIntN(image, kOfxImagePropBounds, 4, output_bounds) != kOfxStatOK
		|| output_row_bytes < 4 || data == nullptr
		|| (!generator && !std::equal(
			std::begin(source_bounds), std::end(source_bounds), std::begin(output_bounds)
		)) || ((transition || paint || general) && !std::equal(
			std::begin(second_bounds), std::end(second_bounds), std::begin(output_bounds)
		))) return kOfxStatFailed;
	const auto width = output_bounds[2] - output_bounds[0];
	const auto height = output_bounds[3] - output_bounds[1];
	if (width < 1 || height < 1) return kOfxStatFailed;
	for (int y = 0; y < height; ++y) {
		for (int x = 0; x < width; ++x) {
			auto* output_pixel = static_cast<unsigned char*>(data)
				+ y * output_row_bytes + x * 4;
			if (generator) {
				std::copy_n(std::array<unsigned char, 4>{17, 34, 51, 255}.begin(), 4, output_pixel);
				continue;
			}
			auto* source_pixel = static_cast<unsigned char*>(source_data) + y * source_row_bytes + x * 4;
			auto* second_pixel = second_data == nullptr ? nullptr
				: static_cast<unsigned char*>(second_data) + y * second_row_bytes + x * 4;
			for (std::size_t channel = 0; channel < 4; ++channel) output_pixel[channel] = source_pixel[channel];
			if (transition || general) {
				const auto amount = transition ? standard_value : 0.5;
				for (std::size_t channel = 0; channel < 4; ++channel) output_pixel[channel] = static_cast<unsigned char>(
					std::lround(source_pixel[channel] * (1 - amount) + second_pixel[channel] * amount)
				);
			} else if (paint) output_pixel[3] = second_pixel[3];
			else {
				output_pixel[0] = static_cast<unsigned char>(std::lround(
					source_pixel[0] * std::clamp(current_speed, 0.0, 1.0)
				));
				output_pixel[3] = static_cast<unsigned char>(std::lround(
					std::clamp(keyed_speed, 0.0, 1.0) * 255.0
				));
			}
		}
	}
	if ((!generator && images->clipReleaseImage(source_image) != kOfxStatOK)
		|| ((transition || paint || general) && images->clipReleaseImage(second_image) != kOfxStatOK)
		|| images->clipReleaseImage(image) != kOfxStatOK
		|| (source_texture != nullptr && open_gl->clipFreeTexture(source_texture) != kOfxStatOK)
		|| (output_texture != nullptr && open_gl->clipFreeTexture(output_texture) != kOfxStatOK)) return kOfxStatFailed;
	if (progress->progressStart(effect, "Render", "framescaper.render") != kOfxStatOK
		|| progress->progressUpdate(effect, 1) != kOfxStatOK
		|| progress->progressEnd(effect) != kOfxStatOK) return kOfxStatFailed;
	return kOfxStatOK;
}

OfxStatus entry(const char* action, const void* handle, OfxPropertySetHandle input, OfxPropertySetHandle) {
	if (action == nullptr) return kOfxStatErrValue;
	if (std::strcmp(action, kOfxActionLoad) == 0) { suites_ok = load_suites(); return suites_ok ? kOfxStatOK : kOfxStatFailed; }
	if (!suites_ok) return kOfxStatFailed;
	if (std::strcmp(action, kOfxActionDescribe) == 0) return describe(handle);
	if (std::strcmp(action, kOfxImageEffectActionDescribeInContext) == 0) return describe_context(handle, input);
	if (std::strcmp(action, kOfxActionOpenGLContextAttached) == 0) { if (open_gl_attached) return kOfxStatFailed; open_gl_attached = true; return kOfxStatOK; }
	if (std::strcmp(action, kOfxActionOpenGLContextDetached) == 0) { if (!open_gl_attached) return kOfxStatFailed; open_gl_attached = false; return kOfxStatOK; }
	if (std::strcmp(action, kOfxImageEffectActionRender) == 0) return render(handle, input);
	if (std::strcmp(action, kOfxActionUnload) == 0) { suites_ok = false; return kOfxStatOK; }
	return kOfxStatReplyDefault;
}

OfxPlugin plugin{
	kOfxImageEffectPluginApi, kOfxImageEffectPluginApiVersion,
	"org.framescaper.conformance", 1, 5, set_host, entry,
};

} // namespace

FRAMESCAPER_EXPORT OfxStatus OfxSetHost(const OfxHost* value) {
	host = const_cast<OfxHost*>(value);
	return value == nullptr ? kOfxStatFailed : kOfxStatOK;
}
FRAMESCAPER_EXPORT int OfxGetNumberOfPlugins() { return 1; }
FRAMESCAPER_EXPORT OfxPlugin* OfxGetPlugin(int index) { return index == 0 ? &plugin : nullptr; }
