import * as React from 'react';

import { cn } from '@/lib/utils';

const BUTTON_BASE_CLASS =
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:h-[1.05rem] [&_svg]:w-[1.05rem] [&_svg]:shrink-0';

const BUTTON_VARIANT_CLASS = {
  default: 'bg-blue-600 text-blue-100 hover:bg-blue-700',
  destructive: 'bg-red-600 text-white hover:bg-red-700',
  success: 'bg-green-600 text-white hover:bg-green-700',
  secondary: 'border border-blue-900/30 bg-gray-800/50 text-blue-200 hover:bg-gray-700/50',
  ghost: 'text-blue-400 hover:bg-blue-900/30 hover:text-blue-300',
  outline: 'border border-blue-900/30 bg-transparent text-blue-300 hover:bg-blue-900/20 hover:text-blue-200',
  link: 'text-blue-400 underline-offset-4 hover:text-blue-300 hover:underline'
} as const;

const BUTTON_SIZE_CLASS = {
  default: 'h-10 px-4 py-2',
  sm: 'h-8 rounded-md px-3 text-xs',
  lg: 'h-11 rounded-lg px-6',
  icon: 'h-10 w-10'
} as const;

export type ButtonVariant = keyof typeof BUTTON_VARIANT_CLASS;
export type ButtonSize = keyof typeof BUTTON_SIZE_CLASS;

export function buttonVariants({
  variant = 'default',
  size = 'default',
  className
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
} = {}) {
  return cn(BUTTON_BASE_CLASS, BUTTON_VARIANT_CLASS[variant], BUTTON_SIZE_CLASS[size], className);
}

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'default', ...props }, ref) => (
    <button className={buttonVariants({ variant, size, className })} ref={ref} {...props} />
  )
);
Button.displayName = 'Button';

export { Button };
