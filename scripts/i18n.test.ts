import { describe, expect, it } from 'vitest';
import { checkI18n } from './check-i18n';

describe('i18n completeness', () => {
  it('every key exists in EN, RU and KK; every error code and option is translated', () => {
    expect(checkI18n()).toEqual([]);
  });
});
