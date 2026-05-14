# Kiterae Site Design Agent

Blocks agent that turns a text direction or reference image into three fundamentally different website design languages:

- Direct Minimalist: the most direct, clearest, least-decorated expression of the brief.
- Maximalist: an abundant, expressive, high-density interpretation of the same brief.
- Copy-Led Style: a third style chosen from the copy's natural creative direction, such as editorial, highly visual/immersive, brutalist, Swiss/international, SaaS/product UI, experimental/art-directed, retro/nostalgic, or expose/reveal.

Each concept is sent through OpenAI image generation and returned as a PNG artifact, plus a structured JSON spec and a Markdown CSS/site guidance handoff.

All three directions share one global composition rule: content placement should feel editorial. The page should read like an authored product feature or magazine spread, using headline/dek hierarchy, chapter labels, captions, sidebars, pull quotes, proof callouts, and paced story bands instead of a generic card grid or dashboard shell.

## Inputs

The agent accepts a JSON `request` part and an optional uploaded `reference_image` part. You can also provide `imageUrl` or `imageDataUrl` inside the JSON request.

Useful request fields:

- `direction`: plain-language website brief.
- `designDirection`: explicit art direction or constraints to honor.
- `brandName` / `productName`
- `siteType`
- `audience`
- `requiredElements`
- `avoid`
- `variationStrength`: `moderate`, `strong`, or `extreme`.
- `thirdStyleHint`: optional bias for the Copy-Led Style concept.
- `unexpectedStyleHint`: backwards-compatible alias for `thirdStyleHint`.
- `imageUrl` / `imageDataUrl`
- `imageSize`: `1024x1024`, `1024x1536`, or `1536x1024`.
- `imageQuality`: `low`, `medium`, `high`, or `auto`.

## Environment

Set these locally and in Railway:

```bash
BLOCKS_API_KEY=
OPENAI_API_KEY=
OPENAI_TEXT_MODEL=gpt-5.4-mini
OPENAI_IMAGE_MODEL=gpt-image-2
OPENAI_BASE_URL=https://api.openai.com/v1
```

## Local Workflow

```bash
npm install
npm run check
blocks login
blocks publish
npm start
```

In another terminal, submit the sample task:

```bash
npm run trigger
```

The trigger saves returned artifacts into `artifacts/`, including `site-design-concepts.json`, `site-design-guidance.md`, and three preview PNGs.

## Railway

Railway can deploy this as a Node service with the included `railway.toml`. Add the same environment variables in Railway, then deploy the project directory. The start command is `npm start`, which runs the Blocks agent.
