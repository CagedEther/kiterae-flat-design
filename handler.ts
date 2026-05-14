import type { HandlerResult, StartTaskMessage, TaskContext } from '@blocks-network/sdk';

type LensMode = 'Restrained' | 'Direct' | 'Unexpected';

type DesignRequest = {
  direction?: string;
  designDirection?: string;
  brandName?: string;
  productName?: string;
  siteType?: string;
  audience?: string;
  requiredElements?: string[] | string;
  avoid?: string[] | string;
  variationStrength?: string;
  unexpectedStyleHint?: string;
  imageUrl?: string;
  imageDataUrl?: string;
  imageSize?: string;
  imageQuality?: string;
};

type ReferenceImage = {
  source: 'uploaded-image' | 'image-url' | 'image-data-url';
  imageUrl: string;
  mimeType?: string;
};

type FlatDesign = {
  mode: LensMode;
  title: string;
  concept: string;
  designLanguage: {
    name: string;
    summary: string;
    differentiators: string[];
  };
  layout: string;
  palette: {
    background: string;
    text: string;
    primary: string;
    secondary: string;
    accent: string;
  };
  typography: string;
  interactionMood: string;
  components: string[];
  cssGuidance: {
    cssVariables: Array<{
      name: string;
      value: string;
      purpose: string;
    }>;
    layoutRules: string[];
    componentRules: string[];
    responsiveRules: string[];
  };
  handoffNotes: string[];
  imagePrompt: string;
};

type DesignSpec = {
  briefSummary: string;
  inputMode: 'text' | 'image' | 'text+image';
  designs: FlatDesign[];
};

type GeneratedImage = {
  mode: LensMode;
  outputId: string;
  fileName: string;
  mimeType: 'image/png';
  model: string;
  prompt: string;
  revisedPrompt?: string;
};

const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1';
const TEXT_MODEL = process.env.OPENAI_TEXT_MODEL ?? 'gpt-5.4-mini';
const IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL ?? 'gpt-image-2';
const DEFAULT_IMAGE_SIZE = '1536x1024';
const DEFAULT_IMAGE_QUALITY = 'medium';

const DESIGN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['briefSummary', 'inputMode', 'designs'],
  properties: {
    briefSummary: { type: 'string' },
    inputMode: { type: 'string', enum: ['text', 'image', 'text+image'] },
    designs: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'mode',
          'title',
          'concept',
          'designLanguage',
          'layout',
          'palette',
          'typography',
          'interactionMood',
          'components',
          'cssGuidance',
          'handoffNotes',
          'imagePrompt',
        ],
        properties: {
          mode: { type: 'string', enum: ['Restrained', 'Direct', 'Unexpected'] },
          title: { type: 'string' },
          concept: { type: 'string' },
          designLanguage: {
            type: 'object',
            additionalProperties: false,
            required: ['name', 'summary', 'differentiators'],
            properties: {
              name: { type: 'string' },
              summary: { type: 'string' },
              differentiators: {
                type: 'array',
                items: { type: 'string' },
              },
            },
          },
          layout: { type: 'string' },
          palette: {
            type: 'object',
            additionalProperties: false,
            required: ['background', 'text', 'primary', 'secondary', 'accent'],
            properties: {
              background: { type: 'string' },
              text: { type: 'string' },
              primary: { type: 'string' },
              secondary: { type: 'string' },
              accent: { type: 'string' },
            },
          },
          typography: { type: 'string' },
          interactionMood: { type: 'string' },
          components: {
            type: 'array',
            items: { type: 'string' },
          },
          cssGuidance: {
            type: 'object',
            additionalProperties: false,
            required: ['cssVariables', 'layoutRules', 'componentRules', 'responsiveRules'],
            properties: {
              cssVariables: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['name', 'value', 'purpose'],
                  properties: {
                    name: { type: 'string' },
                    value: { type: 'string' },
                    purpose: { type: 'string' },
                  },
                },
              },
              layoutRules: {
                type: 'array',
                items: { type: 'string' },
              },
              componentRules: {
                type: 'array',
                items: { type: 'string' },
              },
              responsiveRules: {
                type: 'array',
                items: { type: 'string' },
              },
            },
          },
          handoffNotes: {
            type: 'array',
            items: { type: 'string' },
          },
          imagePrompt: { type: 'string' },
        },
      },
    },
  },
} as const;

