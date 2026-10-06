import { describe, expect, it } from 'vitest';
import {
  formatPhoneMask, passwordChecks, sanitizeGpaInput, validateBin, validateCity, validateCompanyName, validateDescription,
  validateGpa, validateGraduation, validatePassword, validatePersonName, validatePhone, validateSduEmail, validateStudentId,
  validateTag, validateTags, validateWebsite, validateWorkEmail, validateStudentRegistration, validateEmployerRegistration,
  validateConfirmPassword,
} from '../src';

const NOW = new Date('2026-10-05T10:00:00Z');
const code = (r: { ok: boolean; code?: string }) => (r.ok ? 'OK' : r.code);

describe('Student ID', () => {
  it.each([
    ['230107010', 'OK'], ['000123456', 'OK'], [' 230107010 ', 'OK'],
    ['', 'REQUIRED'], ['   ', 'REQUIRED'], ['​', 'REQUIRED'], [undefined, 'REQUIRED'], [null, 'REQUIRED'],
    ['23010701', 'STUDENT_ID_INVALID'], ['2301070100', 'STUDENT_ID_INVALID'], ['23010701a', 'STUDENT_ID_INVALID'],
    ['2301 07010', 'STUDENT_ID_INVALID'], ['230-107-010', 'STUDENT_ID_INVALID'],
    ['٢٣٠١٠٧٠١٠', 'STUDENT_ID_INVALID'], // Arabic-Indic digits
    ['２３０１０７０１０', 'STUDENT_ID_INVALID'], // full-width digits
    ['230107010\n', 'OK'], ['23010\n7010', 'STUDENT_ID_INVALID'], [230107010, 'STUDENT_ID_INVALID'], [['230107010'], 'STUDENT_ID_INVALID'],
    ["' OR 1=1 --", 'STUDENT_ID_INVALID'], ['1'.repeat(10_000), 'STUDENT_ID_INVALID'],
  ])('%j → %s', (v, expected) => expect(code(validateStudentId(v))).toBe(expected));
  it('keeps leading zeros (string)', () => expect(validateStudentId('000123456')).toEqual({ ok: true, value: '000123456' }));
});

describe('Names', () => {
  it.each([
    ['Aigerim', 'OK'], ['Серік', 'OK'], ['Әсел', 'OK'], ['Қуаныш', 'OK'], ['Ғабит', 'OK'], ['Өмірзақ', 'OK'], ['Çağan', 'OK'],
    ['A', 'NAME_TOO_SHORT'], ['', 'REQUIRED'], ['   ', 'REQUIRED'], ['​​', 'REQUIRED'],
    ['A'.repeat(51), 'NAME_TOO_LONG'], ['A'.repeat(10_000), 'NAME_TOO_LONG'],
    ['Ali1', 'NAME_INVALID_CHARS'], ['Ali-Baba', 'NAME_INVALID_CHARS'], ['Ali Baba', 'NAME_INVALID_CHARS'], ["O'Neil", 'NAME_INVALID_CHARS'],
    ['Ali😀', 'NAME_INVALID_CHARS'], ['<script>', 'NAME_INVALID_CHARS'], ['<img onerror=x>', 'NAME_INVALID_CHARS'],
    ['Аlі', 'NAME_INVALID_CHARS'], // Latin "A"+Cyrillic mix → look-alike
    ['Ａｌｉ', 'NAME_INVALID_CHARS'], // full-width Latin
    ['Al​i', 'NAME_INVALID_CHARS'], // zero-width inside
    ['‮ilа', 'NAME_INVALID_CHARS'], // RTL override
    ['علي', 'NAME_INVALID_CHARS'], ['Alí', 'OK'], // combining accent normalizes to Alí
    ["'; DROP TABLE users;--", 'NAME_INVALID_CHARS'], [123, 'NAME_INVALID_CHARS'], ['×÷', 'NAME_INVALID_CHARS'],
  ])('%j → %s', (v, expected) => expect(code(validatePersonName(v))).toBe(expected));
  it('capitalizes first letter, trims', () => expect(validatePersonName('  aIgERIM ')).toEqual({ ok: true, value: 'Aigerim' }));
});

