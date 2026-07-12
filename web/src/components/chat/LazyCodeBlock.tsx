import { lazy, Suspense } from 'react';

const SyntaxHighlighterBlock = lazy(async () => {
  const [{ Prism }, { oneDark }] = await Promise.all([
    import('react-syntax-highlighter'),
    import('react-syntax-highlighter/dist/esm/styles/prism'),
  ]);

  return {
    default: function Block({ language, code }: { language: string; code: string }) {
      return (
        <Prism
          style={oneDark}
          language={language}
          PreTag="div"
          customStyle={{ margin: 0, fontSize: '0.8125rem', background: '#050a0f' }}
        >
          {code}
        </Prism>
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
