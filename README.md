# Kiterae Flat Design Agent

Blocks agent that turns a text direction or reference image into three fundamentally different flat website design languages:

- Restrained: near-monochrome Swiss/Bauhaus reduction where typography carries the page.
- Direct: literal, specific interpretation of the brief without generic category tropes.
- Unexpected: one implied word or mood pushed into a genuinely different visual grammar. By default this can move into a playful pop-brutalist, sticker-book, chunky educational lane with thick black outlines, candy accents, cream dotted paper, and cartoon-like flat hero art.

Each concept is sent through OpenAI image generation and returned as a PNG artifact, plus a structured JSON spec and a Markdown CSS/site guidance handoff.

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
- `unexpectedStyleHint`: optional style lane for the Unexpected concept.
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

The trigger saves returned artifacts into `artifacts/`, including `flat-design-concepts.json`, `site-design-guidance.md`, and three preview PNGs.

## Railway

Railway can deploy this as a Node service with the included `railway.toml`. Add the same environment variables in Railway, then deploy the project directory. The start command is `npm start`, which runs the Blocks agent.