describe('SDU email', () => {
  it.each([
    ['a@sdu.edu.kz', 'OK'], ['Ali.S@SDU.EDU.KZ', 'OK'], ['230107010@sdu.edu.kz', 'OK'], ['a_b-c.d@sdu.edu.kz', 'OK'], [' x1@sdu.edu.kz ', 'OK'],
    ['', 'REQUIRED'], ['   ', 'REQUIRED'], ['@sdu.edu.kz', 'EMAIL_INVALID'], ['sdu.edu.kz', 'EMAIL_INVALID'],
    ['a@@sdu.edu.kz', 'EMAIL_INVALID'], ['a@b@sdu.edu.kz', 'EMAIL_INVALID'], ['a b@sdu.edu.kz', 'EMAIL_INVALID'],
    ['a@sdu.edu.kz.', 'EMAIL_INVALID'], ['a.@sdu.edu.kz', 'EMAIL_INVALID'], ['.a@sdu.edu.kz', 'EMAIL_INVALID'], ['a..b@sdu.edu.kz', 'EMAIL_INVALID'],
    ['a@gmail.com', 'EMAIL_DOMAIN_NOT_SDU'], ['a@sdu.edu.kz.evil.com', 'EMAIL_DOMAIN_NOT_SDU'], ['a@sdu-edu.kz', 'EMAIL_DOMAIN_NOT_SDU'],
    ['a@xsdu.edu.kz', 'EMAIL_DOMAIN_NOT_SDU'], ['a@mail.sdu.edu.kz', 'EMAIL_DOMAIN_NOT_SDU'], ['a@sdu.edu.kz\n', 'OK'], ['a@sdu.edu.kz\u200B', 'EMAIL_INVALID'],
    ['"a"@sdu.edu.kz', 'EMAIL_INVALID'], ['a+tag@sdu.edu.kz', 'EMAIL_INVALID'], ['a(b)@sdu.edu.kz', 'EMAIL_INVALID'], ['a<b>@sdu.edu.kz', 'EMAIL_INVALID'],
    ["a'or'1'='1@sdu.edu.kz", 'EMAIL_INVALID'], ['ал@sdu.edu.kz', 'EMAIL_INVALID'],
    ['a@sdu.edu.Kz', 'OK'], ['a@sdu.edu.\u212Az', 'EMAIL_INVALID'], // Kelvin sign must not fold to "k"
    ['Ka@sdu.edu.kz', 'EMAIL_INVALID'],
    [`${'a'.repeat(65)}@sdu.edu.kz`, 'EMAIL_INVALID'], [`${'a'.repeat(300)}@sdu.edu.kz`, 'EMAIL_TOO_LONG'],
  ])('%j → %s', (v, expected) => expect(code(validateSduEmail(v))).toBe(expected));
  it('normalizes to lowercase', () => expect(validateSduEmail(' Ali.S@SDU.EDU.KZ ')).toEqual({ ok: true, value: 'ali.s@sdu.edu.kz' }));
});

describe('Work email', () => {
  it.each([
    ['hr@acme-tech.kz', 'OK'], ['HR@Acme.COM', 'OK'], ['first.last@sub.company.co.uk', 'OK'],
    ['a@gmail.com', 'EMAIL_NOT_CORPORATE'], ['a@mail.ru', 'EMAIL_NOT_CORPORATE'], ['a@yandex.kz', 'EMAIL_NOT_CORPORATE'], ['a@yandex.com', 'EMAIL_NOT_CORPORATE'],
    ['a@yahoo.co.uk', 'EMAIL_NOT_CORPORATE'], ['a@outlook.com', 'EMAIL_NOT_CORPORATE'], ['a@hotmail.com', 'EMAIL_NOT_CORPORATE'], ['a@icloud.com', 'EMAIL_NOT_CORPORATE'],
    ['a@bk.ru', 'EMAIL_NOT_CORPORATE'], ['a@inbox.ru', 'EMAIL_NOT_CORPORATE'], ['a@list.ru', 'EMAIL_NOT_CORPORATE'], ['a@sub.gmail.com', 'EMAIL_NOT_CORPORATE'],
    ['a@mailinator.com', 'EMAIL_DISPOSABLE'], ['a@tempmail.io', 'EMAIL_DISPOSABLE'], ['a@10minutemail.com', 'EMAIL_DISPOSABLE'], ['a@my-temp-mail.net', 'EMAIL_DISPOSABLE'],
    ['a@sdu.edu.kz', 'EMAIL_DOMAIN_NOT_ALLOWED'], ['a@mail.sdu.edu.kz', 'EMAIL_DOMAIN_NOT_ALLOWED'],
    ['', 'REQUIRED'], ['a@b', 'EMAIL_INVALID'], ['a@b.c', 'EMAIL_INVALID'], ['a b@acme.kz', 'EMAIL_INVALID'], ['a@@acme.kz', 'EMAIL_INVALID'],
    ['a@acme..kz', 'EMAIL_INVALID'], ['a@-acme.kz', 'EMAIL_INVALID'], ['a@acme.kz.', 'EMAIL_INVALID'], ['a@аcme.kz', 'EMAIL_INVALID'],
  ])('%j → %s', (v, expected) => expect(code(validateWorkEmail(v))).toBe(expected));
});