export default async function handler(
  task: StartTaskMessage,
  ctx?: TaskContext,
): Promise<HandlerResult> {
  ctx?.reportStatus('Reading design direction...');
  const { request, referenceImage } = await normalizeInput(task, ctx);

  if (!hasBriefMaterial(request, referenceImage)) {
    throw new Error(
      'Provide a text direction, an image URL/data URL, or an uploaded reference image.',
    );
  }

  ctx?.reportStatus('Creating three flat design directions...');
  const spec = await createDesignSpec(request, referenceImage, ctx);

  const orderedDesigns = orderDesigns(spec.designs);
  const imageArtifacts = [];
  const generatedImages: GeneratedImage[] = [];

  for (const design of orderedDesigns) {
    ctx?.reportStatus(`Generating ${design.mode} preview image...`);
    const prompt = buildImagePrompt(design, request);
    const image = await generatePreviewImage(prompt, request, ctx);
    const outputId = `${design.mode.toLowerCase()}_preview`;
    const fileName = `${slugify(design.mode)}-flat-website-design.png`;

    imageArtifacts.push({
      outputId,
      fileName,
      data: image.bytes,
      mimeType: 'image/png',
    });
    generatedImages.push({
      mode: design.mode,
      outputId,
      fileName,
      mimeType: 'image/png',
      model: IMAGE_MODEL,
      prompt,
      revisedPrompt: image.revisedPrompt,
    });
  }

  const report = {
    ...spec,
    designs: orderedDesigns,
    generatedAt: new Date().toISOString(),
    models: {
      text: TEXT_MODEL,
      image: IMAGE_MODEL,
    },
    generatedImages,
  };

  return {
    artifacts: [
      {
        outputId: 'design_spec',
        fileName: 'flat-design-concepts.json',
        data: JSON.stringify(report, null, 2),
        mimeType: 'application/json',
      },
      {
        outputId: 'site_guidance',
        fileName: 'site-design-guidance.md',
        data: buildSiteGuidanceMarkdown(report),
        mimeType: 'text/markdown',
      },
      ...imageArtifacts,
    ],
  };
}

async function normalizeInput(
  task: StartTaskMessage,
  ctx?: TaskContext,
): Promise<{ request: DesignRequest; referenceImage?: ReferenceImage }> {
  const request: DesignRequest = {};
  let referenceImage: ReferenceImage | undefined;

  for (const part of task.requestParts ?? []) {
    if (typeof part === 'string') {
      mergeRequest(request, parseTextPart(part));
      continue;
    }

    if (!isRecord(part)) continue;

    const partId = stringValue(part.partId) ?? stringValue(part.id);
    const contentType = stringValue(part.contentType) ?? stringValue(part.mimeType);

    if (
      !referenceImage
      && ctx
      && (partId === 'reference_image' || contentType?.startsWith('image/'))
    ) {
      referenceImage = await downloadReferenceImage(part, ctx);
      continue;
    }

    const partText = stringValue(part.text) ?? stringValue(part.data);
    if (partText) {
      mergeRequest(request, parseTextPart(partText));
      continue;
    }

    mergeRequest(request, part);
  }

  if (!referenceImage && request.imageDataUrl) {
    referenceImage = {
      source: 'image-data-url',
      imageUrl: request.imageDataUrl,
      mimeType: parseDataUrlMimeType(request.imageDataUrl),
    };
  }

  if (!referenceImage && request.imageUrl) {
    referenceImage = {
      source: 'image-url',
      imageUrl: request.imageUrl,
    };
  }

  request.requiredElements = normalizeStringList(request.requiredElements);
  request.avoid = normalizeStringList(request.avoid);

  return { request, referenceImage };
}

function parseTextPart(text: string): DesignRequest {
  const trimmed = text.trim();
  if (!trimmed) return {};

  try {
    const parsed = JSON.parse(trimmed);
    if (isRecord(parsed)) return parsed as DesignRequest;
  } catch {
    // Plain text prompts are valid task inputs.
  }

  return { direction: trimmed };
}

