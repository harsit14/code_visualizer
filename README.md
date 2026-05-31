# Code Visualizer

A Python-first runtime visualizer for understanding code flow, variables, scopes, references, loops, and object mutations.

## Features

- Client-side Python execution through Pyodide in a Web Worker.
- Line-by-line trace playback with source highlighting and timeline scrubbing.
- Scope, variable, object identity, alias, mutation, loop, and function-call visualization.
- Rich shallow object views for lists, tuples, dicts, sets, and simple custom objects.
- Playback speed control, object focus, share links, and JSON trace export.
- Cloudflare Pages-ready cross-origin isolation headers for interrupt support.

## Local Development

```bash
npm install
npm run dev
```

## Verification

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```

Full local CI, including production smoke checks:

```bash
npm run ci
```

## Cloudflare Pages

- Framework preset: Vite
- Build command: `npm run build`
- Build output directory: `dist`
- Production branch: `main`
- Node.js version: `22`

The `public/_headers` file enables cross-origin isolation for the Pyodide interrupt-buffer timeout strategy.

See [docs/deployment.md](docs/deployment.md) for the complete GitHub and Cloudflare setup.
