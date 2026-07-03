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
