Pod::Spec.new do |s|
  s.name           = 'KanafSpeech'
  s.version        = '1.0.0'
  s.summary        = 'Kanaf local Expo module: live transcription with the iOS 26 SpeechAnalyzer'
  s.description    = 'Captures the microphone and feeds SpeechAnalyzer, as the SwiftUI app did. See docs/port-notes/A3.md.'
  s.license        = { :type => 'MIT' }
  s.author         = 'Kanaf'
  s.homepage       = 'https://github.com/omercnet/openefb'
  s.platforms      = { :ios => '16.4' }
  # Swift 5 language mode: the module compiles against SDK concurrency annotations without strict checking.
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = '**/*.{h,m,swift}'
end
