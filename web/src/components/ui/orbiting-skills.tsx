import { memo, useEffect, useRef, useState, type ComponentType, type SVGProps } from 'react';
import { Link } from 'react-router-dom';
import { KlanvioLogo } from '@/components/brand/KlanvioLogo';
import {
  CalendlyLogo,
  GoogleContactsLogo,
  GoogleSheetsLogo,
  N8nLogo,
  TallyLogo,
  TypeformLogo,
  WhatsAppLogo,
  ZapierLogo,
} from '@/components/brand/IntegrationLogos';
import { cn } from '@/lib/utils';

type GlowColor = 'brand' | 'emerald';

type LogoComponent = ComponentType<SVGProps<SVGSVGElement> & { className?: string }>;

type OrbitItemConfig = {
  id: string;
  orbitRadius: number;
  size: number;
  speed: number;
  phaseShift: number;
  glowColor: GlowColor;
  label: string;
  color: string;
  Logo: LogoComponent;
  href?: string;
};

type GlowingOrbitPathProps = {
  radius: number;
  glowColor?: GlowColor;
  animationDelay?: number;
};

const TWO_PI = Math.PI * 2;

/** Inner = live Klanvio integrations · Outer = upcoming / ecosystem */
const ORBIT_ITEMS: OrbitItemConfig[] = [
  {
    id: 'whatsapp',
    orbitRadius: 108,
    size: 54,
    speed: 0.85,
    phaseShift: 0,
    glowColor: 'brand',
    label: 'WhatsApp',
    color: '#25D366',
    Logo: WhatsAppLogo,
    href: '/integrations/whatsapp',
  },
  {
    id: 'google-contacts',
    orbitRadius: 108,
    size: 52,
    speed: 0.85,
    phaseShift: TWO_PI / 4,
    glowColor: 'brand',
    label: 'Google Contacts',
    color: '#4285F4',
    Logo: GoogleContactsLogo,
    href: '/integrations/google-contacts',
  },
  {
    id: 'typeform',
    orbitRadius: 108,
    size: 50,
    speed: 0.85,
    phaseShift: TWO_PI / 2,
    glowColor: 'brand',
    label: 'Typeform',
    color: '#262627',
    Logo: TypeformLogo,
    href: '/integrations/typeform',
  },
  {
    id: 'google-sheets',
    orbitRadius: 108,
    size: 52,
    speed: 0.85,
    phaseShift: (3 * TWO_PI) / 4,
    glowColor: 'brand',
    label: 'Google Sheets',
    color: '#0F9D58',
    Logo: GoogleSheetsLogo,
    href: '/integrations/google-sheets',
  },
  {
    id: 'calendly',
    orbitRadius: 188,
    size: 52,
    speed: -0.55,
    phaseShift: 0,
    glowColor: 'emerald',
    label: 'Calendly',
    color: '#006BFF',
    Logo: CalendlyLogo,
  },
  {
    id: 'tally',
    orbitRadius: 188,
    size: 50,
    speed: -0.55,
    phaseShift: TWO_PI / 4,
    glowColor: 'emerald',
    label: 'Tally',
    color: '#111111',
    Logo: TallyLogo,
  },
  {
    id: 'n8n',
    orbitRadius: 188,
    size: 52,
    speed: -0.55,
    phaseShift: TWO_PI / 2,
    glowColor: 'emerald',
    label: 'n8n',
    color: '#EA4B71',
    Logo: N8nLogo,
  },
  {
    id: 'zapier',
    orbitRadius: 188,
    size: 52,
    speed: -0.55,
    phaseShift: (3 * TWO_PI) / 4,
    glowColor: 'emerald',
    label: 'Zapier',
    color: '#FF4A00',
    Logo: ZapierLogo,
  },
];

type OrbitingSkillProps = {
  config: OrbitItemConfig;
  nodeRef: (el: HTMLDivElement | null) => void;
};

const OrbitingSkill = memo(function OrbitingSkill({ config, nodeRef }: OrbitingSkillProps) {
  const [isHovered, setIsHovered] = useState(false);
  const { size, label, color, Logo, href, orbitRadius, phaseShift } = config;
  const x0 = Math.cos(phaseShift) * orbitRadius;
  const y0 = Math.sin(phaseShift) * orbitRadius;

  const bubble = (
    <div
      className={cn(
        'relative flex h-full w-full items-center justify-center overflow-hidden rounded-full border border-black/[0.08] bg-white p-1 shadow-md shadow-black/10 transition-all duration-300',
        isHovered && 'scale-110 shadow-xl',
        href && 'cursor-pointer hover:border-brand-border',
      )}
      style={{
        boxShadow: isHovered
          ? `0 0 28px ${color}35, 0 8px 20px rgba(15,23,42,0.12)`
          : undefined,
      }}
    >
      <div className="flex size-[86%] items-center justify-center *:size-full">
        <Logo />
      </div>
    </div>
  );

  return (
    <div
      ref={nodeRef}
      className="absolute top-1/2 left-1/2 will-change-transform"
      style={{
        width: `${size}px`,
        height: `${size}px`,
        transform: `translate(calc(${x0}px - 50%), calc(${y0}px - 50%))`,
        zIndex: isHovered ? 40 : 10,
      }}
      title={label}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onFocus={() => setIsHovered(true)}
      onBlur={() => setIsHovered(false)}
    >
      {href ? (
        <Link to={href} aria-label={label} className="block h-full w-full" title={label}>
          {bubble}
        </Link>
      ) : (
        <div className="h-full w-full" role="img" aria-label={label}>
          {bubble}
        </div>
      )}
      {isHovered && (
        <div className="pointer-events-none absolute top-full left-1/2 z-50 mt-2 -translate-x-1/2 whitespace-nowrap rounded-lg border border-black/[0.08] bg-white px-2.5 py-1 text-xs font-semibold text-text-100 shadow-[0_8px_20px_-8px_rgba(15,23,42,0.35)]">
          {label}
        </div>
      )}
    </div>
  );
});