describe('Phone', () => {
  it.each([
    ['+77011234567', '+77011234567'], ['+7 (701) 123-45-67', '+77011234567'], [' +7 (777) 000-00-00 ', '+77770000000'],
    ['87011234567', null], ['+7701123456', null], ['+770112345678', null], ['+76011234567', null], ['+7 (701) 1234567', null],
    ['+7 (701) 123-45-6a', null], ['+٧٧٠١١٢٣٤٥٦٧', null], ['+7701123456\n7', null], ['', null], ['+7'.repeat(100), null],
    ["+7' OR 1=1", null],
  ])('%j', (v, expected) => {
    const r = validatePhone(v);
    expect(r.ok ? r.value : null).toBe(expected);
  });
  it('mask formatting', () => {
    expect(formatPhoneMask('7011234567')).toBe('+7 (701) 123-45-67');
    expect(formatPhoneMask('+7 (701) 12')).toBe('+7 (701) 12');
    expect(formatPhoneMask('87011234567')).toBe('+7 (701) 123-45-67');
    expect(formatPhoneMask('abc')).toBe('');
    expect(formatPhoneMask('70112345678999')).toBe('+7 (011) 234-56-78');
  });
});

describe('GPA', () => {
  it.each([
    ['3.5', '3.50'], ['3,5', '3.50'], ['4', '4.00'], ['4.00', '4.00'], ['0', '0.00'], ['0.00', '0.00'], [3.75, '3.75'], [' 2.1 ', '2.10'],
    ['4.01', 'GPA_OUT_OF_RANGE'], ['5', 'GPA_OUT_OF_RANGE'], ['3.999', 'GPA_TOO_MANY_DECIMALS'], ['3.555', 'GPA_TOO_MANY_DECIMALS'],
    ['-1', 'GPA_INVALID'], ['-0', 'GPA_INVALID'], [-0, 'GPA_INVALID'], ['1e2', 'GPA_INVALID'], [1e2, 'GPA_INVALID'], ['+3', 'GPA_INVALID'],
    ['abc', 'GPA_INVALID'], ['3.5.1', 'GPA_INVALID'], ['3,5,1', 'GPA_INVALID'], ['03.5', 'GPA_INVALID'], ['.5', 'GPA_INVALID'], ['3.', 'GPA_INVALID'],
    ['', 'REQUIRED'], ['  ', 'REQUIRED'], [null, 'REQUIRED'], [NaN, 'GPA_INVALID'], [Infinity, 'GPA_INVALID'], ['٣.٥', 'GPA_INVALID'], [{}, 'GPA_INVALID'],
  ])('%j → %s', (v, expected) => {
    const r = validateGpa(v);
    expect(r.ok ? r.value : r.code).toBe(expected);
  });
  it('sanitizes typing', () => {
    expect(sanitizeGpaInput('3,5')).toBe('3.5');
    expect(sanitizeGpaInput('e+3-')).toBe('3');
    expect(sanitizeGpaInput('3.999')).toBe('3.99');
    expect(sanitizeGpaInput('3..5')).toBe('3.5');
    expect(sanitizeGpaInput('44')).toBe('4');
  });
});

