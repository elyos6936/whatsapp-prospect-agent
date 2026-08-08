import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

type HeroTypingWordProps = {
  text: string;
  className?: string;
  typingMs?: number;
  deletingMs?: number;
  holdMs?: number;
  emptyMs?: number;
};

/**
 * Type → hold → delete → pause → loop. Invisible full word reserves width.
 */
export function HeroTypingWord({
  text,
  className,
  typingMs = 78,
  deletingMs = 42,
  holdMs = 1600,
  emptyMs = 420,
}: HeroTypingWordProps) {
  const [n, setN] = useState(0);
  const [phase, setPhase] = useState<'typing' | 'hold' | 'deleting' | 'empty'>('typing');

  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    if (phase === 'typing') {
      if (n < text.length) {
        t = setTimeout(() => setN((v) => v + 1), typingMs);
      } else {
        t = setTimeout(() => setPhase('hold'), holdMs);
      }
    } else if (phase === 'hold') {
      t = setTimeout(() => setPhase('deleting'), 0);
    } else if (phase === 'deleting') {
      if (n > 0) {
        t = setTimeout(() => setN((v) => v - 1), deletingMs);
      } else {
        t = setTimeout(() => setPhase('empty'), emptyMs);
      }
    } else {
      t = setTimeout(() => setPhase('typing'), 0);
    }
    return () => clearTimeout(t);
  }, [phase, n, text, typingMs, deletingMs, holdMs, emptyMs]);

  return (
    <span
      className={cn('relative inline-grid align-baseline', className)}
      aria-label={text}
    >
      <span className="invisible col-start-1 row-start-1 whitespace-nowrap" aria-hidden>
        {text}
        <span className="ml-0.5 inline-block h-[0.9em] w-[0.08em]" />
      </span>
      <span className="col-start-1 row-start-1 whitespace-nowrap" aria-hidden>
        {text.slice(0, n)}
        <span
          className="ml-0.5 inline-block h-[0.9em] w-[0.08em] translate-y-[0.08em] animate-pulse rounded-sm bg-current align-baseline opacity-90"
        />
      </span>
    </span>
  );
}
