# SPDX-License-Identifier: AGPL-3.0-only

cmake_minimum_required(VERSION 3.25)
project(soundscaper_professional_host VERSION 1.0.0 LANGUAGES C CXX)

if(APPLE)
	enable_language(OBJCXX)
	if(CMAKE_OSX_ARCHITECTURES AND NOT CMAKE_OSX_ARCHITECTURES STREQUAL "arm64")
		message(FATAL_ERROR "Soundscaper supports only arm64 professional builds on macOS")
	endif()
endif()

foreach(required SOUNDSCAPER_JUCE_ROOT SOUNDSCAPER_CLAP_ROOT SOUNDSCAPER_VST3_PROVENANCE_COMMIT)
	if(NOT DEFINED ${required} OR "${${required}}" STREQUAL "")
		message(FATAL_ERROR "${required} is required by the authenticated build recipe")
	endif()
endforeach()
if(NOT DEFINED SOUNDSCAPER_NODE_API_INCLUDE OR NOT EXISTS "${SOUNDSCAPER_NODE_API_INCLUDE}/node_api.h")
	message(FATAL_ERROR "SOUNDSCAPER_NODE_API_INCLUDE must name the authenticated Electron Node-API headers")
endif()
if(NOT EXISTS "${SOUNDSCAPER_JUCE_ROOT}/CMakeLists.txt")
	message(FATAL_ERROR "SOUNDSCAPER_JUCE_ROOT is not an extracted JUCE source tree")
endif()
if(NOT EXISTS "${SOUNDSCAPER_JUCE_ROOT}/modules/juce_audio_processors/format_types/VST3_SDK")
	message(FATAL_ERROR "JUCE's embedded VST3 SDK closure is absent")
endif()
if(NOT EXISTS "${SOUNDSCAPER_CLAP_ROOT}/include/clap/clap.h")
	message(FATAL_ERROR "SOUNDSCAPER_CLAP_ROOT is not the direct CLAP ABI tree")
endif()

add_subdirectory("${SOUNDSCAPER_JUCE_ROOT}" "${CMAKE_CURRENT_BINARY_DIR}/juce" EXCLUDE_FROM_ALL)

