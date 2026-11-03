import { BlockType } from '../../../generated/prisma/enums.js';

export type ResumableBlockType =
  | typeof BlockType.TEXT
  | typeof BlockType.FILE
  | typeof BlockType.VIDEO
  | typeof BlockType.QUIZ
  | typeof BlockType.ASSIGNMENT;

export type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];

export type JsonObject = {
  [key: string]: JsonValue;
};

export type ResumeData = {
  version: 1;
  type: ResumableBlockType;
  data: JsonObject;
};
