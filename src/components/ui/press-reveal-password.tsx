'use client';

import { forwardRef, useId, useMemo, useState, type KeyboardEventHandler } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { INPUT_BASE_CLASSES, type InputProps } from '@/components/ui/input';
import { cn } from '@/lib/utils';

type PressRevealPasswordProps = Omit<InputProps, 'type'> & {
  label?: string;
};

export const PressRevealPassword = forwardRef<HTMLInputElement, PressRevealPasswordProps>((props, ref) => {
  const { className, label, id, error, onKeyDown, onKeyUp, ...rest } = props;
  const autoId = useId();
  const inputId = useMemo(() => id ?? autoId, [id, autoId]);
  const [pressed, setPressed] = useState(false);

  const begin = () => setPressed(true);
  const end = () => setPressed(false);
  const handleKeyDown: KeyboardEventHandler<HTMLButtonElement> = (event) => {
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      begin();
    }
  };
  const handleKeyUp: KeyboardEventHandler<HTMLButtonElement> = (event) => {
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      end();
    }
  };

  return (
    <div className="w-full">
      <div className="relative w-full">
        <input
          ref={ref}
          id={inputId}
          type={pressed ? 'text' : 'password'}
          className={cn(INPUT_BASE_CLASSES, 'pr-20', error && 'border-destructive focus-visible:ring-destructive', className)}
          onKeyDown={onKeyDown}
          onKeyUp={onKeyUp}
          {...rest}
        />
        <button
          type="button"
          aria-label={label ? `Press and hold to reveal ${label}` : 'Press and hold to reveal password'}
          className={cn(
            'absolute right-2 top-1/2 z-10 inline-flex h-7 -translate-y-1/2 items-center justify-center gap-1 rounded-md px-1.5',
            'border border-[rgba(148,163,184,0.35)] bg-black/25 text-slate-200 shadow-sm backdrop-blur-sm',
            'hover:text-white',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40'
          )}
          onMouseDown={begin}
          onMouseUp={end}
          onMouseLeave={end}
          onTouchStart={begin}
          onTouchEnd={end}
          onTouchCancel={end}
          onKeyDown={handleKeyDown}
          onKeyUp={handleKeyUp}
          onBlur={end}
        >
          {pressed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          <span className="text-[10px] font-medium leading-none">{pressed ? 'Hide' : 'Show'}</span>
        </button>
      </div>
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
});

PressRevealPassword.displayName = 'PressRevealPassword';