function mergeRequest(target: DesignRequest, source: Record<string, unknown> | DesignRequest): void {
  const fields: Array<keyof DesignRequest> = [
    'direction',
    'designDirection',
    'brandName',
    'productName',
    'siteType',
    'audience',
    'requiredElements',
    'avoid',
    'variationStrength',
    'unexpectedStyleHint',
    'imageUrl',
    'imageDataUrl',
    'imageSize',
    'imageQuality',
  ];

  for (const field of fields) {
    const value = source[field];
    if (value === undefined || value === null || value === '') continue;

    if (field === 'direction' && target.direction && typeof value === 'string') {
      target.direction = `${target.direction}\n\n${value}`;
    } else {
      target[field] = value as never;
    }
  }
}

async function downloadReferenceImage(
  part: Record<string, unknown>,
  ctx: TaskContext,
): Promise<ReferenceImage> {
  const downloaded = await ctx.downloadInputArtifact(part as never) as {
    data?: Uint8Array | ArrayBuffer | Buffer | string;
    mimeType?: string;
    contentType?: string;
  };
  const mimeType = downloaded.mimeType ?? downloaded.contentType ?? 'image/png';
  const bytes = toBuffer(downloaded.data);

  return {
    source: 'uploaded-image',
    imageUrl: `data:${mimeType};base64,${bytes.toString('base64')}`,
    mimeType,
  };
}

async function createDesignSpec(
  request: DesignRequest,
  referenceImage: ReferenceImage | undefined,
  ctx?: TaskContext,
): Promise<DesignSpec> {
  const content: Array<Record<string, string>> = [
    {
      type: 'input_text',
      text: buildDesignBrief(request, referenceImage),
    },
  ];

  if (referenceImage) {
    content.push({
      type: 'input_image',
      image_url: referenceImage.imageUrl,
    });
  }

  const response = await openAI('/responses', {
    model: TEXT_MODEL,
    input: [
      {
        role: 'system',
        content: [
          {
            type: 'input_text',
            text: [
              'You are a senior web art director creating flat website design concepts.',
              'Return exactly three concepts in this order: Restrained, Direct, Unexpected.',
              'The three concepts must be fundamentally different design languages, not siblings with small palette/layout changes.',
              'Each concept needs a named design language, visual grammar, CSS tokens, layout rules, component rules, responsive rules, and image prompt.',
              'Restrained: near-monochrome Swiss/Bauhaus/editorial reduction, hard grid, severe type hierarchy, minimal imagery, quietest useful reading.',
              'Direct: literal interpretation of the brief with specificity and conviction; build the clearest product/content experience for the actual audience, not generic category clichés.',
              'Unexpected: pick one word or implied mood and push it into a genuinely different visual grammar. Prefer playful pop-brutalist, sticker-book, chunky educational, illustrated, or poster-like systems when the brief permits.',
              'For Unexpected, a strong valid lane is: cream paper or dotted background, huge friendly black headline type, thick black outlines, offset rounded panels, hot pink/yellow/blue/mint accents, pill stickers, cartoon-like hero object, dark contrast bands, and joyful no-jargon energy. Do not copy any specific brand, but capture that level of boldness and difference.',
              'Honor explicit design direction, hard constraints, audience, and supplied reference imagery.',
              'If the user asks for restraint or forbids playful styles, Unexpected should still be structurally different but should choose a compatible provocation.',
              'These are flat website designs intended to become fleshed-out websites, so focus on layout, palette, typography, components, CSS/site guidance, and implementation handoff notes.',
            ].join(' '),
          },
        ],
      },
      {
        role: 'user',
        content,
      },
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'flat_design_concepts',
        strict: true,
        schema: DESIGN_SCHEMA,
      },
    },
  }, ctx);

  const text = extractResponseText(response);
  const parsed = JSON.parse(text) as DesignSpec;
  const completedDesigns = completeDesigns(parsed.designs ?? [], request);

  return {
    ...parsed,
    designs: completedDesigns,
    inputMode: referenceImage && request.direction ? 'text+image' : referenceImage ? 'image' : 'text',
  };
}

