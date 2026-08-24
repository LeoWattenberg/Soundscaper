# SPDX-License-Identifier: AGPL-3.0-only
cmake_minimum_required(VERSION 3.28)
project(framescaper_media_host VERSION 1.0.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

find_package(Boost 1.92.0 EXACT REQUIRED)
find_package(PkgConfig REQUIRED)
pkg_check_modules(FFMPEG_901 REQUIRED IMPORTED_TARGET
	libavcodec=63.1.100
	libavfilter=12.1.100
	libavformat=63.1.100
	libavutil=61.1.100
	libswresample=7.1.100
	libswscale=10.1.100
)

add_executable(framescaper-media-host
	src/media_host.cpp
	src/media_host_arguments.cpp
	src/ffmpeg_decode_session.cpp
	src/ffmpeg_hardware_encode.cpp
	src/ffmpeg_media_engine.cpp
	src/ffmpeg_image_sequence_decode.cpp
	src/ffmpeg_professional_sequence_encode.cpp
	src/ffmpeg_selected_v20_adapter.cpp
	src/ffmpeg_selected_v20_render.cpp
	src/ffmpeg_simple_render.cpp
	src/image_sequence_pack.cpp
	src/legacy_plan_semantics.cpp
	src/legacy_plan_v8_filter_semantics.cpp
	src/media_file_grants.cpp
	src/media_plan.cpp
	src/professional_source_probe.cpp
	src/sha256.cpp
	src/selected_v20_frame_executor.cpp
	src/selected_v20_frame_pack.cpp
	src/selected_v20_plan_capture.cpp
	src/strict_json.cpp
)
target_link_libraries(framescaper-media-host PRIVATE Boost::headers PkgConfig::FFMPEG_901)
target_compile_definitions(framescaper-media-host PRIVATE
	FRAMESCAPER_MEDIA_HOST_VERSION="1.0.0"
	FRAMESCAPER_FFMPEG_VERSION="9.0.1"
)

if(MSVC)
	target_compile_options(framescaper-media-host PRIVATE /W4 /WX /permissive- /Brepro)
	set_property(TARGET framescaper-media-host PROPERTY MSVC_RUNTIME_LIBRARY "MultiThreaded")
else()
	target_compile_options(framescaper-media-host PRIVATE
		-Wall -Wextra -Wpedantic -Werror
		-ffile-prefix-map=${CMAKE_SOURCE_DIR}=.
		-fdebug-prefix-map=${CMAKE_SOURCE_DIR}=.
		-fno-ident
	)
	if(APPLE)
		target_link_options(framescaper-media-host PRIVATE -Wl,-no_uuid)
	else()
		target_link_options(framescaper-media-host PRIVATE -Wl,--build-id=none)
	endif()
endif()

include(CTest)
if(BUILD_TESTING)
	add_executable(framescaper-exact-retime-ordinal-test
		tests/exact_retime_ordinal_fixture.cpp
	)
	target_include_directories(framescaper-exact-retime-ordinal-test PRIVATE src)
	target_link_libraries(framescaper-exact-retime-ordinal-test PRIVATE Boost::headers)
	if(MSVC)
		target_compile_options(framescaper-exact-retime-ordinal-test PRIVATE /W4 /WX /permissive-)
	else()
		target_compile_options(framescaper-exact-retime-ordinal-test PRIVATE
			-Wall -Wextra -Wpedantic -Werror
		)
	endif()
	add_test(
		NAME framescaper-exact-retime-ordinal-test
		COMMAND framescaper-exact-retime-ordinal-test
	)
	add_executable(framescaper-selected-v20-frame-executor-test
		tests/selected_v20_frame_executor_fixture.cpp
		src/selected_v20_frame_executor.cpp
		src/selected_v20_frame_pack.cpp
		src/selected_v20_plan_capture.cpp
		src/strict_json.cpp
	)
	target_include_directories(framescaper-selected-v20-frame-executor-test PRIVATE src)
	target_link_libraries(framescaper-selected-v20-frame-executor-test PRIVATE Boost::headers)
	if(MSVC)
		target_compile_options(framescaper-selected-v20-frame-executor-test PRIVATE /W4 /WX /permissive-)
	else()
		target_compile_options(framescaper-selected-v20-frame-executor-test PRIVATE
			-Wall -Wextra -Wpedantic -Werror
		)
	endif()
	add_test(
		NAME framescaper-selected-v20-frame-executor-test
		COMMAND framescaper-selected-v20-frame-executor-test
	)
	add_executable(framescaper-selected-v20-v8-visual-semantics-test
		tests/selected_v20_v8_visual_semantics_fixture.cpp
		src/legacy_plan_v8_filter_semantics.cpp
		src/strict_json.cpp
	)
	target_include_directories(framescaper-selected-v20-v8-visual-semantics-test PRIVATE src)
	if(MSVC)
		target_compile_options(framescaper-selected-v20-v8-visual-semantics-test PRIVATE /W4 /WX /permissive-)
	else()
		target_compile_options(framescaper-selected-v20-v8-visual-semantics-test PRIVATE
			-Wall -Wextra -Wpedantic -Werror
		)
	endif()
	add_test(
		NAME framescaper-selected-v20-v8-visual-semantics-test
		COMMAND framescaper-selected-v20-v8-visual-semantics-test
	)
	add_executable(framescaper-professional-source-probe-test
		tests/professional_source_probe_fixture.cpp
		src/professional_source_probe.cpp
	)
	target_include_directories(framescaper-professional-source-probe-test PRIVATE src)
	target_link_libraries(framescaper-professional-source-probe-test PRIVATE PkgConfig::FFMPEG_901)
	if(MSVC)
		target_compile_options(framescaper-professional-source-probe-test PRIVATE /W4 /WX /permissive-)
	else()
		target_compile_options(framescaper-professional-source-probe-test PRIVATE
			-Wall -Wextra -Wpedantic -Werror
		)
	endif()
	add_test(
		NAME framescaper-professional-source-probe-test
		COMMAND framescaper-professional-source-probe-test
	)
	add_test(
		NAME framescaper-selected-v20-operation-self-test
		COMMAND ${CMAKE_COMMAND}
			-DHOST=$<TARGET_FILE:framescaper-media-host>
			-P ${CMAKE_CURRENT_SOURCE_DIR}/tests/selected_v20_operation_self_test.cmake
	)
endif()

install(TARGETS framescaper-media-host RUNTIME DESTINATION bin)
