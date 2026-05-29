import * as React from 'react'
import { cn } from '@/lib/utils'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string
  hint?: string
  error?: string
}

// ─── Composant ────────────────────────────────────────────────────────────────

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = 'text', label, hint, error, id, ...props }, ref) => {
    const generatedId = React.useId()
    const inputId = id ?? generatedId
    const errorId = `${inputId}-error`
    const hintId = `${inputId}-hint`

    return (
      <div className="w-full space-y-1.5">
        {label && (
          <label
            htmlFor={inputId}
            className="block text-sm font-medium text-foreground"
          >
            {label}
          </label>
        )}

        <input
          id={inputId}
          type={type}
          ref={ref}
          className={cn(
            // Base
            'flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2',
            'text-sm text-foreground placeholder:text-muted-foreground',
            // Transitions
            'transition-colors duration-150',
            // File input
            'file:border-0 file:bg-transparent file:text-sm file:font-medium',
            // Focus
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0 focus-visible:border-ring',
            // Disabled
            'disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-muted',
            // Error
            error && 'border-destructive focus-visible:ring-destructive',
            className
          )}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={
            error ? errorId : hint ? hintId : undefined
          }
          {...props}
        />

        {hint && !error && (
          <p id={hintId} className="text-xs text-muted-foreground">
            {hint}
          </p>
        )}

        {error && (
          <p id={errorId} className="text-xs text-destructive" role="alert">
            {error}
          </p>
        )}
      </div>
    )
  }
)
Input.displayName = 'Input'

export { Input }
