import type { HandlerResult, StartTaskMessage, TaskContext } from '@blocks-network/sdk';

type LensMode = 'Direct Minimalist' | 'Maximalist' | 'Copy-Led Style';

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
  thirdStyleHint?: string;
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

type CopyLedFallbackStyle = {
  title: string;
  name: string;
  summary: string;
  differentiators: string[];
  concept: (subject: string, context: string) => string;
  layout: string;
  palette: FlatDesign['palette'];
  typography: string;
  interactionMood: string;
  components: string[];
  cssVariables: FlatDesign['cssGuidance']['cssVariables'];
  layoutRules: string[];
  componentRules: string[];
  responsiveRules: string[];
  handoffNotes: string[];
  imagePrompt: (subject: string, context: string) => string;
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
      minItems: 3,
      maxItems: 3,
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
          mode: { type: 'string', enum: ['Direct Minimalist', 'Maximalist', 'Copy-Led Style'] },
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

  ctx?.reportStatus('Creating three website design directions...');
  const spec = await createDesignSpec(request, referenceImage, ctx);

  const orderedDesigns = orderDesigns(spec.designs);
  const imageArtifacts = [];
  const generatedImages: GeneratedImage[] = [];

  for (const design of orderedDesigns) {
    ctx?.reportStatus(`Generating ${design.mode} preview image...`);
    const prompt = buildImagePrompt(design, request);
    const image = await generatePreviewImage(prompt, request, ctx);
    const outputId = `${outputIdForMode(design.mode)}_preview`;
    const fileName = `${slugify(design.mode)}-website-design.png`;

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
        fileName: 'site-design-concepts.json',
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
    'thirdStyleHint',
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
              'You are a senior web art director creating website design concepts.',
              'Return exactly three concepts in this order: Direct Minimalist, Maximalist, Copy-Led Style.',
              'The three concepts must be fundamentally different design languages, not siblings with small palette/layout changes.',
              'Each concept needs a named design language, visual grammar, CSS tokens, layout rules, component rules, responsive rules, and image prompt.',
              'Direct Minimalist: the most direct, clearest, least-decorated expression of the brief. Use minimalism as a functional discipline: obvious navigation, concise hierarchy, direct copy placement, restrained color, strong whitespace, and only the imagery/components needed to sell the idea.',
              'Maximalist: an abundant, expressive, high-density interpretation of the same brief. Push color, pattern, scale shifts, layered modules, expressive type, rich imagery or illustration, and a stronger sense of spectacle while keeping the page usable and commercially coherent.',
              'Copy-Led Style: read the supplied copy and choose one distinct design style that the language naturally suggests. Choose from styles such as editorial, highly visual/immersive, brutalist, Swiss/international, luxury minimal, SaaS/product UI, experimental/art-directed, retro/nostalgic, or expose/reveal. Do not choose generic minimalism or maximalism for this third concept.',
              'For Copy-Led Style, explicitly name the chosen style in designLanguage.name and explain why the copy pulled you there in the summary or differentiators.',
              'Honor explicit design direction, hard constraints, audience, and supplied reference imagery.',
              'If the user supplies a third-style hint, use it as a bias for Copy-Led Style only when it fits the copy and constraints.',
              'These are website designs intended to become fleshed-out websites, so focus on layout, palette, typography, components, CSS/site guidance, and implementation handoff notes.',
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
        name: 'website_design_concepts',
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
    `Copy-led third style hint: ${request.thirdStyleHint || request.unexpectedStyleHint || '(none supplied; choose the style from the copy)'}`,
    `Reference image: ${referenceImage ? `provided as ${referenceImage.source}` : 'not provided'}`,
  ];

  return lines.join('\n');
}