describe('Graduation date', () => {
  // NOW = Oct 2026
  it.each([
    ['2028-10', '3', 'OK'], ['2027-06', '4', 'OK'], ['2030-06', '1', 'OK'], ['2028-06', 'm1', 'OK'],
    ['2026-10', '4', 'GRADUATION_PAST'], ['2025-06', '4', 'GRADUATION_PAST'], ['2026-09', '4', 'GRADUATION_PAST'],
    ['2046-06', '1', 'GRADUATION_TOO_FAR'], ['2033-01', '1', 'GRADUATION_TOO_FAR'],
    ['2031-06', '4', 'GRADUATION_INCONSISTENT'], // 4th year can't finish in 5 years
    ['2031-06', '3', 'GRADUATION_INCONSISTENT'], ['2029-06', '4', 'GRADUATION_INCONSISTENT'],
    ['2026-12', '1', 'GRADUATION_INCONSISTENT'], ['2027-06', '1', 'GRADUATION_INCONSISTENT'],
    ['2026-11', '4', 'OK'], ['2029-01', 'm2', 'GRADUATION_INCONSISTENT'],
    ['2028-13', '3', 'GRADUATION_INVALID'], ['2028-00', '3', 'GRADUATION_INVALID'], ['2028/06', '3', 'GRADUATION_INVALID'], ['06-2028', '3', 'GRADUATION_INVALID'],
    ['', '3', 'REQUIRED'], [null, '3', 'REQUIRED'], [202806, '3', 'GRADUATION_INVALID'], ['2028-06-01', '3', 'GRADUATION_INVALID'],
  ])('%j (year %s) → %s', (v, y, expected) => expect(code(validateGraduation(v, y as never, NOW))).toBe(expected));
  it('skips consistency when year unknown', () => expect(code(validateGraduation('2031-06', null, NOW))).toBe('OK'));
});

describe('Password', () => {
  const ctx = { studentId: '230107010', name: 'Aigerim', surname: 'Nurlanova', email: 'aigerim.n@sdu.edu.kz' };
  it.each([
    ['Vk8#mQ2!zPw4', 'OK'], ['Zx9!kLm#2qw', 'OK'],
    ['', 'REQUIRED'], ['Ab1!', 'PASSWORD_TOO_SHORT'], ['Abcdef1!'.repeat(9), 'PASSWORD_TOO_LONG'], ['A'.repeat(10_000), 'PASSWORD_TOO_LONG'],
    ['Abcd 123!x', 'PASSWORD_HAS_SPACE'], ['Abcd123!\t', 'PASSWORD_HAS_SPACE'], ['Пароль123!x', 'PASSWORD_INVALID_CHARS'], ['Abcd1234!😀', 'PASSWORD_INVALID_CHARS'],
    ['abcdefg1!x', 'PASSWORD_NO_UPPER'], ['ABCDEFG1!X', 'PASSWORD_NO_LOWER'], ['Abcdefgh!x', 'PASSWORD_NO_DIGIT'], ['Abcdefg12x', 'PASSWORD_NO_SPECIAL'],
    ['Xx230107010!a', 'PASSWORD_CONTAINS_PERSONAL'], ['Aigerim#2026x', 'PASSWORD_CONTAINS_PERSONAL'], ['xNURLANOVA9!', 'PASSWORD_CONTAINS_PERSONAL'],
    ['Zz#aigerim.n9', 'PASSWORD_CONTAINS_PERSONAL'],
    ['Password1!', 'PASSWORD_COMMON'], ['P@ssw0rd!', 'PASSWORD_COMMON'], ['Qwerty123!', 'PASSWORD_COMMON'], ['Welcome1!', 'PASSWORD_COMMON'],
  ])('%j → %s', (v, expected) => expect(code(validatePassword(v, ctx))).toBe(expected));
  it('checklist flags', () => {
    const c = passwordChecks('abc', ctx);
    expect(c.length).toBe(false); expect(c.lower).toBe(true); expect(c.upper).toBe(false);
  });
  it('confirm must match exactly and is re-checked', () => {
    expect(code(validateConfirmPassword('Abc', 'Abc'))).toBe('OK');
    expect(code(validateConfirmPassword('Abc ', 'Abc'))).toBe('PASSWORD_MISMATCH');
    expect(code(validateConfirmPassword('', 'Abc'))).toBe('REQUIRED');
  });
});

