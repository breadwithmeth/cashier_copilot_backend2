import { describe, expect, it } from 'vitest';
import { detectProfanity } from '../src/common/utils/profanity.js';

describe('profanity detection', () => {
  it('detects profanity in cashier transcript text', () => {
    expect(detectProfanity('это плохой текст, блять').detected).toBe(true);
  });

  it('does not flag ordinary service phrases', () => {
    expect(detectProfanity('Здравствуйте. С вас пять тысяч четыреста тенге.').detected).toBe(false);
  });
});
