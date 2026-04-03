<!-- Improved compatibility of back to top link: See: https://github.com/othneildrew/Best-README-Template/pull/73 -->

<div align="center">
<img width="800" alt="header image" src="assets/web-preview.png">
<h3 align="center">Onlook</h3>
  <p align="center">
    Cursor for Designers
    <br />
    <a href="https://docs.onlook.com"><strong>Explore the docs »</strong></a>
    <br />
  </p>
  <p align="center">
    👨‍💻👩‍💻👨‍💻
    <a href="https://www.ycombinator.com/companies/onlook/jobs/e4gHv1n-founding-engineer-fullstack">We're hiring engineers in SF!</a>
    👩‍💻👨‍💻👩‍💻
  </p>
    <br />
    <a href="https://youtu.be/RSX_3EaO5eU?feature=shared">View Demo</a>
    ·
    <a href="https://github.com/onlook-dev/onlook/issues/new?labels=bug&template=bug-report---.md">Report Bug</a>
    ·
    <a href="https://github.com/onlook-dev/onlook/issues/new?labels=enhancement&template=feature-request---.md">Request Feature</a>
  </p>
  <!-- PROJECT SHIELDS -->
<!--
*** I'm using markdown "reference style" links for readability.
*** Reference links are enclosed in brackets [ ] instead of parentheses ( ).
*** See the bottom of this document for the declaration of the reference variables
*** for contributors-url, forks-url, etc. This is an optional, concise syntax you may use.
*** https://www.markdownguide.org/basic-syntax/#reference-style-links
-->
<!-- [![Contributors][contributors-shield]][contributors-url]
[![Forks][forks-shield]][forks-url]
[![Stargazers][stars-shield]][stars-url]
[![Issues][issues-shield]][issues-url]
[![Apache License][license-shield]][license-url] -->

[![Discord][discord-shield]][discord-url]
[![LinkedIn][linkedin-shield]][linkedin-url]
[![Twitter][twitter-shield]][twitter-url]

