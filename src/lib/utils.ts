type ClassDictionary = Record<string, boolean | null | undefined>;
type ClassInput = string | null | undefined | false | ClassDictionary | ClassInput[];

function toClassName(input: ClassInput): string {
  if (!input) {
    return '';
  }

  if (typeof input === 'string') {
    return input;
  }

  if (Array.isArray(input)) {
    return input.map(toClassName).filter(Boolean).join(' ');
  }

  return Object.entries(input)
    .filter(([, enabled]) => Boolean(enabled))
    .map(([name]) => name)
    .join(' ');
}

export function cn(...inputs: ClassInput[]) {
  return inputs.map(toClassName).filter(Boolean).join(' ');
}
