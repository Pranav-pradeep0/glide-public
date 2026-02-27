Pod::Spec.new do |s|
  s.name         = "glide-vlc-player"
  s.version      = "1.0.38"
  s.summary      = "Glide VLC player"
  s.requires_arc = true
  s.author       = { 'Glide Team' => 'team@glide.local' }
  s.license      = 'MIT'
  s.homepage     = 'https://glide.local'
  s.source       = { :path => '.' }
  s.source_files = 'ios/RCTVLCPlayer/*'
  s.ios.deployment_target = "8.4"
  s.tvos.deployment_target = "10.2"
  s.static_framework = true
  s.dependency 'React'
  s.ios.dependency 'MobileVLCKit', '3.5.1'
  s.tvos.dependency 'TVVLCKit', '3.5.1'
end
