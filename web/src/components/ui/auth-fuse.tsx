import * as React from 'react';
import { useState, useId, useEffect } from 'react';
import { Slot } from '@radix-ui/react-slot';
import * as LabelPrimitive from '@radix-ui/react-label';
import { cva, type VariantProps } from 'class-variance-authority';
import { Eye, EyeOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { KlanvioLogo } from '@/components/brand/KlanvioLogo';
import { GoogleSignInButton } from '@/components/auth/GoogleSignInButton';
import { GOOGLE_CLIENT_ID } from '@/lib/config';
import { ShinyButton } from '@/components/ui/shiny-button';

/* ─── Typewriter ─────────────────────────────────────────────────── */

export interface TypewriterProps {
  text: string | string[];
  speed?: number;
  cursor?: string;
  loop?: boolean;
  deleteSpeed?: number;
  delay?: number;
  className?: string;
}

export function Typewriter({
  text,
  speed = 100,
  cursor = '|',
  loop = false,
  deleteSpeed = 50,
  delay = 1500,
  className,
}: TypewriterProps) {
  const [displayText, setDisplayText] = useState('');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isDeleting, setIsDeleting] = useState(false);
  const [textArrayIndex, setTextArrayIndex] = useState(0);

  const textArray = Array.isArray(text) ? text : [text];
  const currentText = textArray[textArrayIndex] || '';

  useEffect(() => {
    if (!currentText) return;

    const timeout = setTimeout(
      () => {
        if (!isDeleting) {
          if (currentIndex < currentText.length) {
            setDisplayText((prev) => prev + currentText[currentIndex]);
            setCurrentIndex((prev) => prev + 1);
          } else if (loop) {
            setTimeout(() => setIsDeleting(true), delay);
          }
        } else if (displayText.length > 0) {
          setDisplayText((prev) => prev.slice(0, -1));
        } else {
          setIsDeleting(false);
          setCurrentIndex(0);
          setTextArrayIndex((prev) => (prev + 1) % textArray.length);
        }
      },
      isDeleting ? deleteSpeed : speed,
    );

    return () => clearTimeout(timeout);
  }, [
    currentIndex,
    isDeleting,
    currentText,
    loop,
    speed,
    deleteSpeed,
    delay,
    displayText,
    textArray.length,
  ]);

  return (
    <span className={className}>
      {displayText}
      <span className="animate-pulse">{cursor}</span>
    </span>
  );
}

/* ─── Primitives (local) ─────────────────────────────────────────── */

const labelVariants = cva(
  'text-sm font-medium leading-none text-text-300 peer-disabled:cursor-not-allowed peer-disabled:opacity-70',
);

const Label = React.forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root> & VariantProps<typeof labelVariants>
>(({ className, ...props }, ref) => (
  <LabelPrimitive.Root ref={ref} className={cn(labelVariants(), className)} {...props} />
));
Label.displayName = LabelPrimitive.Root.displayName;

const buttonVariants = cva(
  'inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-brand text-white hover:bg-brand-dark',
        destructive: 'bg-red-600 text-white hover:bg-red-700',
        outline:
          'border border-black/10 bg-white text-text-200 hover:bg-bg-100',
        secondary: 'bg-bg-200 text-text-200 hover:bg-bg-300',
        ghost: 'hover:bg-bg-100 hover:text-text-100',
        link: 'h-auto cursor-pointer p-0 text-brand underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-11 px-4 py-2',
        sm: 'h-9 rounded-lg px-3',
        lg: 'h-12 rounded-xl px-6',
        icon: 'h-8 w-8',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = 'Button';

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<'input'>>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      className={cn(
        'flex h-10 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm text-text-100 shadow-sm transition placeholder:text-text-500 focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/20 disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      ref={ref}
      {...props}
    />
  ),
);
Input.displayName = 'Input';

export interface PasswordInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
}

