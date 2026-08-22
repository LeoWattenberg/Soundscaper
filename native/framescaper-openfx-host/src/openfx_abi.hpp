/* SPDX-License-Identifier: AGPL-3.0-only */

#pragma once

/*
 * Production builds use only the headers from the digest-pinned OpenFX 1.5.1
 * source tree. The small ABI below exists solely so the repository's hostile
 * contract fixture can compile without downloading the SDK during `npm test`.
 */
#ifndef FRAMESCAPER_OPENFX_CONTRACT_ONLY
#include <ofxCore.h>
#include <ofxDialog.h>
#include <ofxDrawSuite.h>
#include <ofxGPURender.h>
#include <ofxImageEffect.h>
#include <ofxInteract.h>
#include <ofxMemory.h>
#include <ofxMessage.h>
#include <ofxMultiThread.h>
#include <ofxParam.h>
#include <ofxParametricParam.h>
#include <ofxProgress.h>
#include <ofxProperty.h>
#include <ofxTimeLine.h>
#else

#include <cstddef>

using OfxStatus = int;
using OfxTime = double;
struct OfxPropertySetStruct;
struct OfxImageEffectStruct;
struct OfxParamSetStruct;
struct OfxParamStruct;
struct OfxImageClipStruct;
struct OfxImageMemoryStruct;
struct OfxMutexStruct;
struct OfxInteractStruct;
struct OfxDrawContextStruct;
using OfxPropertySetHandle = OfxPropertySetStruct*;
using OfxImageEffectHandle = OfxImageEffectStruct*;
using OfxParamSetHandle = OfxParamSetStruct*;
using OfxParamHandle = OfxParamStruct*;
using OfxImageClipHandle = OfxImageClipStruct*;
using OfxImageMemoryHandle = OfxImageMemoryStruct*;
using OfxMutexHandle = OfxMutexStruct*;
using OfxInteractHandle = OfxInteractStruct*;
using OfxDrawContextHandle = OfxDrawContextStruct*;

struct OfxRectD { double x1; double y1; double x2; double y2; };
struct OfxRangeD { double min; double max; };
struct OfxPointD { double x; double y; };
struct OfxRGBAColourF { float r; float g; float b; float a; };
enum OfxStandardColour { kOfxStandardColourOverlayBackground = 0 };
enum OfxDrawLineStipplePattern { kOfxDrawLineStipplePatternSolid = 0 };
enum OfxDrawPrimitive { kOfxDrawPrimitiveLines = 0 };
using OfxThreadFunctionV1 = void(unsigned int, unsigned int, void*);

struct OfxHost {
	OfxPropertySetHandle host;
	const void* (*fetchSuite)(OfxPropertySetHandle, const char*, int);
};
using OfxPluginEntryPoint = OfxStatus(
	const char*, const void*, OfxPropertySetHandle, OfxPropertySetHandle
);
struct OfxPlugin {
	const char* pluginApi;
	int apiVersion;
	const char* pluginIdentifier;
	unsigned int pluginVersionMajor;
	unsigned int pluginVersionMinor;
	void (*setHost)(OfxHost*);
	OfxPluginEntryPoint* mainEntry;
};

struct OfxPropertySuiteV1 {
	OfxStatus (*propSetPointer)(OfxPropertySetHandle, const char*, int, void*);
	OfxStatus (*propSetString)(OfxPropertySetHandle, const char*, int, const char*);
	OfxStatus (*propSetDouble)(OfxPropertySetHandle, const char*, int, double);
	OfxStatus (*propSetInt)(OfxPropertySetHandle, const char*, int, int);
	OfxStatus (*propSetPointerN)(OfxPropertySetHandle, const char*, int, void* const*);
	OfxStatus (*propSetStringN)(OfxPropertySetHandle, const char*, int, const char* const*);
	OfxStatus (*propSetDoubleN)(OfxPropertySetHandle, const char*, int, const double*);
	OfxStatus (*propSetIntN)(OfxPropertySetHandle, const char*, int, const int*);
	OfxStatus (*propGetPointer)(OfxPropertySetHandle, const char*, int, void**);
	OfxStatus (*propGetString)(OfxPropertySetHandle, const char*, int, char**);
	OfxStatus (*propGetDouble)(OfxPropertySetHandle, const char*, int, double*);
	OfxStatus (*propGetInt)(OfxPropertySetHandle, const char*, int, int*);
	OfxStatus (*propGetPointerN)(OfxPropertySetHandle, const char*, int, void**);
	OfxStatus (*propGetStringN)(OfxPropertySetHandle, const char*, int, char**);
	OfxStatus (*propGetDoubleN)(OfxPropertySetHandle, const char*, int, double*);
	OfxStatus (*propGetIntN)(OfxPropertySetHandle, const char*, int, int*);
	OfxStatus (*propReset)(OfxPropertySetHandle, const char*);
	OfxStatus (*propGetDimension)(OfxPropertySetHandle, const char*, int*);
};

