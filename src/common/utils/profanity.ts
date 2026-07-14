const profanityPatterns = [
  /(?:^|[^а-яa-z])(?:бл[яеё]|блят|блять|бляд)/i,
  /(?:^|[^а-яa-z])(?:сука|сучар|сучк)/i,
  /(?:^|[^а-яa-z])(?:хуй|хуе|хуё|хуя|хер|хрен)/i,
  /(?:^|[^а-яa-z])(?:пизд|пздц|пипец)/i,
  /(?:^|[^а-яa-z])(?:еба|ебу|еби|ебн|ёба|ёбу|ёби|ёбн|нах|заеб|заёб)/i,
  /(?:^|[^а-яa-z])(?:муд[ао]|мраз|гандон|долбо)/i,
  /(?:^|[^а-яa-z])(?:fuck|fucking|shit|bitch|asshole|bastard)(?:$|[^а-яa-z])/i,
  /(?:^|[^а-яa-z])(?:боқ|котак|көт|сик|нахуй)(?:$|[^а-яa-z])/i
];

const replacements: Record<string, string> = {
  '@': 'а',
  '0': 'о',
  '3': 'з',
  '4': 'ч',
  '6': 'б',
  'ь': '',
  'ъ': '',
  '*': '',
  '.': '',
  ',': '',
  '-': '',
  '_': '',
  ' ': ' '
};

export type ProfanityDetection = {
  detected: boolean;
  matches: string[];
  normalizedText: string;
};

export function normalizeProfanityText(text: string) {
  return text
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}\s@*.,\-_]/gu, ' ')
    .split('')
    .map((char) => replacements[char] ?? char)
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

export function detectProfanity(text: string): ProfanityDetection {
  const normalizedText = normalizeProfanityText(text);
  const compactText = normalizedText.replace(/\s+/g, '');
  const matches = new Set<string>();

  for (const pattern of profanityPatterns) {
    const spacedMatch = normalizedText.match(pattern);
    if (spacedMatch?.[0]) matches.add(spacedMatch[0].trim());
    const compactMatch = compactText.match(pattern);
    if (compactMatch?.[0]) matches.add(compactMatch[0].trim());
  }

  return {
    detected: matches.size > 0,
    matches: [...matches],
    normalizedText
  };
}
