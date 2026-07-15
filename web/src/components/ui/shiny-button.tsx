import type React from 'react';
import { cn } from '@/lib/utils';
import './shiny-button.css';

interface ShinyButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
  type?: 'button' | 'submit' | 'reset';
  disabled?: boolean;
  /** Compact size for navbar / tight layouts */
  size?: 'default' | 'sm';
}

export function ShinyButton({
  children,
  onClick,
  className = '',
  type = 'button',
  disabled,
  size = 'default',
}: ShinyButtonProps) {
  return (
    <button
      type={type}
      className={cn('shiny-cta', size === 'sm' && 'shiny-cta--sm', className)}
      onClick={onClick}
      disabled={disabled}
    >
      <span>{children}</span>
    </button>
  );
}