function buildDesignBrief(request: DesignRequest, referenceImage?: ReferenceImage): string {
  const lines = [
    `Text direction: ${request.direction?.trim() || '(none supplied)'}`,
    `Additional design direction: ${request.designDirection?.trim() || '(none supplied)'}`,
    `Brand/product: ${request.brandName || request.productName || '(not specified)'}`,
    `Site type: ${request.siteType || '(infer the best website type)'}`,
    `Audience: ${request.audience || '(infer from the brief)'}`,
    `Required elements: ${formatList(request.requiredElements)}`,
    `Avoid: ${formatList(request.avoid)}`,
    `Variation strength: ${request.variationStrength || 'strong'}`,
    `Unexpected style hint: ${request.unexpectedStyleHint || 'playful pop-brutalist educational site with thick black outlines, sticker badges, candy accents, cream dotted paper, chunky type, and cartoon-like flat hero art'}`,
    `Reference image: ${referenceImage ? `provided as ${referenceImage.source}` : 'not provided'}`,
  ];

  return lines.join('\n');
}

function buildImagePrompt(design: FlatDesign, request: DesignRequest): string {
  return [
    'Create a polished flat website design mockup that could be used as the visual foundation for a production website.',
    'Do not include browser chrome, device frames, 3D perspective, photorealistic stock imagery, watermarks, or explanatory annotations.',
    'Use crisp flat UI geometry, strong spacing, realistic web sections, and abstract text blocks instead of long readable copy.',
    `Website context: ${request.siteType || 'infer from the brief'}.`,
    `Brand/product: ${request.brandName || request.productName || 'unnamed brand'}.`,
    `Design mode: ${design.mode}.`,
    `Title: ${design.title}.`,
    `Concept: ${design.concept}.`,
    `Design language: ${design.designLanguage.name} — ${design.designLanguage.summary}.`,
    `Hard differentiators: ${design.designLanguage.differentiators.join('; ')}.`,
    `Layout: ${design.layout}.`,
    `Palette: background ${design.palette.background}, text ${design.palette.text}, primary ${design.palette.primary}, secondary ${design.palette.secondary}, accent ${design.palette.accent}.`,
    `Typography: ${design.typography}.`,
    `Components to show: ${design.components.join(', ')}.`,
    `CSS/layout cues: ${design.cssGuidance.layoutRules.join('; ')}.`,
    `Component cues: ${design.cssGuidance.componentRules.join('; ')}.`,
    `Mood: ${design.interactionMood}.`,
    design.mode === 'Unexpected'
      ? 'For this Unexpected version, make the visual grammar obviously unlike a restrained/editorial or normal SaaS/product page: thick outlines, sticker badges, offset compositions, bright accents, oversized friendly type, and a playful illustration or symbolic flat mascot/object are allowed when suitable.'
      : '',
    `Specific art direction: ${design.imagePrompt}`,
  ].filter(Boolean).join('\n');
}

function buildSiteGuidanceMarkdown(report: DesignSpec & {
  generatedAt: string;
  models: { text: string; image: string };
  generatedImages: GeneratedImage[];
}): string {
  const sections = report.designs.map((design) => {
    const variables = design.cssGuidance.cssVariables
      .map((item) => `  ${item.name}: ${item.value}; /* ${item.purpose} */`)
      .join('\n');
    const layoutRules = design.cssGuidance.layoutRules.map((rule) => `- ${rule}`).join('\n');
    const componentRules = design.cssGuidance.componentRules.map((rule) => `- ${rule}`).join('\n');
    const responsiveRules = design.cssGuidance.responsiveRules.map((rule) => `- ${rule}`).join('\n');
    const handoffNotes = design.handoffNotes.map((note) => `- ${note}`).join('\n');

    return [
      `## ${design.mode}: ${design.title}`,
      '',
      `**Design language:** ${design.designLanguage.name}`,
      '',
      design.designLanguage.summary,
      '',
      '**Differentiators**',
      design.designLanguage.differentiators.map((item) => `- ${item}`).join('\n'),
      '',
      '**CSS tokens**',
      '',
      '```css',
      `:root {\n${variables}\n}`,
      '```',
      '',
      '**Layout rules**',
      layoutRules,
      '',
      '**Component rules**',
      componentRules,
      '',
      '**Responsive rules**',
      responsiveRules,
      '',
      '**Handoff notes**',
      handoffNotes,
    ].join('\n');
  });

  return [
    '# Flat Website Design Guidance',
    '',
    `Generated: ${report.generatedAt}`,
    `Brief: ${report.briefSummary}`,
    '',
    ...sections,
    '',
  ].join('\n');
}

