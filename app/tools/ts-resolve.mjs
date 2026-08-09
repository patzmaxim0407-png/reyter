/* Node не додає розширення сам, а в коді проєкту імпорти без
   нього — так вимагає збірка Next. Хук доклеює .ts, щоб ті самі
   файли запускались і напряму, без окремої збірки. */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function resolve(specifier, context, next) {
  if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) {
    const base = new URL(specifier, context.parentURL);
    for (const ext of ['.ts', '.tsx', '/index.ts']) {
      const cand = new URL(base.href + ext);
      if (existsSync(fileURLToPath(cand))) return next(specifier + ext, context);
    }
  }
  return next(specifier, context);
}