function buildImagePrompt(design: FlatDesign, request: DesignRequest): string {
  return [
    'Create a polished website design mockup that could be used as the visual foundation for a production website.',
    'Do not include browser chrome, device frames, 3D perspective, photorealistic stock imagery, watermarks, or explanatory annotations.',
    'Use crisp UI geometry, strong spacing, realistic web sections, and abstract text blocks instead of long readable copy.',
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
    design.mode === 'Direct Minimalist'
      ? 'For this Direct Minimalist version, make the design feel like the shortest honest path from visitor intent to understanding: sparse, precise, obvious, and visually calm.'
      : '',
    design.mode === 'Maximalist'
      ? 'For this Maximalist version, make the design abundant and memorable: layered compositions, expressive typography, high visual density, rich modules, vivid contrast, and energetic section pacing while keeping hierarchy clear.'
      : '',
    design.mode === 'Copy-Led Style'
      ? 'For this Copy-Led Style version, make the selected design style unmistakable and connected to the copy. It must feel unlike the direct minimalist and maximalist versions.'
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
    '# Website Design Guidance',
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
  const order = designModeOrder();
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

  throw new Error('Expected three design concepts in order: Direct Minimalist, Maximalist, Copy-Led Style.');
}

function completeDesigns(designs: FlatDesign[], request: DesignRequest): FlatDesign[] {
  const order = designModeOrder();
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

  if (mode === 'Direct Minimalist') {
    return {
      mode,
      title: 'Shortest Path',
      concept: `The most direct interpretation of ${subject}, using plain hierarchy, decisive whitespace, and only the sections needed to make ${context} understandable and credible.`,
      designLanguage: {
        name: 'Direct Minimalist',
        summary: 'A stripped-back, content-first system where hierarchy, spacing, and clear calls to action do the work before decoration appears.',
        differentiators: [
          'Minimal palette with one useful accent',
          'Obvious page flow and navigation',
          'Large whitespace fields',
          'Plain proof points instead of ornamental modules',
        ],
      },
      layout: 'A clean hero with one primary action, compact proof strip, essential content sections, focused feature blocks, and a quiet conversion footer.',
      palette: {
        background: '#FAFAF7',
        text: '#111111',
        primary: '#111111',
        secondary: '#6E746F',
        accent: '#B7C8FF',
      },
      typography: 'A neutral sans with crisp weight contrast, short line lengths, and restrained mono labels only when the content benefits from them.',
      interactionMood: 'Calm, efficient, direct, and self-evident.',
      components: ['minimal hero', 'proof strip', 'essential feature list', 'focused content module', 'quiet CTA footer'],
      cssGuidance: {
        cssVariables: [
          { name: '--bg', value: '#FAFAF7', purpose: 'Soft page background' },
          { name: '--text', value: '#111111', purpose: 'Primary type and borders' },
          { name: '--muted', value: '#6E746F', purpose: 'Secondary copy' },
          { name: '--accent', value: '#B7C8FF', purpose: 'Single purposeful emphasis color' },
          { name: '--line', value: '#DEDED7', purpose: 'Subtle dividers' },
        ],
        layoutRules: [
          'Use a simple grid with generous spacing and a narrow readable measure',
          'Keep every section tied to a clear user decision or proof point',
          'Avoid decorative overlap and redundant cards',
        ],
        componentRules: [
          'Use quiet buttons with strong labels',
          'Prefer text-led modules over illustration-led modules',
          'Use borders and spacing before shadows or effects',
        ],
        responsiveRules: [
          'Collapse to one column early and preserve whitespace',
          'Keep CTAs visible without repeating them aggressively',
        ],
      },
      handoffNotes: [
        'Use this when clarity and conversion matter most.',
        'Cut anything that does not explain, prove, or move the visitor forward.',
        'The design should feel edited, not empty.',
      ],
      imagePrompt: `A direct minimalist ${context} for ${subject}, calm whitespace, restrained palette, clear hero, concise proof points, simple content sections, no decorative clutter.`,
    };
  }

  if (mode === 'Maximalist') {
    return {
      mode,
      title: 'Everything In Motion',
      concept: `An expressive maximalist interpretation of ${subject}, turning the full promise of ${context} into layered content, rich color, rhythmic sections, and high-energy visual proof.`,
      designLanguage: {
        name: 'Commercial Maximalist System',
        summary: 'A dense, colorful, image-rich page language with layered panels, large type, mixed content modules, badges, patterns, and strong emotional pacing.',
        differentiators: [
          'Layered modules and overlapping content moments',
          'Expressive scale shifts in type and imagery',
          'Pattern, color, and badges used as brand memory',
          'A page rhythm that feels abundant without losing scanability',
        ],
      },
      layout: 'A large kinetic hero, dense benefit wall, mixed-media story band, feature clusters, social proof collage, and high-contrast CTA finale.',
      palette: {
        background: '#FFF4D6',
        text: '#10121A',
        primary: '#E83E70',
        secondary: '#154B8B',
        accent: '#26B99A',
      },
      typography: 'A bold display face for headlines, a highly readable sans for dense modules, and occasional condensed labels for editorial punch.',
      interactionMood: 'Abundant, confident, energetic, and memorable.',
      components: ['layered hero', 'badge cluster', 'feature collage', 'story band', 'proof mosaic', 'high-contrast CTA'],
      cssGuidance: {
        cssVariables: [
          { name: '--bg', value: '#FFF4D6', purpose: 'Warm maximalist field' },
          { name: '--ink', value: '#10121A', purpose: 'Primary text and strong outlines' },
          { name: '--primary', value: '#E83E70', purpose: 'Major emphasis and CTA color' },
          { name: '--secondary', value: '#154B8B', purpose: 'Deep contrast sections' },
          { name: '--accent', value: '#26B99A', purpose: 'Secondary highlights and badges' },
        ],
        layoutRules: [
          'Use asymmetrical grids with controlled overlaps',
          'Alternate dense content bands with simpler breathing sections',
          'Let imagery, stats, quotes, and feature modules coexist in the hero and mid-page',
        ],
        componentRules: [
          'Use badges, ribbons, patterned panels, and expressive buttons',
          'Give repeated cards stable sizing so density does not become chaos',
          'Use color blocks and section headers to preserve hierarchy',
        ],
        responsiveRules: [
          'Stack collages into ordered content groups on mobile',
          'Reduce overlaps on narrow screens but preserve color and typographic energy',
        ],
      },
      handoffNotes: [
        'Use this when the brand needs energy, memorability, and breadth.',
        'Keep every decorative device attached to a content job.',
        'Audit mobile carefully so high density remains intentional.',
      ],
      imagePrompt: `A maximalist ${context} for ${subject}, layered colorful website composition, expressive typography, dense feature modules, badges, rich imagery, strong commercial hierarchy.`,
    };
  }

  const style = inferCopyLedStyle(request);

  return {
    mode,
    title: style.title,
    concept: style.concept(subject, context),
    designLanguage: {
      name: style.name,
      summary: style.summary,
      differentiators: style.differentiators,
    },
    layout: style.layout,
    palette: style.palette,
    typography: style.typography,
    interactionMood: style.interactionMood,
    components: style.components,
    cssGuidance: {
      cssVariables: style.cssVariables,
      layoutRules: style.layoutRules,
      componentRules: style.componentRules,
      responsiveRules: style.responsiveRules,
    },
    handoffNotes: style.handoffNotes,
    imagePrompt: request.thirdStyleHint || request.unexpectedStyleHint || style.imagePrompt(subject, context),
  };
}

function designModeOrder(): LensMode[] {
  return ['Direct Minimalist', 'Maximalist', 'Copy-Led Style'];
}

function outputIdForMode(mode: LensMode): string {
  return slugify(mode).replace(/-/g, '_');
}

function inferCopyLedStyle(request: DesignRequest): CopyLedFallbackStyle {
  const copy = [
    request.direction,
    request.designDirection,
    request.brandName,
    request.productName,
    request.siteType,
    request.audience,
    formatList(request.requiredElements),
  ].filter(Boolean).join(' ').toLowerCase();

  const has = (...terms: string[]) => terms.some((term) => copy.includes(term));

  if (has('transparent', 'process', 'behind', 'inside', 'proof', 'audit', 'supply', 'ingredient', 'workshop', 'studio', 'craft', 'material')) {
    return exposeRevealStyle();
  }

  if (has('developer', 'api', 'platform', 'dashboard', 'saas', 'b2b', 'enterprise', 'workflow', 'operations', 'analytics', 'infrastructure', 'automation')) {
    return productUiStyle();
  }

  if (has('photo', 'visual', 'gallery', 'portfolio', 'travel', 'hotel', 'restaurant', 'fashion', 'film', 'artist', 'venue', 'space', 'architecture', 'collection')) {
    return immersiveVisualStyle();
  }

  if (has('retro', 'nostalgia', 'vintage', 'arcade', 'y2k', '90s', 'eighties', 'seventies')) {
    return retroNostalgicStyle();
  }

  if (has('manifesto', 'urgent', 'radical', 'underground', 'festival', 'zine', 'street', 'activist', 'experimental')) {
    return brutalistStyle();
  }

  return editorialStyle();
}

function editorialStyle(): CopyLedFallbackStyle {
  return {
    title: 'Editorial Argument',
    name: 'Editorial Story System',
    summary: 'The copy reads like it needs sequence, emphasis, and persuasion, so this direction uses magazine pacing, strong article-like type, and content blocks that make the argument feel authored.',
    differentiators: [
      'Magazine-style typographic pacing',
      'Pull quotes and story beats as primary components',
      'A clear narrative section order',
      'Visual restraint with more personality than the direct minimalist option',
    ],
    concept: (subject, context) => `A magazine-like ${context} for ${subject}, letting the copy unfold as a persuasive editorial story rather than a simple product page.`,
    layout: 'A bold headline spread, narrative intro, proof pull quote, modular story sections, image or diagram feature, and an editorial CTA close.',
    palette: {
      background: '#F4F1EA',
      text: '#161616',
      primary: '#8D2433',
      secondary: '#315A63',
      accent: '#DDAA4A',
    },
    typography: 'Editorial serif for major headlines, precise sans for navigation and captions, generous body type for longer copy.',
    interactionMood: 'Considered, literary, paced, and persuasive.',
    components: ['headline spread', 'pull quote', 'chapter label', 'feature image band', 'evidence sidebar', 'editorial CTA'],
    cssVariables: [
      { name: '--bg', value: '#F4F1EA', purpose: 'Editorial paper background' },
      { name: '--ink', value: '#161616', purpose: 'Primary reading color' },
      { name: '--primary', value: '#8D2433', purpose: 'Editorial emphasis' },
      { name: '--secondary', value: '#315A63', purpose: 'Secondary section contrast' },
      { name: '--accent', value: '#DDAA4A', purpose: 'Small highlight moments' },
    ],
    layoutRules: [
      'Use section pacing like an article with clear beginning, middle, and conversion close',
      'Let large type and pull quotes break the rhythm of denser copy',
      'Keep imagery full-width or inline with captions rather than trapped in repeated cards',
    ],
    componentRules: [
      'Use chapter labels, captions, and quote blocks as reusable content furniture',
      'Keep CTAs editorial and confident rather than loud',
      'Use rules and columns to organize longer text without making it feel like a blog post',
    ],
    responsiveRules: [
      'Collapse multi-column story sections into a single strong reading column',
      'Keep pull quotes shorter on mobile and place them between sections',
    ],
    handoffNotes: [
      'This fallback is strongest when the copy has a clear argument or story.',
      'Use art direction to create authority without becoming visually quiet.',
      'Avoid generic magazine tropes; tie every editorial device to a message beat.',
    ],
    imagePrompt: (subject, context) => `An editorial website design for ${subject}, ${context}, magazine pacing, strong serif headline, pull quotes, story sections, warm paper background, refined color accents.`,
  };
}

function immersiveVisualStyle(): CopyLedFallbackStyle {
  return {
    title: 'Immersive Visual Field',
    name: 'Highly Visual Immersive',
    summary: 'The copy points toward mood, place, object, or collection, so this direction makes imagery and atmosphere the first-order structure while keeping the site navigable.',
    differentiators: [
      'Large image or media fields drive the first viewport',
      'Copy appears as concise overlays and captions',
      'Sections feel cinematic rather than card-based',
      'Strong contrast between immersive scenes and precise product/content detail',
    ],
    concept: (subject, context) => `A highly visual ${context} for ${subject}, using immersive imagery, dramatic cropping, and concise overlay copy to make the visitor feel the subject before analyzing it.`,
    layout: 'Full-bleed visual hero, caption-like proof line, large media sequence, detail panels, gallery strip, and quiet conversion close.',
    palette: {
      background: '#101010',
      text: '#F7F2E8',
      primary: '#F7F2E8',
      secondary: '#46686A',
      accent: '#E2A64E',
    },
    typography: 'Elegant sans or serif pair with large atmospheric display lines and small cinematic captions.',
    interactionMood: 'Immersive, sensory, cinematic, and refined.',
    components: ['full-bleed hero', 'image caption overlay', 'media sequence', 'detail panel', 'gallery strip', 'quiet CTA'],
    cssVariables: [
      { name: '--bg', value: '#101010', purpose: 'Immersive dark field' },
      { name: '--text', value: '#F7F2E8', purpose: 'Primary text over dark media' },
      { name: '--primary', value: '#F7F2E8', purpose: 'Light foreground elements' },
      { name: '--secondary', value: '#46686A', purpose: 'Muted atmospheric panels' },
      { name: '--accent', value: '#E2A64E', purpose: 'Warm focal highlights' },
    ],
    layoutRules: [
      'Use full-width media bands instead of small decorative thumbnails',
      'Pair each visual moment with one concise message',
      'Let product or content detail emerge after the immersive hero',
    ],
    componentRules: [
      'Use translucent overlays only when they preserve readability',
      'Keep buttons high-contrast and simple on visual backgrounds',
      'Use captions as intentional UI elements, not afterthoughts',
    ],
    responsiveRules: [
      'Crop media intentionally for mobile with stable aspect ratios',
      'Move overlay copy below imagery when contrast or space breaks down',
    ],
    handoffNotes: [
      'Use real or generated imagery that reveals the actual subject.',
      'Avoid vague atmospheric visuals when the user needs to inspect the offer.',
      'This direction lives or dies on image quality.',
    ],
    imagePrompt: (subject, context) => `A highly visual immersive ${context} for ${subject}, full-bleed image-led hero, cinematic sections, elegant overlay typography, refined dark field, strong visual storytelling.`,
  };
}

function productUiStyle(): CopyLedFallbackStyle {
  return {
    title: 'Working Surface',
    name: 'SaaS Product UI',
    summary: 'The copy sounds operational and capability-driven, so this direction makes the interface, workflow, metrics, and repeated use cases the design language.',
    differentiators: [
      'Product surface appears in the hero',
      'Workflow and metrics are visible before broad brand storytelling',
      'Dense but organized modules support repeated scanning',
      'Utility and trust matter more than spectacle',
    ],
    concept: (subject, context) => `A pragmatic product-led ${context} for ${subject}, built around interface proof, workflow clarity, and practical decision-making.`,
    layout: 'Interface hero, metric strip, workflow steps, feature table, use-case modules, and conversion CTA tied to a practical action.',
    palette: {
      background: '#F6F8FA',
      text: '#101828',
      primary: '#2563EB',
      secondary: '#475467',
      accent: '#16A34A',
    },
    typography: 'Clean product sans for headings and body, compact mono for metrics, code, or system labels.',
    interactionMood: 'Capable, organized, efficient, and production-ready.',
    components: ['product interface hero', 'metric strip', 'workflow stepper', 'feature table', 'use-case grid', 'practical CTA'],
    cssVariables: [
      { name: '--bg', value: '#F6F8FA', purpose: 'Quiet product background' },
      { name: '--text', value: '#101828', purpose: 'Primary interface text' },
      { name: '--primary', value: '#2563EB', purpose: 'Primary actions and links' },
      { name: '--secondary', value: '#475467', purpose: 'Secondary copy and labels' },
      { name: '--accent', value: '#16A34A', purpose: 'Success, live, or progress indicators' },
    ],
    layoutRules: [
      'Anchor the page with a credible product UI composition',
      'Use tables, lists, and compact modules where they clarify comparison',
      'Place metrics near claims so proof and promise stay connected',
    ],
    componentRules: [
      'Use familiar controls, tabs, toggles, tables, and status pills',
      'Keep repeated cards dense but aligned',
      'Make CTAs direct and task-based',
    ],
    responsiveRules: [
      'Stack interface regions while preserving labels and status clarity',
      'Let wide tables scroll horizontally instead of crushing content',
    ],
    handoffNotes: [
      'This works best for technical, operational, or B2B copy.',
      'Avoid turning it into a marketing hero with decorative dashboard fragments.',
      'Every UI fragment should demonstrate a real capability.',
    ],
    imagePrompt: (subject, context) => `A SaaS product UI website design for ${subject}, ${context}, product interface hero, workflow modules, metrics, tables, clean product styling, blue and green accents.`,
  };
}

function exposeRevealStyle(): CopyLedFallbackStyle {
  return {
    title: 'Open Process',
    name: 'Expose / Reveal',
    summary: 'The copy suggests process, proof, materials, or transparency, so this direction exposes the making: layers, annotations, evidence, and behind-the-scenes structure become the visual system.',
    differentiators: [
      'Annotations and layer callouts are part of the page language',
      'Process evidence is shown instead of hidden behind polished claims',
      'Materials, steps, or provenance become navigational anchors',
      'The design feels transparent without becoming unfinished',
    ],
    concept: (subject, context) => `A reveal-based ${context} for ${subject}, showing the process, ingredients, proof, or construction logic as the main source of trust.`,
    layout: 'Annotated hero, process timeline, layered proof section, materials or evidence grid, behind-the-scenes detail panel, and trust-focused CTA.',
    palette: {
      background: '#F8F6EF',
      text: '#171717',
      primary: '#C84C31',
      secondary: '#2F5D62',
      accent: '#E0B84F',
    },
    typography: 'Readable sans for primary copy, technical mono for annotations, restrained display type for section labels.',
    interactionMood: 'Transparent, tactile, evidence-led, and curious.',
    components: ['annotated hero', 'process timeline', 'layer callout', 'materials grid', 'evidence panel', 'trust CTA'],
    cssVariables: [
      { name: '--bg', value: '#F8F6EF', purpose: 'Warm process-document field' },
      { name: '--ink', value: '#171717', purpose: 'Primary copy and annotation lines' },
      { name: '--primary', value: '#C84C31', purpose: 'Callouts and process emphasis' },
      { name: '--secondary', value: '#2F5D62', purpose: 'Deep supporting panels' },
      { name: '--accent', value: '#E0B84F', purpose: 'Material and proof highlights' },
    ],
    layoutRules: [
      'Show the visitor what is usually hidden: steps, layers, materials, decisions, or evidence',
      'Use annotation lines and numbered markers sparingly but consistently',
      'Balance exposed process with polished hierarchy so the site still feels intentional',
    ],
    componentRules: [
      'Use callout labels, process chips, and before-after panels',
      'Make proof modules concrete and visually tied to the relevant claim',
      'Keep buttons simple so annotations remain the distinctive device',
    ],
    responsiveRules: [
      'Convert complex annotations into stacked callouts on mobile',
      'Keep timelines readable with clear vertical rhythm',
    ],
    handoffNotes: [
      'This is the right fallback when trust depends on showing the work.',
      'Use actual process details from the copy whenever possible.',
      'Do not fake transparency with empty annotations.',
    ],
    imagePrompt: (subject, context) => `An expose reveal website design for ${subject}, ${context}, annotated hero, process layers, callout lines, evidence modules, warm document-like palette, transparent making-focused structure.`,
  };
}

function retroNostalgicStyle(): CopyLedFallbackStyle {
  return {
    title: 'Memory Signal',
    name: 'Retro / Nostalgic',
    summary: 'The copy carries nostalgic or time-coded language, so this direction borrows period cues while keeping modern accessibility and layout discipline.',
    differentiators: [
      'Period-inspired color and type cues',
      'Modern grid discipline underneath the nostalgia',
      'Chunky modules, stamps, or interface references',
      'Memory and playfulness without unreadable novelty',
    ],
    concept: (subject, context) => `A retro-inflected ${context} for ${subject}, using nostalgia as an emotional hook while preserving modern clarity and conversion flow.`,
    layout: 'Bold nostalgic hero, stamp-like proof strip, chunky feature blocks, archive or catalog section, and bright CTA footer.',
    palette: {
      background: '#F5E7C8',
      text: '#241B16',
      primary: '#D84A2B',
      secondary: '#315C88',
      accent: '#E6B800',
    },
    typography: 'Warm display type with vintage character, paired with a clean sans for modern readability.',
    interactionMood: 'Nostalgic, warm, playful, and familiar.',
    components: ['retro hero', 'stamp badge', 'catalog block', 'chunky feature card', 'archive strip', 'bright CTA'],
    cssVariables: [
      { name: '--bg', value: '#F5E7C8', purpose: 'Aged paper background' },
      { name: '--ink', value: '#241B16', purpose: 'Primary retro text' },
      { name: '--primary', value: '#D84A2B', purpose: 'Warm action color' },
      { name: '--secondary', value: '#315C88', purpose: 'Cool contrast blocks' },
      { name: '--accent', value: '#E6B800', purpose: 'Nostalgic highlight color' },
    ],
    layoutRules: [
      'Use vintage-inspired section framing without sacrificing modern spacing',
      'Bring nostalgia into badges, labels, and color before over-styling body text',
      'Keep the conversion path obvious beneath the expressive surface',
    ],
    componentRules: [
      'Use stamps, catalog panels, chunky borders, and period-coded labels',
      'Avoid faux aged textures that reduce legibility',
      'Keep forms and buttons modern enough to trust',
    ],
    responsiveRules: [
      'Reduce decorative label density on mobile',
      'Keep display type from crowding the viewport',
    ],
    handoffNotes: [
      'Use nostalgia as tone, not costume.',
      'Pair period references with concrete modern product proof.',
      'Check contrast carefully when using muted retro colors.',
    ],
    imagePrompt: (subject, context) => `A retro nostalgic website design for ${subject}, ${context}, warm vintage palette, chunky catalog sections, stamp badges, modern readable layout, playful memory-driven design.`,
  };
}

function brutalistStyle(): CopyLedFallbackStyle {
  return {
    title: 'Raw Signal',
    name: 'Brutalist Web',
    summary: 'The copy has urgency, edge, or manifesto energy, so this direction uses raw hierarchy, hard contrast, exposed structure, and intentionally blunt composition.',
    differentiators: [
      'Hard contrast and unapologetic type scale',
      'Visible grid, borders, and raw section breaks',
      'Minimal polish but strong intent',
      'A direct attitude that feels cultural rather than corporate',
    ],
    concept: (subject, context) => `A brutalist ${context} for ${subject}, turning urgency and attitude in the copy into hard-edged layout, raw structure, and sharp visual confidence.`,
    layout: 'Huge blunt hero, split proof blocks, raw navigation strip, hard-border feature grid, manifesto section, and stark CTA close.',
    palette: {
      background: '#F2F2EA',
      text: '#050505',
      primary: '#F23B2F',
      secondary: '#111827',
      accent: '#D4FF3F',
    },
    typography: 'Heavy grotesk or condensed display type, plain sans body, and mono labels for raw utility.',
    interactionMood: 'Blunt, confrontational, fast, and culturally sharp.',
    components: ['blunt hero', 'raw nav strip', 'hard-border grid', 'manifesto block', 'proof slab', 'stark CTA'],
    cssVariables: [
      { name: '--bg', value: '#F2F2EA', purpose: 'Raw page field' },
      { name: '--ink', value: '#050505', purpose: 'High-contrast text and borders' },
      { name: '--primary', value: '#F23B2F', purpose: 'Aggressive action accent' },
      { name: '--secondary', value: '#111827', purpose: 'Dark contrast slabs' },
      { name: '--accent', value: '#D4FF3F', purpose: 'Electric highlight' },
    ],
    layoutRules: [
      'Use hard section breaks, visible borders, and asymmetry',
      'Let large type create tension and pace',
      'Keep content order direct even when the composition is raw',
    ],
    componentRules: [
      'Use simple rectangular controls and strong hover states',
      'Avoid decorative softness, shadows, and polished card stacks',
      'Make labels and proof points feel posted, stamped, or declared',
    ],
    responsiveRules: [
      'Keep huge type responsive with fixed max sizes rather than viewport scaling',
      'Stack raw blocks in an intentional reading order on mobile',
    ],
    handoffNotes: [
      'This only works when the brand can carry edge.',
      'Use restraint in copy length; brutalist layouts punish verbosity.',
      'Accessibility matters more because contrast and scale are extreme.',
    ],
    imagePrompt: (subject, context) => `A brutalist website design for ${subject}, ${context}, hard black borders, huge blunt typography, raw grid, stark contrast, electric accent, manifesto-like section pacing.`,
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