async function generatePreviewImage(
  prompt: string,
  request: DesignRequest,
  ctx?: TaskContext,
): Promise<{ bytes: Buffer; revisedPrompt?: string }> {
  const response = await openAI('/images/generations', {
    model: IMAGE_MODEL,
    prompt,
    n: 1,
    size: sanitizeImageSize(request.imageSize),
    quality: sanitizeImageQuality(request.imageQuality),
    background: 'opaque',
    output_format: 'png',
  }, ctx);

  const image = firstArrayItem(response.data);
  if (!isRecord(image)) {
    throw new Error('OpenAI image response did not include image data.');
  }

  const b64 = stringValue(image.b64_json);
  if (b64) {
    return {
      bytes: Buffer.from(b64, 'base64'),
      revisedPrompt: stringValue(image.revised_prompt),
    };
  }

  const url = stringValue(image.url);
  if (url) {
    const fetched = await fetch(url, { signal: ctx?.cancelSignal });
    if (!fetched.ok) {
      throw new Error(`Failed to download generated image (${fetched.status}).`);
    }
    return {
      bytes: Buffer.from(await fetched.arrayBuffer()),
      revisedPrompt: stringValue(image.revised_prompt),
    };
  }

  throw new Error('OpenAI image response did not include b64_json or url.');
}

