import { Fragment } from 'react';
import { motion } from 'motion/react';
import { cn } from '@/lib/utils';

export type Testimonial = {
  text: string;
  image: string;
  name: string;
  role: string;
};

type TestimonialsRowProps = {
  className?: string;
  testimonials: Testimonial[];
  duration?: number;
};

/** Horizontal marquee — left → right continuous loop. */
export function TestimonialsRow({
  className,
  testimonials,
  duration = 40,
}: TestimonialsRowProps) {
  return (
    <div className={cn('overflow-hidden', className)}>
      <motion.div
        animate={{ x: ['-50%', '0%'] }}
        transition={{
          duration,
          repeat: Infinity,
          ease: 'linear',
          repeatType: 'loop',
        }}
        className="flex w-max gap-5 pr-5"
      >
        {Array.from({ length: 2 }).map((_, index) => (
          <Fragment key={index}>
            {testimonials.map(({ text, image, name, role }) => (
              <div
                key={`${index}-${name}`}
                className="w-[min(84vw,320px)] shrink-0 rounded-3xl border border-black/[0.08] bg-white p-6 text-left shadow-[0_16px_40px_-28px_rgba(32,87,206,0.35)] sm:p-7"
              >
                <p className="text-sm leading-relaxed text-text-300">{text}</p>
                <div className="mt-5 flex items-center gap-2.5">
                  <img
                    width={40}
                    height={40}
                    src={image}
                    alt={name}
                    className="h-10 w-10 rounded-full object-cover"
                    style={{ backgroundColor: '#2057CE' }}
                    loading="lazy"
                    decoding="async"
                    referrerPolicy="no-referrer"
                    onError={(e) => {
                      const el = e.currentTarget;
                      el.onerror = null;
                      el.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=2057CE&color=fff&size=128`;
                    }}
                  />
                  <div className="flex min-w-0 flex-col">
                    <div className="text-sm font-medium leading-5 tracking-tight text-text-100">
                      {name}
                    </div>
                    <div className="text-xs leading-5 tracking-tight text-text-400">{role}</div>
                  </div>
                </div>
              </div>
            ))}
          </Fragment>
        ))}
      </motion.div>
    </div>
  );
}

/** @deprecated vertical variant kept for compatibility */
export function TestimonialsColumn(props: {
  className?: string;
  testimonials: Testimonial[];
  duration?: number;
}) {
  return <TestimonialsRow {...props} />;
}
