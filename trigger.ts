import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { TaskClient, decodeInlineArtifact, textPart } from '@blocks-network/sdk';
import type { ArtifactEvent, ProgressEvent } from '@blocks-network/sdk';

const OUTPUT_DIR = 'artifacts';

async function main() {
  const client = await TaskClient.create({
    billingMode: 'free',
    apiKey: process.env.BLOCKS_API_KEY!,
  });

  await mkdir(OUTPUT_DIR, { recursive: true });

  const request = {
    direction: "A site for a real-time software provider who offers 'Real-time interactivity for every stream'.",
    designDirection: 'Make content placement editorial in every design: headline/dek, narrative sections, proof pullouts, captions, sidebars, and paced story bands rather than generic dashboard grids.',
    brandName: 'Signalstream',
    siteType: 'B2B software landing page',
    audience: 'Streaming product teams, developer platform leaders, and broadcast engineering buyers',
    requiredElements: ['hero', 'latency proof', 'developer workflow', 'streaming use cases', 'CTA'],
    avoid: ['generic dashboard collage', 'AI gradient background', 'stock server room imagery'],
    variationStrength: 'strong',
    thirdStyleHint: 'Let the streaming and interactivity copy decide the third style, but keep the composition editorial.',
    imageSize: '1536x1024',
    imageQuality: 'medium',
  };

  const artifactWrites: Array<Promise<void>> = [];
  const session = await client.sendMessage({
    agentName: 'kiterae_flat_design_agent',
    requestParts: [textPart(JSON.stringify(request), 'request')],
  });

  console.log('Task created:', session.taskId);

  session.onProgress((event: ProgressEvent) => {
    console.log('[progress]', event.message ?? event.progress ?? '');
  });

  session.onArtifact((event: ArtifactEvent) => {
    const write = saveArtifact(session, event)
      .catch((error) => console.error('[artifact:error]', error));
    artifactWrites.push(write);
  });

  const terminal = await session.waitForTerminal(300_000);
  await Promise.allSettled(artifactWrites);

  console.log('[done]', terminal.state);
  session.close();
  client.destroy();
}

async function saveArtifact(
  session: Awaited<ReturnType<TaskClient['sendMessage']>>,
  event: ArtifactEvent,
): Promise<void> {
  const ref = event.artifactRef;
  const refRecord = ref as unknown as Record<string, unknown>;
  const outputId = typeof refRecord.outputId === 'string' ? refRecord.outputId : 'artifact';
  const defaultName = `${outputId}-${Date.now()}`;

  if (ref.kind === 'inline' && ref.data) {
    const bytes = decodeInlineArtifact(ref);
    const fileName = typeof refRecord.fileName === 'string' ? refRecord.fileName : defaultName;
    const path = join(OUTPUT_DIR, fileName);
    await writeFile(path, bytes);
    console.log('[artifact]', path);
    return;
  }

  const downloaded = await session.downloadArtifact(ref);
  const downloadedRecord = downloaded as unknown as Record<string, unknown>;
  const fileName = typeof downloadedRecord.fileName === 'string'
    ? downloadedRecord.fileName
    : typeof refRecord.fileName === 'string'
      ? refRecord.fileName
      : defaultName;
  const path = join(OUTPUT_DIR, fileName);
  await writeFile(path, downloaded.data);
  console.log('[artifact]', path);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