describe('City', () => {
  it('known key', () => expect(validateCity('almaty', undefined).city.ok).toBe(true));
  it('unknown key', () => expect(code(validateCity('atlantis', undefined).city)).toBe('CITY_INVALID'));
  it('other requires free text, letters only', () => {
    expect(code(validateCity('other', '').cityOther)).toBe('REQUIRED');
    expect(code(validateCity('other', 'Nur-Sultan').cityOther)).toBe('OK');
    expect(code(validateCity('other', 'Ala2ty').cityOther)).toBe('CITY_OTHER_INVALID');
    expect(code(validateCity('other', '<b>x</b>').cityOther)).toBe('CITY_OTHER_INVALID');
    expect(code(validateCity('other', 'A').cityOther)).toBe('CITY_OTHER_INVALID');
    expect(code(validateCity('other', 'Мариуполь').cityOther)).toBe('OK');
  });
  it('free text ignored when not "other"', () => expect(validateCity('almaty', '<script>').cityOther).toEqual({ ok: true, value: null }));
});

describe('Employer fields', () => {
  it('BIN', () => {
    expect(code(validateBin('123456789012'))).toBe('OK');
    for (const bad of ['12345678901', '1234567890123', '12345678901a', '123 456 789 012', '١٢٣٤٥٦٧٨٩٠١٢']) expect(code(validateBin(bad))).toBe('BIN_INVALID');
    expect(code(validateBin(''))).toBe('REQUIRED');
  });
  it('company name', () => {
    expect(code(validateCompanyName('Kaspi.kz JSC'))).toBe('OK');
    expect(code(validateCompanyName('<script>alert(1)</script>'))).toBe('COMPANY_NAME_INVALID');
    expect(code(validateCompanyName('A'.repeat(101)))).toBe('COMPANY_NAME_TOO_LONG');
    expect(code(validateCompanyName('   '))).toBe('REQUIRED');
  });
  it('website', () => {
    expect(code(validateWebsite(''))).toBe('OK');
    expect(code(validateWebsite('https://acme.kz/path?x=1'))).toBe('OK');
    for (const bad of ['acme.kz', 'ftp://acme.kz', 'javascript:alert(1)', 'https://', 'https://localhost', 'https://127.0.0.1', 'https://a b.kz', 'https://user:pw@acme.kz', 'https://acme', 'http://аcme.kz'])
      expect(code(validateWebsite(bad)), bad).toBe('WEBSITE_INVALID');
  });
  it('description max 500 code points', () => {
    expect(code(validateDescription('a'.repeat(500)))).toBe('OK');
    expect(code(validateDescription('a'.repeat(501)))).toBe('DESCRIPTION_TOO_LONG');
    expect(code(validateDescription('😀'.repeat(500)))).toBe('OK');
    const r = validateDescription('hi​ there\u0000');
    expect(r.ok && r.value).toBe('hi there');
    expect(validateDescription('   ')).toEqual({ ok: true, value: null });
  });
});

describe('Tags', () => {
  it('single tag', () => {
    expect(code(validateTag('C++'))).toBe('OK');
    expect(code(validateTag('Node.js'))).toBe('OK');
    for (const bad of ['a', '', '<b>', 'x'.repeat(41), '😀😀', 'a;b']) expect(code(validateTag(bad)), bad).toBe('TAG_INVALID');
  });
  it('dedupes and limits', () => {
    expect(validateTags(['Python', 'python', ' PYTHON '], 30, 'TAGS_TOO_MANY')).toEqual({ ok: true, value: ['Python'] });
    expect(code(validateTags(Array.from({ length: 31 }, (_, i) => `skill ${i}`), 30, 'TAGS_TOO_MANY'))).toBe('TAGS_TOO_MANY');
    expect(code(validateTags(Array.from({ length: 30 }, (_, i) => `skill ${i}`), 30, 'TAGS_TOO_MANY'))).toBe('OK');
    expect(code(validateTags('nope', 30, 'TAGS_TOO_MANY'))).toBe('TAG_INVALID');
  });
});