struct OfxImageEffectSuiteV1 {
	OfxStatus (*getPropertySet)(OfxImageEffectHandle, OfxPropertySetHandle*);
	OfxStatus (*getParamSet)(OfxImageEffectHandle, OfxParamSetHandle*);
	OfxStatus (*clipDefine)(OfxImageEffectHandle, const char*, OfxPropertySetHandle*);
	OfxStatus (*clipGetHandle)(OfxImageEffectHandle, const char*, OfxImageClipHandle*, OfxPropertySetHandle*);
	OfxStatus (*clipGetPropertySet)(OfxImageClipHandle, OfxPropertySetHandle*);
	OfxStatus (*clipGetImage)(OfxImageClipHandle, OfxTime, const OfxRectD*, OfxPropertySetHandle*);
	OfxStatus (*clipReleaseImage)(OfxPropertySetHandle);
	OfxStatus (*clipGetRegionOfDefinition)(OfxImageClipHandle, OfxTime, OfxRectD*);
	int (*abort)(OfxImageEffectHandle);
	OfxStatus (*imageMemoryAlloc)(OfxImageEffectHandle, std::size_t, OfxImageMemoryHandle*);
	OfxStatus (*imageMemoryFree)(OfxImageMemoryHandle);
	OfxStatus (*imageMemoryLock)(OfxImageMemoryHandle, void**);
	OfxStatus (*imageMemoryUnlock)(OfxImageMemoryHandle);
};

struct OfxParameterSuiteV1 {
	OfxStatus (*paramDefine)(OfxParamSetHandle, const char*, const char*, OfxPropertySetHandle*);
	OfxStatus (*paramGetHandle)(OfxParamSetHandle, const char*, OfxParamHandle*, OfxPropertySetHandle*);
	OfxStatus (*paramSetGetPropertySet)(OfxParamSetHandle, OfxPropertySetHandle*);
	OfxStatus (*paramGetPropertySet)(OfxParamHandle, OfxPropertySetHandle*);
	OfxStatus (*paramGetValue)(OfxParamHandle, ...);
	OfxStatus (*paramGetValueAtTime)(OfxParamHandle, OfxTime, ...);
	OfxStatus (*paramGetDerivative)(OfxParamHandle, OfxTime, ...);
	OfxStatus (*paramGetIntegral)(OfxParamHandle, OfxTime, OfxTime, ...);
	OfxStatus (*paramSetValue)(OfxParamHandle, ...);
	OfxStatus (*paramSetValueAtTime)(OfxParamHandle, OfxTime, ...);
	OfxStatus (*paramGetNumKeys)(OfxParamHandle, unsigned int*);
	OfxStatus (*paramGetKeyTime)(OfxParamHandle, unsigned int, OfxTime*);
	OfxStatus (*paramGetKeyIndex)(OfxParamHandle, OfxTime, int, int*);
	OfxStatus (*paramDeleteKey)(OfxParamHandle, OfxTime);
	OfxStatus (*paramDeleteAllKeys)(OfxParamHandle);
	OfxStatus (*paramCopy)(OfxParamHandle, OfxParamHandle, OfxTime, const OfxRangeD*);
	OfxStatus (*paramEditBegin)(OfxParamSetHandle, const char*);
	OfxStatus (*paramEditEnd)(OfxParamSetHandle);
};

