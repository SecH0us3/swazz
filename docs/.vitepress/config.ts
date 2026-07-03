import { defineConfig } from 'vitepress'

export default defineConfig({
  title: "Swazz Docs",
  description: "Smart API Fuzzer — find crashes before your users do",
  base: '/swazz/',
  themeConfig: {
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Guide', link: '/installation' },
      { text: 'Usage', link: '/usage' },
      { text: 'Recipes', link: '/recipes' }
    ],
    sidebar: [
      {
        text: 'Getting Started',
        items: [
          { text: 'Installation 🛠', link: '/installation' },
          { text: 'Basic Usage 🧭', link: '/usage' },
          { text: 'Docker Guide 🐳', link: '/docker_images' }
        ]
      },
      {
        text: 'Actionable Recipes 🍳',
        items: [
          { text: 'Recipes & Cookbooks', link: '/recipes' }
        ]
      },
      {
        text: 'Core Guides & Integrations',
        items: [
          { text: 'Deployment & Production 🚀', link: '/deployment' },
          { text: 'CI/CD Pipelines ⚡️', link: '/ci_cd' },
          { text: 'AI Auto-Fix & Remediation 🤖', link: '/ai_remediation' },
          { text: 'DefectDojo Integration 🛡', link: '/defectdojo' }
        ]
      },
      {
        text: 'Scaling & Architecture',
        items: [
          { text: 'Architecture & Internals 🏛', link: '/architecture' },
          { text: 'Cloudflare Queues 📯', link: '/queues' },
          { text: 'Sharding Scans 📊', link: '/sharding' },
          { text: 'Runner Sandboxing 🔒', link: '/runner_sandboxing_guide' }
        ]
      },
      {
        text: 'Security & Research',
        items: [
          { text: 'Security Review 🛡', link: '/security_review' },
          { text: 'Runner Security Audit 🔍', link: '/runner_security_audit' },
          { text: 'KV Caching Research 💾', link: '/cloudflare_kv_cache_research' },
          { text: 'Logging & Analytics 📈', link: '/logging' }
        ]
      },
      {
        text: 'Contributing',
        items: [
          { text: 'Contributing Guidelines 🤝', link: '/contributing' }
        ]
      }
    ],
    search: {
      provider: 'local'
    },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/SecH0us3/swazz' }
    ],
    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2026 SecH0us3'
    }
  }
})
