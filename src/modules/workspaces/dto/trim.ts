import type { TransformFnParams } from 'class-transformer';

/** Trims string input before validation so whitespace-only values fail IsNotEmpty. */
export const trim = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.trim() : value;