add_library(soundscaper_professional_audio STATIC
	src/juce_audio_adapter.cpp src/os_aac_m4a_profile.cpp src/os_mp3_profile.cpp
	src/professional_host.cpp
)
add_library(soundscaper_professional_plugin STATIC
	src/direct_clap_adapter.cpp src/juce_message_dispatcher.cpp
	src/juce_plugin_adapter.cpp src/professional_host.cpp
)
foreach(core soundscaper_professional_audio soundscaper_professional_plugin)
	target_compile_features(${core} PRIVATE cxx_std_20)
	target_include_directories(${core} PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/src")
	target_compile_definitions(${core} PRIVATE
		SOUNDSCAPER_PRO_BUILD=1
		JUCE_DISPLAY_SPLASH_SCREEN=0
		JUCE_REPORT_APP_USAGE=0
		JUCE_MODAL_LOOPS_PERMITTED=0
	)
	target_link_libraries(${core} PRIVATE
		juce::juce_recommended_config_flags
		juce::juce_recommended_lto_flags
		juce::juce_recommended_warning_flags
	)
	set_target_properties(${core} PROPERTIES
		POSITION_INDEPENDENT_CODE YES
		CXX_VISIBILITY_PRESET hidden
		VISIBILITY_INLINES_HIDDEN YES
		WINDOWS_EXPORT_ALL_SYMBOLS YES
	)
endforeach()
target_compile_definitions(soundscaper_professional_audio PRIVATE SOUNDSCAPER_PRO_AUDIO_ONLY=1)
target_link_libraries(soundscaper_professional_audio PRIVATE juce::juce_audio_devices)
target_include_directories(soundscaper_professional_plugin PRIVATE "${SOUNDSCAPER_CLAP_ROOT}/include")
target_compile_definitions(soundscaper_professional_plugin PRIVATE
	SOUNDSCAPER_PRO_PLUGIN_ONLY=1
	JUCE_PLUGINHOST_VST3=1
	SOUNDSCAPER_VST3_PROVENANCE_COMMIT="${SOUNDSCAPER_VST3_PROVENANCE_COMMIT}"
)
target_link_libraries(soundscaper_professional_plugin PRIVATE
	juce::juce_audio_processors juce::juce_gui_extra
)

if(APPLE)
	target_sources(soundscaper_professional_audio PRIVATE src/os_audio_codec_mac.mm)
	target_link_libraries(soundscaper_professional_audio PRIVATE
		"-framework AudioToolbox" "-framework CoreFoundation")
	target_compile_definitions(soundscaper_professional_audio PRIVATE
		JUCE_ASIO=0 SOUNDSCAPER_COREAUDIO_STREAMING=1)
	target_compile_definitions(soundscaper_professional_plugin PRIVATE
		JUCE_PLUGINHOST_AU=1 JUCE_PLUGINHOST_LV2=0 JUCE_ASIO=0)
elseif(WIN32)
	target_sources(soundscaper_professional_audio PRIVATE
		src/os_audio_codec_windows.cpp src/os_mp3_encode_windows.cpp)
	target_link_libraries(soundscaper_professional_audio PRIVATE
		mfplat mfreadwrite mfuuid ole32)
	if(NOT DEFINED SOUNDSCAPER_ASIO_ROOT OR NOT EXISTS "${SOUNDSCAPER_ASIO_ROOT}/common/asio.h")
		message(FATAL_ERROR "Windows builds require the authenticated ASIO SDK 2.3.4 tree")
	endif()
	target_include_directories(soundscaper_professional_audio PRIVATE
		"${SOUNDSCAPER_ASIO_ROOT}/common"
		"${SOUNDSCAPER_ASIO_ROOT}/host"
	)
	target_compile_definitions(soundscaper_professional_audio PRIVATE
		JUCE_ASIO=1 SOUNDSCAPER_WASAPI_STREAMING=1 SOUNDSCAPER_ASIO_STREAMING=1)
	target_compile_definitions(soundscaper_professional_plugin PRIVATE
		JUCE_PLUGINHOST_AU=0 JUCE_PLUGINHOST_LV2=0 JUCE_ASIO=0)
else()
	target_sources(soundscaper_professional_audio PRIVATE src/os_audio_codec_unavailable.cpp)
	if(NOT DEFINED SOUNDSCAPER_LV2_ROOT OR NOT EXISTS "${SOUNDSCAPER_LV2_ROOT}/lv2")
		message(FATAL_ERROR "Linux builds require the authenticated LV2 1.18.10 headers")
	endif()
	target_include_directories(soundscaper_professional_plugin PRIVATE "${SOUNDSCAPER_LV2_ROOT}")
	target_compile_definitions(soundscaper_professional_plugin PRIVATE
		JUCE_PLUGINHOST_AU=0 JUCE_PLUGINHOST_LV2=1 JUCE_ASIO=0)
	target_compile_definitions(soundscaper_professional_audio PRIVATE
		JUCE_ASIO=0 SOUNDSCAPER_ALSA_STREAMING=1
		SOUNDSCAPER_PIPEWIRE_SYSTEM_ABI_ADAPTER=1 SOUNDSCAPER_JACK_DISCOVERY_ONLY=1)
	target_link_libraries(soundscaper_professional_plugin PRIVATE ${CMAKE_DL_LIBS})
	target_sources(soundscaper_professional_audio PRIVATE
		../soundscaper-helper-addon/src/audio_backends.c
		../soundscaper-helper-addon/src/audio_device.c
		../soundscaper-helper-addon/src/audio_ring.c
		../soundscaper-helper-addon/src/audio_session.c
		../soundscaper-helper-addon/src/pipewire_session.c
	)
	target_include_directories(soundscaper_professional_audio PRIVATE
		../soundscaper-helper-addon/src
		../../vendor/pipewire-headers/pipewire-0.3
		../../vendor/pipewire-headers/spa-0.2
	)
endif()

include(CTest)
if(BUILD_TESTING)
	add_executable(soundscaper_os_mp3_profile_self_test
		src/os_mp3_profile.cpp tests/os_mp3_profile_self_test.cpp)
	target_compile_features(soundscaper_os_mp3_profile_self_test PRIVATE cxx_std_20)
	target_include_directories(soundscaper_os_mp3_profile_self_test PRIVATE
		"${CMAKE_CURRENT_SOURCE_DIR}/src")
	add_test(NAME soundscaper_os_mp3_profile_self_test
		COMMAND soundscaper_os_mp3_profile_self_test)
endif()
if(BUILD_TESTING AND (APPLE OR WIN32))
	add_executable(soundscaper_os_audio_codec_self_test tests/os_audio_codec_self_test.cpp)
	target_compile_features(soundscaper_os_audio_codec_self_test PRIVATE cxx_std_20)
	target_include_directories(soundscaper_os_audio_codec_self_test PRIVATE
		"${CMAKE_CURRENT_SOURCE_DIR}/src")
	target_link_libraries(soundscaper_os_audio_codec_self_test PRIVATE
		soundscaper_professional_audio)
	add_test(NAME soundscaper_os_audio_codec_self_test
		COMMAND soundscaper_os_audio_codec_self_test)
endif()

# The utility process loads only this trusted-audio Node-API module. It cannot
# link, scan, instantiate, or execute third-party plug-in code.
add_library(soundscaper_professional_node MODULE src/node_api_bridge.cpp)
target_compile_features(soundscaper_professional_node PRIVATE cxx_std_20)
target_include_directories(soundscaper_professional_node PRIVATE
	"${SOUNDSCAPER_NODE_API_INCLUDE}"
	"${CMAKE_CURRENT_SOURCE_DIR}/src"
)
target_compile_definitions(soundscaper_professional_node PRIVATE NAPI_VERSION=8)
target_link_libraries(soundscaper_professional_node PRIVATE soundscaper_professional_audio)
set_target_properties(soundscaper_professional_node PROPERTIES
	PREFIX ""
	OUTPUT_NAME "soundscaper_professional"
	SUFFIX ".node"
)
install(TARGETS soundscaper_professional_node
	LIBRARY DESTINATION .
	RUNTIME DESTINATION .
)

# Third-party plug-ins are never loaded by the Electron utility-process addon.
# The reviewed launcher executes this persistent framed peer as the exact
# third-party-native child and the utility only proxies bounded RPC frames.
add_executable(soundscaper_professional_peer src/professional_host_peer.cpp)
target_compile_features(soundscaper_professional_peer PRIVATE cxx_std_20)
target_link_libraries(soundscaper_professional_peer PRIVATE soundscaper_professional_plugin)
if(UNIX AND NOT APPLE)
	set_target_properties(soundscaper_professional_peer PROPERTIES
		BUILD_RPATH "\$ORIGIN/runtime"
		INSTALL_RPATH "\$ORIGIN/runtime"
	)
endif()
set_target_properties(soundscaper_professional_peer PROPERTIES
	OUTPUT_NAME "soundscaper_professional_peer"
)
install(TARGETS soundscaper_professional_peer RUNTIME DESTINATION .)
