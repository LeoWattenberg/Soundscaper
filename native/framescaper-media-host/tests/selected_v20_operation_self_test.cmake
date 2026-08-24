# SPDX-License-Identifier: AGPL-3.0-only

if(NOT DEFINED HOST)
	message(FATAL_ERROR "The selected-V20 operation self-test requires the built host path.")
endif()

execute_process(
	COMMAND "${HOST}" --self-test-operation selected-v20-render
	RESULT_VARIABLE status
	OUTPUT_VARIABLE output
	ERROR_VARIABLE error
)
string(STRIP "${output}" output)
if(NOT status EQUAL 78)
	message(FATAL_ERROR "The blocked selected-V20 operation self-test returned ${status}: ${error}")
endif()
foreach(required
	"\"operation\":\"media-render\""
	"\"profile\":\"selected-v20-v7-v8\""
	"\"planVersions\":[7,8]"
	"\"exactPictureOrdinals\":true"
	"\"keyedEvaluatedRgbaExecutor\":true"
	"\"staticCompositionExecutor\":true"
	"\"maximumInFlightFrames\":1"
	"\"evaluatedRgbaInputBound\":true"
	"\"staticGeometryAdapterBound\":false"
	"\"captionDeliveryAdapterBound\":false"
	"\"stagedAudioInputBound\":true"
	"\"deliveryCodecSetAvailable\":"
	"\"frameCoreReady\":true"
	"\"ready\":false"
)
	string(FIND "${output}" "${required}" found)
	if(found EQUAL -1)
		message(FATAL_ERROR "The selected-V20 operation self-test omitted ${required}: ${output}")
	endif()
endforeach()
string(FIND "${output}" "selected-v20-runtime-incomplete" stale_incomplete)
if(NOT stale_incomplete EQUAL -1)
	message(FATAL_ERROR "The selected-V20 self-test still reports the removed blanket runtime stub: ${output}")
endif()

execute_process(
	COMMAND "${HOST}" --self-test-operation selected-v28-v14-render
	RESULT_VARIABLE v14_status
	OUTPUT_VARIABLE v14_output
	ERROR_VARIABLE v14_error
)
string(STRIP "${v14_output}" v14_output)
if(NOT v14_status EQUAL 0)
	message(FATAL_ERROR "The selected-V28/V14 operation self-test returned ${v14_status}: ${v14_error}; ${v14_output}")
endif()
foreach(required
	"\"operation\":\"media-render\""
	"\"profile\":\"selected-v28-v14-carrier\""
	"\"planVersion\":14"
	"\"rgbaFramePackVersion\":1"
	"\"exactPictureOrdinals\":true"
	"\"evaluatedRgbaExecutor\":true"
	"\"maximumInFlightFrames\":1"
	"\"stagedAudioInputBound\":true"
	"\"deliveryCodecSetAvailable\":true"
	"\"ready\":true"
)
	string(FIND "${v14_output}" "${required}" found)
	if(found EQUAL -1)
		message(FATAL_ERROR "The selected-V28/V14 self-test omitted ${required}: ${v14_output}")
	endif()
endforeach()