async function openAI(
  path: string,
  body: Record<string, unknown>,
  ctx?: TaskContext,
): Promise<Record<string, unknown>> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'OPENAI_API_KEY is required. Set it in Railway and in your local environment before running the agent.',
    );
  }

  const response = await fetch(`${OPENAI_BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: ctx?.cancelSignal,
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`OpenAI ${path} failed (${response.status}): ${text.slice(0, 800)}`);
  }

  return JSON.parse(text) as Record<string, unknown>;
}

function extractResponseText(response: Record<string, unknown>): string {
  const outputText = stringValue(response.output_text);
  if (outputText) return outputText;

  const output = Array.isArray(response.output) ? response.output : [];
  for (const item of output) {
    if (!isRecord(item) || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (isRecord(content) && typeof content.text === 'string') return content.text;
    }
  }

  throw new Error('OpenAI response did not include text output.');
}

function orderDesigns(designs: FlatDesign[]): FlatDesign[] {
  const order: LensMode[] = ['Restrained', 'Direct', 'Unexpected'];
  const byMode = new Map<string, FlatDesign>();

  for (const design of designs) {
    byMode.set(design.mode.toLowerCase(), design);
  }

  const exact = order.map((mode) => byMode.get(mode.toLowerCase()));
  if (exact.every(Boolean)) {
    return exact.map((design, index) => ({
      ...design!,
      mode: order[index],
    }));
  }

  if (designs.length >= 3) {
    return order.map((mode, index) => ({
      ...designs[index],
      mode,
    }));
  }

  throw new Error('Expected three design concepts in order: Restrained, Direct, Unexpected.');
}

function completeDesigns(designs: FlatDesign[], request: DesignRequest): FlatDesign[] {
  const order: LensMode[] = ['Restrained', 'Direct', 'Unexpected'];
  const canonical = designs.map((design, index) => ({
    ...design,
    mode: order[index] ?? design.mode,
  }));
  const byMode = new Map<LensMode, FlatDesign>();

  for (const design of canonical) {
    if (order.includes(design.mode)) byMode.set(design.mode, design);
  }

  return order.map((mode) => byMode.get(mode) ?? fallbackDesign(mode, request));
}

function fallbackDesign(mode: LensMode, request: DesignRequest): FlatDesign {
  const subject = request.brandName || request.productName || 'the product';
  const context = request.siteType || 'website';

  if (mode === 'Restrained') {
    return {
      mode,
      title: 'Signal Ledger',
      concept: `A quiet editorial interpretation of ${subject}, using precision, spacing, and terse proof points to make ${context} feel trustworthy.`,
      designLanguage: {
        name: 'Swiss Signal Editorial',
        summary: 'Near-monochrome technical editorial system with thin rules, a hard grid, small latency annotations, and restrained diagrammatic marks.',
        differentiators: [
          'Near-monochrome palette',
          'Hard alignment and thin rules',
          'Typography-led hierarchy',
          'Minimal diagrammatic stream marks',
        ],
      },
      layout: 'A strict two-column hero, compact proof strip, editorial API block, and stacked evidence sections separated by rules.',
      palette: {
        background: '#F7F7F2',
        text: '#111111',
        primary: '#111111',
        secondary: '#7A7A72',
        accent: '#D8D4CA',
      },
      typography: 'Condensed grotesk for headings, neutral mono for metrics and API details, quiet sans for body copy.',
      interactionMood: 'Calm, precise, low-latency, and serious.',
      components: ['typographic hero', 'latency proof strip', 'thin-rule API panel', 'metric table', 'use-case index'],
      cssGuidance: {
        cssVariables: [
          { name: '--bg', value: '#F7F7F2', purpose: 'Warm technical page background' },
          { name: '--text', value: '#111111', purpose: 'Primary type and rules' },
          { name: '--muted', value: '#7A7A72', purpose: 'Secondary annotations' },
          { name: '--line', value: '#D8D4CA', purpose: 'Hairline separators' },
        ],
        layoutRules: [
          'Use a strict 12-column grid with no decorative overlap',
          'Keep metrics small but prominent through alignment',
          'Separate sections with thin horizontal rules',
        ],
        componentRules: [
          'Use border-only cards and mono metric labels',
          'Keep buttons rectangular and quiet',
          'Represent streams as thin lines or simple ticks, not glowing networks',
        ],
        responsiveRules: [
          'Collapse to a single editorial column on mobile',
          'Preserve metric readability with horizontal grouping before stacking',
        ],
      },
      handoffNotes: [
        'Let proof and precision carry the experience.',
        'Avoid decorative real-time clichés.',
        'This direction is best for credibility and enterprise trust.',
      ],
      imagePrompt: 'A restrained Swiss editorial technical landing page for realtime stream interactivity, near-monochrome, strict grid, thin rules, mono metrics, quiet API panel, no gradients.',
    };
  }

  if (mode === 'Direct') {
    return {
      mode,
      title: 'Every Stream, Live',
      concept: `A literal product-led page for ${subject}, showing how teams add realtime controls, reactions, data, and collaboration into live streams.`,
      designLanguage: {
        name: 'Realtime Product Console',
        summary: 'Practical developer-infrastructure landing page built around interface proof, API clarity, latency metrics, and use-case modules.',
        differentiators: [
          'Product UI and code shown together',
          'Metric-forward reliability proof',
          'Developer API section is a first-class page object',
          'Clear use-case cards for video, audio, data, and collaboration',
        ],
      },
      layout: 'Hero with live stream console mock, proof metrics underneath, API/code section, use-case grid, and conversion CTA.',
      palette: {
        background: '#FFFFFF',
        text: '#0D1117',
        primary: '#0057FF',
        secondary: '#5A6678',
        accent: '#00C2A8',
      },
      typography: 'Clear product sans for headings and body, developer mono for code blocks and latency numbers.',
      interactionMood: 'Fast, concrete, capable, and production-ready.',
      components: ['stream console hero', 'latency badges', 'API code block', 'use-case cards', 'reliability metric strip'],
      cssGuidance: {
        cssVariables: [
          { name: '--bg', value: '#FFFFFF', purpose: 'Clean product background' },
          { name: '--text', value: '#0D1117', purpose: 'Primary copy' },
          { name: '--primary', value: '#0057FF', purpose: 'Primary actions and highlights' },
          { name: '--accent', value: '#00C2A8', purpose: 'Live status and interactivity cues' },
        ],
        layoutRules: [
          'Anchor the page with a real product interface composition',
          'Place latency/reliability metrics directly near the hero claim',
          'Use repeatable card grids for use cases',
        ],
        componentRules: [
          'Buttons should be practical and verb-led',
          'API snippets need readable mono type and syntax color accents',
          'Use live-status dots, sliders, reactions, and chat overlays as specific interactivity proof',
        ],
        responsiveRules: [
          'Stack product UI below copy on mobile',
          'Keep code snippets horizontally scrollable rather than squeezed',
        ],
      },
      handoffNotes: [
        'This is the most straightforward conversion direction.',
        'Keep the page specific to realtime streams, not generic dev tools.',
        'Each visual module should explain a feature or proof point.',
      ],
      imagePrompt: 'A concrete developer infrastructure landing page for realtime interactivity in streams, product console mockup, code block, latency badges, clean white background, blue and teal accents.',
    };
  }

  return {
    mode,
    title: 'Live Signal Fair',
    concept: `A bold poster-like system for ${subject}, turning realtime stream interactivity into chunky signal modules, stickers, and broadcast-control-room energy.`,
    designLanguage: {
      name: 'Pop-Brutalist Broadcast Poster',
      summary: 'Playful but credible realtime infrastructure page with cream dotted paper, thick outlines, hot signal colors, sticker badges, dark ops bands, and flat illustrated stream objects.',
      differentiators: [
        'Cream dotted interface-paper field',
        'Thick black outlines and offset panels',
        'Sticker badges for live, latency, API, and reactions',
        'Dark navy operations band with chunky stream modules',
        'Flat illustrated signal tower, switcher, or stream control object',
      ],
    },
    layout: 'Poster hero with oversized claim and illustrated stream device, dark operations band, chunky feature cards, code sticker panel, and bright CTA footer.',
    palette: {
      background: '#F8F0DB',
      text: '#101321',
      primary: '#FF2D8A',
      secondary: '#10203F',
      accent: '#FFD21F',
    },
    typography: 'Chunky friendly display type for headlines, rounded sans for copy, mono for API stickers.',
    interactionMood: 'Alive, immediate, joyful, and technically confident.',
    components: ['sticker hero badge', 'outlined stream card', 'dark ops band', 'latency sticker', 'cartoon signal object', 'chunky API panel'],
    cssGuidance: {
      cssVariables: [
        { name: '--bg', value: '#F8F0DB', purpose: 'Cream dotted paper background' },
        { name: '--ink', value: '#101321', purpose: 'Text and thick outlines' },
        { name: '--pink', value: '#FF2D8A', purpose: 'Primary sticker accent' },
        { name: '--yellow', value: '#FFD21F', purpose: 'Hero highlight panels' },
        { name: '--navy', value: '#10203F', purpose: 'Dark operations band' },
      ],
      layoutRules: [
        'Use staggered poster composition with oversized headline type',
        'Add one dark navy operations band to contrast the cream field',
        'Let panels overlap slightly like stickers on a control-room wall',
      ],
      componentRules: [
        'Cards need thick black borders and rounded corners',
        'Use pill badges for live, latency, API, reactions, and sync',
        'Illustrations should be flat and symbolic, not photorealistic',
      ],
      responsiveRules: [
        'Stack poster panels but preserve sticker offsets on mobile',
        'Keep the hero object large enough to preserve personality',
      ],
    },
    handoffNotes: [
      'This is the boldest memory-building direction.',
      'Keep the engineering proof visible so it does not become childish.',
      'Use short, concrete copy and let the visual system carry momentum.',
    ],
    imagePrompt: request.unexpectedStyleHint || 'Playful pop-brutalist broadcast-control-room landing page for realtime stream interactivity with cream dotted paper, thick black outlines, sticker badges, dark navy band, hot signal colors, and flat illustrated stream hardware.',
  };
}

function hasBriefMaterial(request: DesignRequest, referenceImage?: ReferenceImage): boolean {
  return Boolean(
    request.direction?.trim()
    || request.designDirection?.trim()
    || request.imageUrl
    || request.imageDataUrl
    || referenceImage,
  );
}

function sanitizeImageSize(value?: string): string {
  const allowed = new Set(['1024x1024', '1024x1536', '1536x1024']);
  return value && allowed.has(value) ? value : DEFAULT_IMAGE_SIZE;
}

function sanitizeImageQuality(value?: string): string {
  const allowed = new Set(['low', 'medium', 'high', 'auto']);
  return value && allowed.has(value) ? value : DEFAULT_IMAGE_QUALITY;
}

function formatList(value: string[] | string | undefined): string {
  const list = normalizeStringList(value);
  return list.length ? list.join(', ') : '(none specified)';
}

function normalizeStringList(value: string[] | string | undefined): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function parseDataUrlMimeType(value: string): string | undefined {
  const match = /^data:([^;,]+)[;,]/.exec(value);
  return match?.[1];
}

function firstArrayItem(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : undefined;
}

function toBuffer(value: Uint8Array | ArrayBuffer | Buffer | string | undefined): Buffer {
  if (!value) return Buffer.alloc(0);
  if (Buffer.isBuffer(value)) return value;
  if (typeof value === 'string') return Buffer.from(value);
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}