const PasswordInput = React.forwardRef<HTMLInputElement, PasswordInputProps>(
  ({ className, label, ...props }, ref) => {
    const id = useId();
    const [showPassword, setShowPassword] = useState(false);
    return (
      <div className="grid w-full items-center gap-2">
        {label && <Label htmlFor={id}>{label}</Label>}
        <div className="relative">
          <Input
            id={id}
            type={showPassword ? 'text' : 'password'}
            className={cn('pe-10', className)}
            ref={ref}
            {...props}
          />
          <button
            type="button"
            onClick={() => setShowPassword((prev) => !prev)}
            className="absolute inset-y-0 end-0 flex h-full w-10 cursor-pointer items-center justify-center text-text-500 transition hover:text-text-100 focus-visible:outline-none"
            aria-label={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
          >
            {showPassword ? (
              <EyeOff className="size-4" aria-hidden="true" />
            ) : (
              <Eye className="size-4" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>
    );
  },
);
PasswordInput.displayName = 'PasswordInput';

/* ─── Auth forms ─────────────────────────────────────────────────── */

type AuthHandlers = {
  busy: boolean;
  error: string;
  onSignIn: (email: string, password: string) => Promise<void>;
  onSignUp: (name: string, email: string, password: string) => Promise<void>;
  onGoogle?: (accessToken: string) => Promise<void>;
  onGoogleError?: (message: string) => void;
};

function SignInForm({
  busy,
  error,
  onSignIn,
  onGoogle,
  onGoogleError,
}: Pick<AuthHandlers, 'busy' | 'error' | 'onSignIn' | 'onGoogle' | 'onGoogleError'>) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void onSignIn(email, password);
      }}
      autoComplete="on"
      className="flex flex-col gap-5"
    >
      <div className="flex flex-col items-center gap-1.5 text-center">
        <h1 className="text-xl font-semibold tracking-tight text-text-100 sm:text-2xl">Connexion</h1>
        <p className="text-balance text-sm text-text-400">
          Automatisez votre prospection WhatsApp à 100 %
        </p>
      </div>
      <div className="grid gap-3.5">
        <div className="grid gap-1.5">
          <Label htmlFor="auth-email">Email</Label>
          <Input
            id="auth-email"
            name="email"
            type="email"
            placeholder="vous@entreprise.com"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <PasswordInput
          name="password"
          label="Mot de passe"
          required
          autoComplete="current-password"
          placeholder="••••••••"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <p className="text-sm text-red-500">{error}</p>}
        <ShinyButton type="submit" disabled={busy} className="mt-1 w-full">
          {busy ? 'Connexion…' : 'Se connecter'}
        </ShinyButton>
      </div>
      {GOOGLE_CLIENT_ID && onGoogle && (
        <>
          <div className="relative text-center text-sm after:absolute after:inset-0 after:top-1/2 after:z-0 after:flex after:items-center after:border-t after:border-black/10">
            <span className="relative z-10 bg-[#f7f8fb] px-3 text-text-500">Ou continuer avec</span>
          </div>
          <GoogleSignInButton
            label="Se connecter avec Google"
            onToken={(t) => void onGoogle(t)}
            onError={onGoogleError}
            disabled={busy}
          />
        </>
      )}
    </form>
  );
}

function SignUpForm({
  busy,
  error,
  onSignUp,
  onGoogle,
  onGoogleError,
}: Pick<AuthHandlers, 'busy' | 'error' | 'onSignUp' | 'onGoogle' | 'onGoogleError'>) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void onSignUp(name, email, password);
      }}
      autoComplete="on"
      className="flex flex-col gap-5"
    >
      <div className="flex flex-col items-center gap-1.5 text-center">
        <h1 className="text-xl font-semibold tracking-tight text-text-100 sm:text-2xl">
          Créer un compte
        </h1>
        <p className="text-balance text-sm text-text-400">Rejoignez Klanvio en quelques secondes</p>
      </div>
      <div className="grid gap-3.5">
        <div className="grid gap-1.5">
          <Label htmlFor="auth-name">Prénom ou nom</Label>
          <Input
            id="auth-name"
            name="name"
            type="text"
            placeholder="Will"
            required
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="auth-email-up">Email</Label>
          <Input
            id="auth-email-up"
            name="email"
            type="email"
            placeholder="vous@entreprise.com"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <PasswordInput
          name="password"
          label="Mot de passe"
          required
          autoComplete="new-password"
          placeholder="6 caractères minimum"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <p className="text-sm text-red-500">{error}</p>}
        <ShinyButton type="submit" disabled={busy} className="mt-1 w-full">
          {busy ? 'Création…' : "S'inscrire"}
        </ShinyButton>
      </div>
      {GOOGLE_CLIENT_ID && onGoogle && (
        <>
          <div className="relative text-center text-sm after:absolute after:inset-0 after:top-1/2 after:z-0 after:flex after:items-center after:border-t after:border-black/10">
            <span className="relative z-10 bg-[#f7f8fb] px-3 text-text-500">Ou continuer avec</span>
          </div>
          <GoogleSignInButton
            label="S'inscrire avec Google"
            onToken={(t) => void onGoogle(t)}
            onError={onGoogleError}
            disabled={busy}
          />
        </>
      )}
    </form>
  );
}

function AuthFormContainer({
  isSignIn,
  onToggle,
  handlers,
}: {
  isSignIn: boolean;
  onToggle: () => void;
  handlers: AuthHandlers;
}) {
  return (
    <div className="mx-auto w-full max-w-[380px] space-y-5">
      {isSignIn ? (
        <SignInForm
          busy={handlers.busy}
          error={handlers.error}
          onSignIn={handlers.onSignIn}
          onGoogle={handlers.onGoogle}
          onGoogleError={handlers.onGoogleError}
        />
      ) : (
        <SignUpForm
          busy={handlers.busy}
          error={handlers.error}
          onSignUp={handlers.onSignUp}
          onGoogle={handlers.onGoogle}
          onGoogleError={handlers.onGoogleError}
        />
      )}
      <div className="text-center text-sm text-text-500">
        {isSignIn ? 'Pas encore de compte ?' : 'Déjà un compte ?'}{' '}
        <Button variant="link" className="pl-1" type="button" onClick={onToggle}>
          {isSignIn ? 'Créer un compte' : 'Se connecter'}
        </Button>
      </div>
    </div>
  );
}

