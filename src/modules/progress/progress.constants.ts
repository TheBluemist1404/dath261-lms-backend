// progress.constants.ts
import { BlockType } from '../../generated/prisma/client.js';

export const TRACKED_BLOCK_TYPES: BlockType[] = [
  BlockType.TEXT,
  BlockType.FILE,
  BlockType.VIDEO,
  BlockType.QUIZ,
  BlockType.ASSIGNMENT,
];

export const MANUALLY_COMPLETABLE_TYPES: BlockType[] = [
  BlockType.TEXT,
  BlockType.FILE,
  BlockType.VIDEO,
];

export const RESUMABLE_BLOCK_TYPES = TRACKED_BLOCK_TYPES;
