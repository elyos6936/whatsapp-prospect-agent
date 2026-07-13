import { motion } from 'framer-motion';

export function Spotlight() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      <motion.div
        className="absolute -left-[20%] top-[-30%] h-[600px] w-[600px] rounded-full opacity-30 blur-[100px]"
        style={{ background: 'radial-gradient(circle, rgba(47,107,255,0.35) 0%, transparent 70%)' }}
        animate={{ x: [0, 40, 0], y: [0, 20, 0] }}
        transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute -right-[10%] top-[10%] h-[500px] w-[500px] rounded-full opacity-20 blur-[90px]"
        style={{ background: 'radial-gradient(circle, rgba(47,107,255,0.25) 0%, transparent 70%)' }}
        animate={{ x: [0, -30, 0], y: [0, 30, 0] }}
        transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
      />
    </div>
  );
}
