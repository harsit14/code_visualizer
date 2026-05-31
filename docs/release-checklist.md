# Release Checklist

Use this before publishing a new public version.

## Local Verification

```bash
npm run ci
```

## Browser Verification

- Run all built-in examples.
- Scrub the timeline forward and backward.
- Click a variable that references an object.
- Check `0.5x`, `1x`, `2x`, and `4x` playback.
- Export a JSON trace.
- Create and reload a share link.
- Confirm stdout appears only at the final recorded step.
- Confirm timeout still interrupts runaway code.

## Cloudflare Verification

- Production deploy succeeds from `main`.
- Preview deploy succeeds from a pull request branch.
- Response headers include COOP and COEP.
- Pyodide loads from `/assets/pyodide/`.
- The app works at desktop widths.
