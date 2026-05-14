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
          'layout',
          'palette',
          'typography',
          'interactionMood',
          'components',
          'handoffNotes',
          'imagePrompt',
        ],
        properties: {
          mode: { type: 'string', enum: ['Restrained', 'Direct', 'Unexpected'] },
          title: { type: 'string' },
          concept: { type: 'string' },
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
              'Restrained: near-monochrome, Swiss/Bauhaus reduction, typography does most of the work, quietest useful reading.',
              'Direct: literal interpretation of the brief with specificity and conviction, no generic category clichés.',
              'Unexpected: choose one word or implied mood and push it into a bolder palette and unconventional layout.',
              'Honor explicit design direction, hard constraints, audience, and supplied reference imagery.',
              'These are flat website designs intended to become fleshed-out websites, so focus on layout, palette, typography, components, and implementation handoff notes.',
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
  return {
    ...parsed,
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
    `Layout: ${design.layout}.`,
    `Palette: background ${design.palette.background}, text ${design.palette.text}, primary ${design.palette.primary}, secondary ${design.palette.secondary}, accent ${design.palette.accent}.`,
    `Typography: ${design.typography}.`,
    `Components to show: ${design.components.join(', ')}.`,
    `Mood: ${design.interactionMood}.`,
    `Specific art direction: ${design.imagePrompt}`,
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
  return order.map((mode) => {
    const design = designs.find((item) => item.mode === mode);
    if (!design) throw new Error(`Missing ${mode} design concept.`);
    return design;
  });
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
