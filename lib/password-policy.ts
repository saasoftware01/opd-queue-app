export const PASSWORD_PATTERN = '^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[^A-Za-z0-9\\s]).{8,}$';
export const PASSWORD_REQUIREMENT =
  'Use at least 8 characters, including an uppercase letter, a lowercase letter, a number, and a special character.';

const passwordRegex = new RegExp(PASSWORD_PATTERN);

export function isValidPassword(password: string): boolean {
  return passwordRegex.test(password);
}
