# Swazz Web Ecosystem - Design System
**Theme:** "Future-Proof Security" (Enterprise Future, Obsidian, Steel Blue, Glassmorphism)

## 1. Global Design System (CSS Variables)

### Colors (Dark Theme - Default)
- `--bg-obsidian`: `#0B0F1A` (Deep Navy-Black)
- `--bg-card`: `rgba(30, 41, 59, 0.5)` with `backdrop-filter: blur(12px)`
- `--border-subtle`: `rgba(255, 255, 255, 0.08)`
- `--primary-blue`: `#0066FF` (Vibrant but professional)
- `--text-main`: `#FFFFFF`
- `--text-muted`: `#94A3B8` (Slate Grey)

### Colors (Light Theme)
- `--bg-light`: `#F8FAFC`
- `--bg-card-light`: `#FFFFFF`
- `--text-main-light`: `#0F172A`
- `--accent-steel`: `#475569`

### Semantic Colors
- `--status-critical`: `#EF4444` (Crimson)
- `--status-high`: `#F59E0B` (Amber)
- `--status-medium`: `#3B82F6` (Blue)
- `--status-success`: `#10B981` (Emerald)

### Typography
- **Primary:** `Inter` (Sans-serif) - used for UI/Headings.
- **Technical:** `JetBrains Mono` - used for API endpoints, logs, and code snippets.

## 2. Screens Overview

### Screen 1: Landing Page (Desktop Web)
- **Layout:** Full-width, high-contrast dark theme.
- **Hero Section:**
  - Background: Subtle 40px dark grid pattern over a deep navy radial gradient.
  - Headline: "The Future of API Resilience" (H1, 72px, Bold, tracking -0.02em).
  - CTA Group: Primary button "Request Demo" (Solid Blue), Secondary "Start Free Scan" (Ghost/Outline).
  - Visual Element: A clean, abstract 3D schematic of an API mesh being protected by a crystalline shield (minimalist light refraction).
- **Trust Bar:** Monochrome logos of partners/clients at 40% opacity.
- **Feature Grid:** 3-column layout using glassmorphism cards. Each card has a 1px border and a subtle hover lift effect.

### Screen 2 & 3: Application Dashboard (Light & Dark)
- **Architecture:** Fixed Left Sidebar (240px) + Fluid Main Content Area.
- **Sidebar:** Deep Navy background in both themes. Icons are monochrome (Lucide-react style). Sections: Dashboard, Scans, Endpoints, Team, Settings.
- **Top Bar:** Search input (minimalist), Notification bell, and User profile (Avatar + Name).
- **Main Content Grid:**
  - **Row 1 (Stats):** 4 small cards showing "Total Scans", "Critical Findings", "API Coverage %", and "Active Alerts".
  - **Row 2 (Main Chart):** Large line chart "Vulnerability Trend over 30 days" with professional, thin lines and data points.
  - **Row 3 (Vulnerability Feed):** A data table for "Latest Findings". Columns: Severity (Badge), Endpoint (Mono font), Vulnerability Type, Time detected.
- **Theme Toggle:** A subtle sun/moon switch in the sidebar.

## 3. Motion Design & Micro-Interactions (Future-Security Feel)
- **Global Transition:** All interactive elements (buttons, cards, links) must have `transition: all 0.4s cubic-bezier(0.23, 1, 0.32, 1)`.
- **Theme Switcher (The "Aha" Moment):**
  - Transition between Light and Dark mode must be a radial expand effect (starting from the toggle button) rather than a simple fade.
  - Duration: 0.6s. All colors should interpolate smoothly.
- **Hero Section Animation (Landing):**
  - The "Crystalline Shield" visual should have a very slow, subtle floating motion (Y-axis +/- 10px, 8s duration).
  - Headline and CTA should have a staggered "Reveal" animation (Slide up 20px + Fade in) on page load.
- **Dashboard Interactions:**
  - **Data Entry:** When a new scan result appears in the "Latest Findings" table, use a "Flash" highlight effect (`#0066FF` at 10% opacity) that fades out over 2s.
  - **Hover Cards:** Cards should lift by 4px and increase their border-color opacity from 0.08 to 0.2.
  - **Chart Animation:** Use framer-motion or Recharts built-in animation. Lines should "draw" themselves from left to right over 1.5s on mount.
  - **Loading States (Skeletons):** Use a "Shimmer" effect with a linear gradient moving from left to right at a 45-degree angle.

## 4. Technical Requirements for Code Generation
- **Framework:** React with Tailwind CSS.
- **Responsiveness:** Optimize for 1440px desktop. Ensure the sidebar collapses for smaller screens (though mobile is not primary).
- **Components:** Use Headless UI or Radix UI for accessible dropdowns and modals.
- **Charts:** Use Recharts or Chart.js with customized colors from the global palette.

## 5. JSON Data Mockup (For Live Prototyping)
```json
{
  "scans": [
    {"id": "SZ-901", "endpoint": "/api/v1/auth/login", "severity": "Critical", "type": "SQL Injection", "status": "Open"},
    {"id": "SZ-902", "endpoint": "/api/v2/user/profile", "severity": "High", "type": "Broken Object Level Auth", "status": "In Progress"},
    {"id": "SZ-903", "endpoint": "/api/v1/payments", "severity": "Medium", "type": "Excessive Data Exposure", "status": "Fixed"}
  ],
  "stats": {
    "security_score": 78,
    "total_endpoints": 142,
    "active_vulnerabilities": 12
  }
}
```