struct OfxMemorySuiteV1 {
	OfxStatus (*memoryAlloc)(void*, std::size_t, void**);
	OfxStatus (*memoryFree)(void*);
};
struct OfxMultiThreadSuiteV1 {
	OfxStatus (*multiThread)(OfxThreadFunctionV1*, unsigned int, void*);
	OfxStatus (*multiThreadNumCPUs)(unsigned int*);
	OfxStatus (*multiThreadIndex)(unsigned int*);
	int (*multiThreadIsSpawnedThread)();
	OfxStatus (*mutexCreate)(OfxMutexHandle*, int);
	OfxStatus (*mutexDestroy)(OfxMutexHandle);
	OfxStatus (*mutexLock)(OfxMutexHandle);
	OfxStatus (*mutexUnLock)(OfxMutexHandle);
	OfxStatus (*mutexTryLock)(OfxMutexHandle);
};
struct OfxMessageSuiteV1 { OfxStatus (*message)(void*, const char*, const char*, const char*, ...); };
struct OfxMessageSuiteV2 {
	OfxStatus (*message)(void*, const char*, const char*, const char*, ...);
	OfxStatus (*setPersistentMessage)(void*, const char*, const char*, const char*, ...);
	OfxStatus (*clearPersistentMessage)(void*);
};
struct OfxProgressSuiteV1 {
	OfxStatus (*progressStart)(void*, const char*);
	OfxStatus (*progressUpdate)(void*, double);
	OfxStatus (*progressEnd)(void*);
};
struct OfxProgressSuiteV2 {
	OfxStatus (*progressStart)(void*, const char*, const char*);
	OfxStatus (*progressUpdate)(void*, double);
	OfxStatus (*progressEnd)(void*);
};
struct OfxTimeLineSuiteV1 {
	OfxStatus (*getTime)(void*, double*);
	OfxStatus (*gotoTime)(void*, double);
	OfxStatus (*getTimeBounds)(void*, double*, double*);
};
struct OfxInteractSuiteV1 {
	OfxStatus (*interactSwapBuffers)(OfxInteractHandle);
	OfxStatus (*interactRedraw)(OfxInteractHandle);
	OfxStatus (*interactGetPropertySet)(OfxInteractHandle, OfxPropertySetHandle*);
};
struct OfxDrawSuiteV1 {
	OfxStatus (*getColour)(OfxDrawContextHandle, OfxStandardColour, OfxRGBAColourF*);
	OfxStatus (*setColour)(OfxDrawContextHandle, const OfxRGBAColourF*);
	OfxStatus (*setLineWidth)(OfxDrawContextHandle, float);
	OfxStatus (*setLineStipple)(OfxDrawContextHandle, OfxDrawLineStipplePattern);
	OfxStatus (*draw)(OfxDrawContextHandle, OfxDrawPrimitive, const OfxPointD*, int);
	OfxStatus (*drawText)(OfxDrawContextHandle, const char*, const OfxPointD*, int);
};
struct OfxDialogSuiteV1 {
	OfxStatus (*RequestDialog)(void*);
	OfxStatus (*NotifyRedrawPending)();
};
struct OfxParametricParameterSuiteV1 {
	OfxStatus (*parametricParamGetValue)(OfxParamHandle, int, OfxTime, double, double*);
	OfxStatus (*parametricParamGetNControlPoints)(OfxParamHandle, int, double, int*);
	OfxStatus (*parametricParamGetNthControlPoint)(OfxParamHandle, int, double, int, double*, double*);
	OfxStatus (*parametricParamSetNthControlPoint)(OfxParamHandle, int, double, int, double, double, bool);
	OfxStatus (*parametricParamAddControlPoint)(OfxParamHandle, int, double, double, double, bool);
	OfxStatus (*parametricParamDeleteControlPoint)(OfxParamHandle, int, int);
	OfxStatus (*parametricParamDeleteAllControlPoints)(OfxParamHandle, int);
};