const GlowingOrbitPath = memo(function GlowingOrbitPath({
  radius,
  glowColor = 'brand',
  animationDelay = 0,
}: GlowingOrbitPathProps) {
  const glowColors = {
    brand: {
      primary: 'rgba(32, 87, 206, 0.28)',
      secondary: 'rgba(32, 87, 206, 0.1)',
      border: 'rgba(32, 87, 206, 0.22)',
    },
    emerald: {
      primary: 'rgba(37, 211, 102, 0.22)',
      secondary: 'rgba(37, 211, 102, 0.08)',
      border: 'rgba(37, 211, 102, 0.2)',
    },
  } as const;

  const colors = glowColors[glowColor];

  return (
    <div
      className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
      style={{
        width: `${radius * 2}px`,
        height: `${radius * 2}px`,
        animationDelay: `${animationDelay}s`,
      }}
    >
      <div
        className="absolute inset-0 rounded-full"
        style={{
          background: `radial-gradient(circle, transparent 42%, ${colors.secondary} 72%, ${colors.primary} 100%)`,
          boxShadow: `0 0 40px ${colors.primary}`,
          animation: 'pulse 4s ease-in-out infinite',
          animationDelay: `${animationDelay}s`,
        }}
      />
      <div
        className="absolute inset-0 rounded-full"
        style={{
          border: `1px solid ${colors.border}`,
          boxShadow: `inset 0 0 16px ${colors.secondary}`,
        }}
      />
    </div>
  );
});

type OrbitingSkillsProps = {
  className?: string;
};

/** Orbiting integrations — DOM transforms only (no React re-render per frame). */
export function OrbitingSkills({ className }: OrbitingSkillsProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);
  const hoverPaused = useRef(false);
  const inView = useRef(true);
  const reducedMotion = useRef(false);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const syncReduced = () => {
      reducedMotion.current = mq.matches;
    };
    syncReduced();
    mq.addEventListener('change', syncReduced);

    const stage = stageRef.current;
    let io: IntersectionObserver | undefined;
    if (stage) {
      io = new IntersectionObserver(
        ([entry]) => {
          inView.current = entry?.isIntersecting ?? true;
        },
        { rootMargin: '80px 0px', threshold: 0.05 },
      );
      io.observe(stage);
    }

    let raf = 0;
    let last = performance.now();
    let time = 0;

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (reducedMotion.current || hoverPaused.current || !inView.current) {
        last = now;
        return;
      }
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      time += dt;

      for (let i = 0; i < ORBIT_ITEMS.length; i++) {
        const el = itemRefs.current[i];
        const cfg = ORBIT_ITEMS[i];
        if (!el || !cfg) continue;
        const angle = time * cfg.speed + cfg.phaseShift;
        const x = Math.cos(angle) * cfg.orbitRadius;
        const y = Math.sin(angle) * cfg.orbitRadius;
        el.style.transform = `translate(calc(${x}px - 50%), calc(${y}px - 50%))`;
      }
    };

    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      io?.disconnect();
      mq.removeEventListener('change', syncReduced);
    };
  }, []);

  const orbitConfigs: Array<{ radius: number; glowColor: GlowColor; delay: number }> = [
    { radius: 108, glowColor: 'brand', delay: 0 },
    { radius: 188, glowColor: 'emerald', delay: 1.2 },
  ];

  return (
    <div className={cn('relative flex w-full items-center justify-center overflow-hidden', className)}>
      <div
        ref={stageRef}
        className="relative mx-auto flex h-[450px] w-[450px] max-w-full shrink-0 items-center justify-center scale-[0.92] lg:scale-100"
        onMouseEnter={() => {
          hoverPaused.current = true;
        }}
        onMouseLeave={() => {
          hoverPaused.current = false;
        }}
      >
        <div className="relative z-10 flex h-[5.25rem] w-[5.25rem] items-center justify-center rounded-full border border-brand/25 bg-white shadow-[0_12px_32px_-12px_rgba(32,87,206,0.45)]">
          <div className="absolute inset-0 rounded-full bg-brand/15 blur-xl" />
          <div className="absolute inset-0 rounded-full bg-[#25D366]/10 blur-2xl" />
          <KlanvioLogo variant="icon" size="xl" className="relative z-10 !h-11 !w-11" />
        </div>

        {orbitConfigs.map((config) => (
          <GlowingOrbitPath
            key={`path-${config.radius}`}
            radius={config.radius}
            glowColor={config.glowColor}
            animationDelay={config.delay}
          />
        ))}

        {ORBIT_ITEMS.map((config, index) => (
          <OrbitingSkill
            key={config.id}
            config={config}
            nodeRef={(el) => {
              itemRefs.current[index] = el;
            }}
          />
        ))}
      </div>
    </div>
  );
}

export default OrbitingSkills;
