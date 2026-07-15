import { lazy, Suspense } from 'react';

// Slimmer runtime than full Prism: languages registered on demand.
// Deep ESM paths lack published types — intentionally untyped imports.
const SyntaxHighlighterBlock = lazy(async () => {
  const [{ default: PrismLight }, { default: oneDark }] = await Promise.all([
    // @ts-expect-error — no types for deep ESM path
    import('react-syntax-highlighter/dist/esm/prism-light'),
    // @ts-expect-error — no types for deep ESM path
    import('react-syntax-highlighter/dist/esm/styles/prism/one-dark'),
  ]);

  const langs = await Promise.all([
    // @ts-expect-error — no types for deep ESM path
    import('react-syntax-highlighter/dist/esm/languages/prism/javascript'),
    // @ts-expect-error — no types for deep ESM path
    import('react-syntax-highlighter/dist/esm/languages/prism/typescript'),
    // @ts-expect-error — no types for deep ESM path
    import('react-syntax-highlighter/dist/esm/languages/prism/tsx'),
    // @ts-expect-error — no types for deep ESM path
    import('react-syntax-highlighter/dist/esm/languages/prism/json'),
    // @ts-expect-error — no types for deep ESM path
    import('react-syntax-highlighter/dist/esm/languages/prism/bash'),
  ]);

  PrismLight.registerLanguage('javascript', langs[0].default);
  PrismLight.registerLanguage('js', langs[0].default);
  PrismLight.registerLanguage('typescript', langs[1].default);
  PrismLight.registerLanguage('ts', langs[1].default);
  PrismLight.registerLanguage('tsx', langs[2].default);
  PrismLight.registerLanguage('json', langs[3].default);
  PrismLight.registerLanguage('bash', langs[4].default);
  PrismLight.registerLanguage('shell', langs[4].default);

  return {
    default: function Block({ language, code }: { language: string; code: string }) {
      return (
        <PrismLight
          style={oneDark}
          language={language || 'javascript'}
          PreTag="div"
          customStyle={{ margin: 0, fontSize: '0.8125rem', background: '#050a0f' }}
        >
          {code}
        </PrismLight>
      );
    },
  };
});

export function LazyCodeBlock({ language, code }: { language: string; code: string }) {
  return (
    <Suspense
      fallback={
        <pre className="overflow-x-auto rounded bg-bg-0 p-3 text-[0.8125rem] text-text-100">
          <code>{code}</code>
        </pre>
      }
    >
      <SyntaxHighlighterBlock language={language} code={code} />
    </Suspense>
  );
}