#define kOfxStatOK 0
#define kOfxStatFailed 1
#define kOfxStatErrFatal 2
#define kOfxStatErrUnknown 3
#define kOfxStatErrMissingHostFeature 4
#define kOfxStatErrUnsupported 5
#define kOfxStatErrExists 6
#define kOfxStatErrMemory 8
#define kOfxStatErrBadHandle 9
#define kOfxStatErrBadIndex 10
#define kOfxStatErrValue 11
#define kOfxStatReplyDefault 14
#define kOfxImageEffectPluginApi "OfxImageEffectPluginAPI"
#define kOfxImageEffectPluginApiVersion 1
#define kOfxPropertySuite "OfxPropertySuite"
#define kOfxImageEffectSuite "OfxImageEffectSuite"
#define kOfxParameterSuite "OfxParameterSuite"
#define kOfxMemorySuite "OfxMemorySuite"
#define kOfxMultiThreadSuite "OfxMultiThreadSuite"
#define kOfxMessageSuite "OfxMessageSuite"
#define kOfxProgressSuite "OfxProgressSuite"
#define kOfxTimeLineSuite "OfxTimeLineSuite"
#define kOfxDialogSuite "OfxDialogSuite"
#define kOfxInteractSuite "OfxInteractSuite"
#define kOfxDrawSuite "OfxDrawSuite"
#define kOfxParametricParameterSuite "OfxParametricParameterSuite"
#define kOfxActionLoad "OfxActionLoad"
#define kOfxActionUnload "OfxActionUnload"
#define kOfxActionDescribe "OfxActionDescribe"
#define kOfxActionCreateInstance "OfxActionCreateInstance"
#define kOfxActionDestroyInstance "OfxActionDestroyInstance"
#define kOfxActionBeginInstanceChanged "OfxActionBeginInstanceChanged"
#define kOfxActionInstanceChanged "OfxActionInstanceChanged"
#define kOfxActionEndInstanceChanged "OfxActionEndInstanceChanged"
#define kOfxActionSyncPrivateData "OfxActionSyncPrivateData"
#define kOfxActionPurgeCaches "OfxActionPurgeCaches"
#define kOfxInteractActionDraw "OfxInteractActionDraw"
#define kOfxImageEffectActionDescribeInContext "OfxImageEffectActionDescribeInContext"
#define kOfxImageEffectActionGetRegionOfDefinition "OfxImageEffectActionGetRegionOfDefinition"
#define kOfxImageEffectActionGetRegionsOfInterest "OfxImageEffectActionGetRegionsOfInterest"
#define kOfxImageEffectActionGetFramesNeeded "OfxImageEffectActionGetFramesNeeded"
#define kOfxImageEffectActionGetTimeDomain "OfxImageEffectActionGetTimeDomain"
#define kOfxImageEffectActionIsIdentity "OfxImageEffectActionIsIdentity"
#define kOfxImageEffectActionBeginSequenceRender "OfxImageEffectActionBeginSequenceRender"
#define kOfxImageEffectActionRender "OfxImageEffectActionRender"
#define kOfxImageEffectActionEndSequenceRender "OfxImageEffectActionEndSequenceRender"
#define kOfxImageEffectContextGenerator "OfxImageEffectContextGenerator"
#define kOfxImageEffectContextFilter "OfxImageEffectContextFilter"
#define kOfxImageEffectContextTransition "OfxImageEffectContextTransition"
#define kOfxImageEffectContextPaint "OfxImageEffectContextPaint"
#define kOfxImageEffectContextRetimer "OfxImageEffectContextRetimer"
#define kOfxImageEffectContextGeneral "OfxImageEffectContextGeneral"
#define kOfxImageEffectPropContext "OfxImageEffectPropContext"
#define kOfxImageEffectPropSupportedContexts "OfxImageEffectPropSupportedContexts"
#define kOfxImageEffectPropSupportedPixelDepths "OfxImageEffectPropSupportedPixelDepths"
#define kOfxImageEffectPropSupportedComponents "OfxImageEffectPropSupportedComponents"
#define kOfxImageEffectPluginPropOverlayInteractV2 "OfxImageEffectPluginPropOverlayInteractV2"
#define kOfxInteractPropDrawContext "OfxInteractPropDrawContext"
#define kOfxPropEffectInstance "OfxPropEffectInstance"
#define kOfxPropTime "OfxPropTime"
#define kOfxImageEffectPropRenderScale "OfxImageEffectPropRenderScale"
#define kOfxImageEffectPropRenderWindow "OfxImageEffectPropRenderWindow"
#define kOfxImagePropData "OfxImagePropData"
#define kOfxImagePropBounds "OfxImagePropBounds"
#define kOfxImagePropRowBytes "OfxImagePropRowBytes"
#define kOfxImageEffectPropComponents "OfxImageEffectPropComponents"
#define kOfxImageEffectPropPixelDepth "OfxImageEffectPropPixelDepth"
#define kOfxImageComponentRGBA "OfxImageComponentRGBA"
#define kOfxImageComponentRGB "OfxImageComponentRGB"
#define kOfxImageComponentAlpha "OfxImageComponentAlpha"
#define kOfxBitDepthByte "OfxBitDepthByte"
#define kOfxBitDepthShort "OfxBitDepthShort"
#define kOfxBitDepthFloat "OfxBitDepthFloat"
#define kOfxImageEffectPluginRenderThreadSafety "OfxImageEffectPluginRenderThreadSafety"
#define kOfxImageEffectRenderUnsafe "OfxImageEffectRenderUnsafe"
#define kOfxImageEffectRenderInstanceSafe "OfxImageEffectRenderInstanceSafe"
#define kOfxImageEffectRenderFullySafe "OfxImageEffectRenderFullySafe"
#define kOfxParamPropAnimates "OfxParamPropAnimates"
#define kOfxParamTypeInteger "OfxParamTypeInteger"
#define kOfxParamTypeInteger2D "OfxParamTypeInteger2D"
#define kOfxParamTypeInteger3D "OfxParamTypeInteger3D"
#define kOfxParamTypeDouble "OfxParamTypeDouble"
#define kOfxParamTypeDouble2D "OfxParamTypeDouble2D"
#define kOfxParamTypeDouble3D "OfxParamTypeDouble3D"
#define kOfxParamTypeRGB "OfxParamTypeRGB"
#define kOfxParamTypeRGBA "OfxParamTypeRGBA"
#define kOfxParamTypeBoolean "OfxParamTypeBoolean"
#define kOfxParamTypeChoice "OfxParamTypeChoice"
#define kOfxParamTypeString "OfxParamTypeString"
#define kOfxParamTypeCustom "OfxParamTypeCustom"
#define kOfxParamTypeGroup "OfxParamTypeGroup"
#define kOfxParamTypePage "OfxParamTypePage"
#define kOfxParamTypePushButton "OfxParamTypePushButton"
#define kOfxParamTypeParametric "OfxParamTypeParametric"

#endif