describe('Registration schemas', () => {
  const base = {
    studentId: '230107010', name: 'Ali', surname: 'Serik', email: 'ali.serik@sdu.edu.kz', phone: '+7 (701) 123-45-67', city: 'almaty',
    major: 'computer_science', yearOfStudy: '3', gpa: '3,5', graduation: '2028-06', interestArea: 'data_ai', relocation: 'yes',
    password: 'Vk8#mQ2!zPw4', confirmPassword: 'Vk8#mQ2!zPw4', acceptTerms: true,
  };
  it('accepts a valid student', () => {
    const r = validateStudentRegistration(base, NOW);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data).toMatchObject({ phone: '+77011234567', gpa: '3.50', language: 'en' });
  });
  it('QA script: letters in ID', () => expect(validateStudentRegistration({ ...base, studentId: '23010701a' }, NOW)).toMatchObject({ ok: false, fields: { studentId: 'STUDENT_ID_INVALID' } }));
  it('QA script: 8 digits', () => expect(validateStudentRegistration({ ...base, studentId: '12345678' }, NOW)).toMatchObject({ ok: false, fields: { studentId: 'STUDENT_ID_INVALID' } }));
  it('QA script: mismatch', () => expect(validateStudentRegistration({ ...base, confirmPassword: 'Different1!' }, NOW)).toMatchObject({ ok: false, fields: { confirmPassword: 'PASSWORD_MISMATCH' } }));
  it('password equal to student ID / email local part', () => {
    expect(validateStudentRegistration({ ...base, password: 'Qq230107010!', confirmPassword: 'Qq230107010!' }, NOW)).toMatchObject({ fields: { password: 'PASSWORD_CONTAINS_PERSONAL' } });
    expect(validateStudentRegistration({ ...base, password: 'Ali.serik#9X', confirmPassword: 'Ali.serik#9X' }, NOW)).toMatchObject({ fields: { password: 'PASSWORD_CONTAINS_PERSONAL' } });
  });
  it('mass assignment (extra fields) is rejected', () => {
    for (const extra of [{ role: 'admin' }, { status: 'active' }, { id: 'x' }, { isAdmin: true }])
      expect(validateStudentRegistration({ ...base, ...extra }, NOW)).toMatchObject({ ok: false, formError: 'UNKNOWN_FIELDS' });
  });
  it('non-object payloads', () => {
    for (const bad of [null, 'x', 5, [], undefined]) expect(validateStudentRegistration(bad, NOW)).toMatchObject({ ok: false, formError: 'VALIDATION_FAILED' });
  });
  it('all required fields reported when empty', () => {
    const r = validateStudentRegistration({}, NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) for (const f of ['studentId', 'name', 'surname', 'email', 'phone', 'city', 'major', 'yearOfStudy', 'gpa', 'graduation', 'interestArea', 'relocation', 'password', 'confirmPassword', 'acceptTerms']) expect(r.fields[f], f).toBeTruthy();
  });
  it('terms must be literally true', () => {
    for (const t of [false, 'true', 1, undefined]) expect(validateStudentRegistration({ ...base, acceptTerms: t }, NOW)).toMatchObject({ fields: { acceptTerms: 'TERMS_REQUIRED' } });
  });
  it('employer', () => {
    const e = {
      companyName: 'Acme LLP', bin: '123456789012', industry: 'it_software', size: 's11_50', city: 'astana', contactName: 'Timur', contactSurname: 'Ospanov',
      position: 'CEO', email: 'ceo@acme.kz', phone: '+7 (702) 111-22-33', password: 'Vk8#mQ2!zPw4', confirmPassword: 'Vk8#mQ2!zPw4', acceptTerms: true,
    };
    expect(validateEmployerRegistration(e).ok).toBe(true);
    expect(validateEmployerRegistration({ ...e, email: 'x@gmail.com' })).toMatchObject({ fields: { email: 'EMAIL_NOT_CORPORATE' } });
    expect(validateEmployerRegistration({ ...e, size: '2' })).toMatchObject({ fields: { size: 'SIZE_INVALID' } });
    expect(validateEmployerRegistration({ ...e, role: 'admin' })).toMatchObject({ formError: 'UNKNOWN_FIELDS' });
  });
});