[中文](https://www.readme-i18n.com/onlook-dev/onlook?lang=zh) |
[Español](https://www.readme-i18n.com/onlook-dev/onlook?lang=es) |
[Deutsch](https://www.readme-i18n.com/onlook-dev/onlook?lang=de) |
[français](https://www.readme-i18n.com/onlook-dev/onlook?lang=fr) |
[Português](https://www.readme-i18n.com/onlook-dev/onlook?lang=pt) |
[Русский](https://www.readme-i18n.com/onlook-dev/onlook?lang=ru) |
[日本語](https://www.readme-i18n.com/onlook-dev/onlook?lang=ja) |
[한국어](https://www.readme-i18n.com/onlook-dev/onlook?lang=ko)

</div>

# An Open-Source, Visual-First Code Editor

Craft websites, prototypes, and designs with AI in Next.js + TailwindCSS. Make
edits directly in the browser DOM with a visual editor. Design in realtime with
code. An open-source alternative to Bolt.new, Lovable, V0, Replit Agent, Figma
Make, Webflow, etc.

### 🚧 🚧 🚧 Onlook is still under development 🚧 🚧 🚧

We're actively looking for contributors to help make Onlook for Web an
incredible prompt-to-build experience. Check the
[open issues](https://github.com/onlook-dev/onlook/issues) for a full list of
proposed features (and known issues), and join our
[Discord](https://discord.gg/hERDfFZCsH) to collaborate with hundreds of other
builders.

## What you can do with Onlook:

- [x] Create Next.js app in seconds
  - [x] Start from text or image
  - [x] Use prebuilt templates
  - [ ] Import from Figma
  - [ ] Import from GitHub repo
  - [ ] Make a PR to a GitHub repo
- [x] Visually edit your app
  - [x] Use Figma-like UI
  - [x] Preview your app in real-time
  - [x] Manage brand assets and tokens
  - [x] Create and navigate to Pages
  - [x] Browse layers
  - [x] Manage project Images
  - [x] Detect and use Components – _Previously in
        [Onlook Desktop](https://github.com/onlook-dev/desktop)_
  - [ ] Drag-and-drop Components Panel
  - [x] Use Branching to experiment with designs
- [x] Development Tools
  - [x] Real-time code editor
  - [x] Save and restore from checkpoints
  - [x] Run commands via CLI
  - [x] Connect with app marketplace
- [x] Deploy your app in seconds
  - [x] Generate sharable links
  - [x] Link your custom domain    
- [ ] Collaborate with your team
  - [x] Real-time editing
  - [ ] Leave comments
- [ ] Advanced AI capabilities
  - [x] Queue multiple messages at once
  - [ ] Use Images as references and as assets in a project
  - [ ] Setup and use MCPs in projects
  - [ ] Allow Onlook to use itself as a toolcall for branch creation and iteration
- [ ] Advanced project support
  - [ ] Support non-NextJS projects
  - [ ] Support non-Tailwind projects
  - [x] Experimental Expo Web (CodeSandbox + NativeWind) support on this branch

![Onlook-GitHub-Example](https://github.com/user-attachments/assets/642de37a-72cc-4056-8eb7-8eb42714cdc4)

## Getting Started

Use our [hosted app](https://onlook.com) or
[run locally](https://docs.onlook.com/developers/running-locally).

## Experimental: Expo Web (Option A)

This branch includes an experimental CodeSandbox + Expo Web pipeline that reuses
Onlook's existing editor architecture.

### Setup

Use this guide to run the latest Expo Web integration on this branch.

1. Create an Expo Web template in CodeSandbox.
   Use Expo SDK 52+ with `expo-router` and `nativewind`.

2. Configure the template dev task in `.codesandbox/tasks.json`.
   Keep the task id as `dev` and preview port `8081`:

```json
{
  "setupTasks": [{ "name": "Install", "command": "npm install" }],
  "tasks": {
    "dev": {
      "name": "Expo Web",
      "command": "npx expo start --web --port 8081",
      "preview": { "port": 8081 },
      "runAtStart": true
    }
  }
}
```

3. Confirm the template works before wiring Onlook.
   Open the CodeSandbox preview and verify Expo Web loads and hot-reloads.

4. Copy your CodeSandbox template ID.
   This is the value Onlook uses for `source: "template"` when forking new
   Expo projects.

5. Set env vars in your local Onlook environment.
   Add these to your local env file (for example, `.env`):

```bash
ONLOOK_CSB_EXPO_TEMPLATE_ID=<your_codesandbox_template_id>
ONLOOK_CSB_EXPO_TEMPLATE_PORT=8081
```

6. Start Onlook locally.

```bash
bun install
bun run dev
```

7. Create a new project in Onlook.
   The blank/project creation flow will use `Templates.EXPO_WEB` and fork your
   Expo template.

8. Verify preload injection and editing.
   Onlook will:
   - write `public/onlook-preload-script.js` into the sandbox project,
   - inject the script into Expo `web/index.html`,
   - connect the iframe via Penpal for selection/editing.

9. Smoke test expected behavior.
   - Select a `View`/`Text` in canvas and confirm overlay selection works.
   - Change styles and confirm instant preview updates.
   - Insert new elements and verify generated code uses RN components and adds
     missing `react-native` imports.

If `ONLOOK_CSB_EXPO_TEMPLATE_ID` is missing, Onlook falls back to the existing
empty Next.js template.

### What is implemented

- New sandbox template key: `Templates.EXPO_WEB`
- Project-type detection (`nextjs` vs `expo`) in the sandbox flow
- Preload script injection for both project types:
  - Next.js: AST injection into root layout
  - Expo Web: injects `<script src="/onlook-preload-script.js">` into `web/index.html`
- RN Web element hit-testing resilience:
  - Canvas selection resolves to nearest ancestor with `data-oid`/instance OID
- React Native insertion support:
  - Inserts `View`/`Text` for draw+drop flows in Expo projects
  - Auto-adds missing `react-native` imports during AST write-back
- NativeWind safety in toolbar controls:
  - Web-only layout values like `display: grid` are disabled for Expo projects
  - UI warning shown in the Display control for NativeWind constraints

### Known constraints

- Expo support currently targets web preview first.
- Some controls remain web-first and are progressively constrained for
  NativeWind parity.
- If Supabase or other external services are unavailable in local dev, the app
  can still boot but background requests may error in logs.

## Experimental: Cloudflare Sandbox (Option B)

This branch includes an alternative cloud sandbox backend using Cloudflare
Containers via the [`@cloudflare/sandbox`](https://github.com/cloudflare/sandbox-sdk)
SDK. It can be used alongside or instead of CodeSandbox.

### Why Cloudflare Sandbox

- **Stable file sync** — no WebSocket disconnections or dropped writes
- **Public preview URLs** — auto-generated, no 401 errors from privacy settings
- **Custom container images** — Expo + Next.js pre-installed, preload scripts baked in
- **Usage-based pricing** — $5/mo base (Workers plan) + ~$0.18/hr per active sandbox, no per-seat cost
- **Open-source SDK** — path to self-managed infrastructure

### Prerequisites

- A [Cloudflare Workers paid plan](https://dash.cloudflare.com/) ($5/mo)
- A Cloudflare API token with Container permissions
- (Optional) Custom container images pushed to the CF Container Registry

### Setup

1. **Get your Cloudflare credentials.**

   - Go to the [Cloudflare dashboard](https://dash.cloudflare.com/)
   - Copy your **Account ID** from the right sidebar of the Workers & Pages section
   - Create an **API Token** at My Profile > API Tokens > Create Token
     - Use the "Edit Cloudflare Workers" template or create a custom token with
       `Workers Scripts:Edit` and `Account Settings:Read` permissions

2. **Add environment variables.**

   Add these to your local `apps/web/client/.env`:

   ```bash
   # Cloudflare Sandbox
   CLOUDFLARE_SANDBOX_API_TOKEN="<Your API token from step 1>"
   CLOUDFLARE_ACCOUNT_ID="<Your account ID from step 1>"

   # Enable the Cloudflare provider in the UI
   NEXT_PUBLIC_ENABLED_PROVIDERS="cloudflare,codesandbox"
   ```

   To use Cloudflare only (disabling CodeSandbox):

   ```bash
   NEXT_PUBLIC_ENABLED_PROVIDERS="cloudflare"
   ```

3. **(Optional) Build and push custom container images.**

   The project includes Dockerfiles for Expo and Next.js at `docker/cloudflare/`:

   ```bash
   # Build both images locally
   ./docker/cloudflare/build.sh

   # Push to Cloudflare Container Registry (requires wrangler)
   wrangler containers push scry-expo:latest
   wrangler containers push scry-nextjs:latest
   ```

   If you skip this step, the default Cloudflare container images will be used.

4. **Start Onlook locally.**

   ```bash
   bun install
   bun run dev
   ```

5. **Create a project using Cloudflare.**

   In the Create dropdown, you'll see new options when the feature flag is enabled:
   - **Next.js (Cloud)** — creates a CF sandbox with Next.js
   - **Expo / RN (Cloud)** — creates a CF sandbox with Expo

   Existing CodeSandbox and Local options remain available.

### Architecture

```
Onlook Editor (Browser)
    |
    |--- tRPC API (cfSandbox router)
    |       |
    |       |--- @cloudflare/sandbox SDK
    |       |--- Container lifecycle (create, start, stop, hibernate)
    |       |--- Preview URL management
    |
    |--- CloudflareSandboxProvider (code-provider package)
            |
            |--- File read/write/watch
            |--- Terminal (PTY via WebSocket)
            |--- Dev server management
```

### Provider configuration

| Environment Variable | Required | Description |
|---------------------|----------|-------------|
| `CLOUDFLARE_SANDBOX_API_TOKEN` | Yes | API token with Workers permissions |
| `CLOUDFLARE_ACCOUNT_ID` | Yes | Your Cloudflare account ID |
| `NEXT_PUBLIC_ENABLED_PROVIDERS` | No | Comma-separated list: `cloudflare`, `codesandbox` (default: `codesandbox`) |

### Cost comparison

| Usage | Cloudflare | CodeSandbox |
|-------|-----------|-------------|
| 20 hrs/mo (light) | ~$2.50 | Free (within credits) |
| 60 hrs/mo (medium) | ~$9.70 | ~$3 overage |
| 160 hrs/mo (heavy) | ~$27.70 | ~$21 (Pro + overage) |
| Per-seat cost | $0 | $12/mo |
| Base plan | $5/mo (Workers) | Free/$12 |

### Known constraints (Cloudflare)

- Cloudflare Sandbox SDK is in **public beta** — CodeSandbox is kept as fallback
- Container cold starts may add a few seconds to initial project creation
- The `@cloudflare/sandbox` SDK API may change between versions; we pin to v0.8.x
- Existing CodeSandbox projects are not automatically migrated

### Usage

Onlook will run on any Next.js + TailwindCSS project, import your project into
Onlook or start from scratch within the editor.

Use the AI chat to create or edit a project you're working on. At any time, you
can always right-click an element to open up the exact location of the element
in code.

<img width="600" alt="image" src="https://github.com/user-attachments/assets/4ad9f411-b172-4430-81ef-650f4f314666" />

<br>

Draw-in new divs and re-arrange them within their parent containers by
dragging-and-dropping.

<img width="600" alt="image" src="assets/insert-div.png">

<br>

Preview the code side-by-side with your site design.

<img width="600" alt="image" src="assets/code-connect.png">

<br>

Use Onlook's editor toolbar to adjust Tailwind styles, directly manipulate
objects, and experiment with layouts.

<img width="600" alt="image" src="assets/text-styling.png" />

## Documentation

For full documentation, visit [docs.onlook.com](https://docs.onlook.com)

To see how to Contribute, visit
[Contributing to Onlook](https://docs.onlook.com/developers) in our docs.

## How it works

<img width="676" alt="architecture" src="assets/architecture.png">

1. When you create an app, we load the code into a web container
2. The container runs and serves the code
3. Our editor receives the preview link and displays it in an iFrame
4. Our editor reads and indexes the code from the container
5. We instrument the code in order to map elements to their place in code
6. When the element is edited, we edit the element in our iFrame, then in code
7. Our AI chat also has code access and tools to understand and edit the code

This architecture can theoretically scale to any language or framework that
displays DOM elements declaratively (e.g. jsx/tsx/html). We are focused on
making it work well with Next.js and TailwindCSS for now.

For a full walkthrough, check out our
[Architecture Docs](https://docs.onlook.com/developers/architecture).

### Our Tech Stack

#### Front-end

- [Next.js](https://nextjs.org/) - Full stack
- [TailwindCSS](https://tailwindcss.com/) - Styling
- [tRPC](https://trpc.io/) - Server interface

#### Database

- [Supabase](https://supabase.com/) - Auth, Database, Storage
- [Drizzle](https://orm.drizzle.team/) - ORM

#### AI

- [AI SDK](https://ai-sdk.dev/) - LLM client
- [OpenRouter](https://openrouter.ai/) - LLM model provider
- [Morph Fast Apply](https://morphllm.com) - Fast apply model provider
- [Relace](https://relace.ai) - Fast apply model provider

#### Sandbox and hosting

- [CodeSandboxSDK](https://codesandbox.io/docs/sdk) - Dev sandbox
- [Cloudflare Sandbox SDK](https://github.com/cloudflare/sandbox-sdk) - Dev sandbox (alternative)
- [Freestyle](https://www.freestyle.sh/) - Hosting

#### Runtime

- [Bun](https://bun.sh/) - Monorepo, runtime, bundler
- [Docker](https://www.docker.com/) - Container management

## Contributing

![image](https://github.com/user-attachments/assets/ecc94303-df23-46ae-87dc-66b040396e0b)

If you have a suggestion that would make this better, please fork the repo and
create a pull request. You can also
[open issues](https://github.com/onlook-dev/onlook/issues).

See the [CONTRIBUTING.md](CONTRIBUTING.md) for instructions and code of conduct.

#### Contributors

<a href="https://github.com/onlook-dev/onlook/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=onlook-dev/onlook" />
</a>

## Contact

![image](https://github.com/user-attachments/assets/60684b68-1925-4550-8efd-51a1509fc953)

- Team: [Discord](https://discord.gg/hERDfFZCsH) -
  [Twitter](https://twitter.com/onlookdev) -
  [LinkedIn](https://www.linkedin.com/company/onlook-dev/) -
  [Email](mailto:contact@onlook.com)
- Project:
  [https://github.com/onlook-dev/onlook](https://github.com/onlook-dev/onlook)
- Website: [https://onlook.com](https://onlook.com)

## License

Distributed under the Apache 2.0 License. See [LICENSE.md](LICENSE.md) for more
information.

<!-- https://www.markdownguide.org/basic-syntax/#reference-style-links -->

[contributors-shield]: https://img.shields.io/github/contributors/onlook-dev/studio.svg?style=for-the-badge
[contributors-url]: https://github.com/onlook-dev/onlook/graphs/contributors
[forks-shield]: https://img.shields.io/github/forks/onlook-dev/studio.svg?style=for-the-badge
[forks-url]: https://github.com/onlook-dev/onlook/network/members
[stars-shield]: https://img.shields.io/github/stars/onlook-dev/studio.svg?style=for-the-badge
[stars-url]: https://github.com/onlook-dev/onlook/stargazers
[issues-shield]: https://img.shields.io/github/issues/onlook-dev/studio.svg?style=for-the-badge
[issues-url]: https://github.com/onlook-dev/onlook/issues
[license-shield]: https://img.shields.io/github/license/onlook-dev/studio.svg?style=for-the-badge
[license-url]: https://github.com/onlook-dev/onlook/blob/master/LICENSE.txt
[linkedin-shield]: https://img.shields.io/badge/-LinkedIn-black.svg?logo=linkedin&colorB=555
[linkedin-url]: https://www.linkedin.com/company/onlook-dev
[twitter-shield]: https://img.shields.io/badge/-Twitter-black?logo=x&colorB=555
[twitter-url]: https://x.com/onlookdev
[discord-shield]: https://img.shields.io/badge/-Discord-black?logo=discord&colorB=555
[discord-url]: https://discord.gg/hERDfFZCsH
[React.js]: https://img.shields.io/badge/react-%2320232a.svg?logo=react&logoColor=%2361DAFB
[React-url]: https://reactjs.org/
[TailwindCSS]: https://img.shields.io/badge/tailwindcss-%2338B2AC.svg?logo=tailwind-css&logoColor=white
[Tailwind-url]: https://tailwindcss.com/
[Electron.js]: https://img.shields.io/badge/Electron-191970?logo=Electron&logoColor=white
[Electron-url]: https://www.electronjs.org/
[Vite.js]: https://img.shields.io/badge/vite-%23646CFF.svg?logo=vite&logoColor=white
[Vite-url]: https://vitejs.dev/
[product-screenshot]: assets/brand.png
[weave-shield]: https://img.shields.io/endpoint?url=https%3A%2F%2Fapp.workweave.ai%2Fapi%2Frepository%2Fbadge%2Forg_pWcXBHJo3Li2Te2Y4WkCPA33%2F820087727&cacheSeconds=3600&labelColor=#131313
[weave-url]: https://app.workweave.ai/reports/repository/org_pWcXBHJo3Li2Te2Y4WkCPA33/820087727
