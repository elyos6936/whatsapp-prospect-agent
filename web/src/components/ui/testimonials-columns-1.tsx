import { Fragment } from 'react';
import { motion } from 'motion/react';
import { cn } from '@/lib/utils';

export type Testimonial = {
  text: string;
  image: string;
  name: string;
  role: string;
};

type TestimonialsColumnProps = {
  className?: string;
  testimonials: Testimonial[];
  duration?: number;
};

export function TestimonialsColumn({
  className,
  testimonials,
  duration = 10,
}: TestimonialsColumnProps) {
  return (
    <div className={className}>
      <motion.div
        animate={{ translateY: '-50%' }}
        transition={{
          duration,
          repeat: Infinity,
          ease: 'linear',
          repeatType: 'loop',
        }}
        className="flex flex-col gap-6 bg-transparent pb-6"
      >
        {Array.from({ length: 2 }).map((_, index) => (
          <Fragment key={index}>
            {testimonials.map(({ text, image, name, role }, i) => (
              <div
                key={`${index}-${i}`}
                className="w-full max-w-xs rounded-3xl border border-black/[0.08] bg-white p-8 shadow-[0_16px_40px_-28px_rgba(32,87,206,0.35)]"
              >
                <p className="text-sm leading-relaxed text-text-300">{text}</p>
                <div className="mt-5 flex items-center gap-2.5">
                  <img
                    width={40}
                    height={40}
                    src={image}
                    alt={name}
                    className="h-10 w-10 rounded-full object-cover"
                    loading="lazy"
                  />
                  <div className="flex min-w-0 flex-col text-left">
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