/* ─── AuthUI ─────────────────────────────────────────────────────── */

interface AuthContentProps {
  image?: { src: string; alt: string };
  quote?: { text: string; author: string };
}

export interface AuthUIProps {
  initialSignIn?: boolean;
  onBack?: () => void;
  onModeChange?: (isSignIn: boolean) => void;
  signInContent?: AuthContentProps;
  signUpContent?: AuthContentProps;
  handlers: AuthHandlers;
}

const defaultSignInContent = {
  image: {
    src: 'https://images.unsplash.com/photo-1611224923853-80b023f02d71?auto=format&fit=crop&w=1400&q=80',
    alt: 'Conversation WhatsApp sur smartphone',
  },
  quote: {
    text: 'Votre commercial WhatsApp IA, en ligne 24h/24.',
    author: 'Klanvio',
  },
};

const defaultSignUpContent = {
  image: {
    src: 'https://images.unsplash.com/photo-1556761175-5973dc0f32e7?auto=format&fit=crop&w=1400&q=80',
    alt: 'Équipe qui développe son business',
  },
  quote: {
    text: 'Prospection, closing, groupes et statuts — sans API Meta.',
    author: 'Klanvio',
  },
};

export function AuthUI({
  initialSignIn = true,
  onBack,
  onModeChange,
  signInContent = {},
  signUpContent = {},
  handlers,
}: AuthUIProps) {
  const [isSignIn, setIsSignIn] = useState(initialSignIn);

  useEffect(() => {
    setIsSignIn(initialSignIn);
  }, [initialSignIn]);

  const toggleForm = () => {
    setIsSignIn((prev) => {
      const next = !prev;
      onModeChange?.(next);
      return next;
    });
  };

  const finalSignInContent = {
    image: { ...defaultSignInContent.image, ...signInContent.image },
    quote: { ...defaultSignInContent.quote, ...signInContent.quote },
  };
  const finalSignUpContent = {
    image: { ...defaultSignUpContent.image, ...signUpContent.image },
    quote: { ...defaultSignUpContent.quote, ...signUpContent.quote },
  };
  const currentContent = isSignIn ? finalSignInContent : finalSignUpContent;

  return (
    <div className="min-h-full w-full bg-[#f7f8fb] md:grid md:min-h-full md:grid-cols-2">
      <style>{`
        input[type="password"]::-ms-reveal,
        input[type="password"]::-ms-clear { display: none; }
      `}</style>

      <div className="flex min-h-full flex-col justify-center px-5 py-10 sm:px-8 md:px-10 md:py-12">
        <div className="mb-8 flex items-center justify-between gap-3 sm:mb-10">
          <KlanvioLogo variant="full" size="md" />
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="cursor-pointer text-sm text-text-500 transition hover:text-text-200"
            >
              ← Retour
            </button>
          )}
        </div>
        <AuthFormContainer isSignIn={isSignIn} onToggle={toggleForm} handlers={handlers} />
      </div>

      {/* Panel visuel — desktop only */}
      <div
        className="relative hidden overflow-hidden bg-[#0b1220] bg-cover bg-center transition-all duration-500 ease-in-out md:block"
        style={{ backgroundImage: `url(${currentContent.image.src})` }}
        key={currentContent.image.src}
      >
        <div className="absolute inset-0 bg-gradient-to-t from-[#0b1220] via-[#0b1220]/55 to-[#0b1220]/25" />
        <div className="relative z-10 flex h-full min-h-[100dvh] flex-col items-center justify-end p-8 pb-12">
          <blockquote className="max-w-md space-y-3 text-center text-white">
              <p className="font-serif text-lg font-medium leading-snug tracking-tight text-white sm:text-xl">
              “
              <Typewriter key={currentContent.quote.text} text={currentContent.quote.text} speed={55} />
              ”
            </p>
            <cite className="block text-sm font-medium not-italic text-white/65">
              — {currentContent.quote.author}
            </cite>
          </blockquote>
        </div>
      </div>

      {/* Mobile quote strip */}
      <div className="border-t border-black/[0.06] bg-white px-5 py-5 md:hidden">
        <p className="text-center font-serif text-base text-text-200">
          “{currentContent.quote.text}”
        </p>
        <p className="mt-1 text-center text-xs text-text-500">— {currentContent.quote.author}</p>
      </div>
    </div>
  );
}
