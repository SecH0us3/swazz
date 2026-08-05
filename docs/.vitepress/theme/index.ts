// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import DefaultTheme from 'vitepress/theme'
import { h } from 'vue'
import './custom.css'

export default {
  extends: DefaultTheme,
  Layout() {
    return h(DefaultTheme.Layout, null, {
      'home-hero-image': () => h('video', {
        src: '/swazz/assets/swazz_demo.webm',
        class: 'docs-video-element',
        controls: true,
        autoplay: true,
        muted: true,
        loop: true,
        playsinline: true
      })
    })
  }
}
